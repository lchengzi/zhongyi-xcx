import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicationRepository } from '../server/publication.js';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { CONTROL_INSERT, controlValues, publicEducation, publicationDigest, recoveryFreeze, snapshotFrom } from '../server/publication-values.js';
import { verifyPublicationHistory } from '../server/publication-integrity.js';
import { professionalReviewDigest } from '../server/professional-values.js';
import { randomBytes } from 'node:crypto';
import { fileDigest } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { decryptBackup, encryptBackup, restorePostgresBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { publicationFixture } from './publication-fixture.js';

test('fixed snapshot→independent approval→explicit local publication exposes only education allowlist; frozen catalog stays identical', async () => {
  const state = await publicationFixture();
  try {
    const before = state.catalog.publicSnapshot(); const snapshot = state.snapshot();
    assert.throws(() => state.approve(snapshot.id), (e: any) => e.code === 'publication_frozen');
    assert.equal(state.publication.published('huang-qi', true), null);
    state.resume(); state.approve(snapshot.id);
    assert.throws(() => state.action(snapshot.id, 'publish', false), (e: any) => e.code === 'publication_disabled');
    const event = state.action(snapshot.id); const published = state.publication.published('huang-qi', true)!;
    assert.equal(published.snapshotId, snapshot.id); assert.equal(published.publishedAt, event.recordedAt);
    assert.equal(published.educationText, snapshot.basis.draft.content.educationText);
    assert.deepEqual(Object.keys(published).sort(), ['scope','ingredientId','name','snapshotId','snapshotVersion','contentRevision','baseReleaseId','publishedAt','ediblePart','latinName','educationText','safetyText','sources','boundary'].sort());
    assert.deepEqual(Object.keys(published.sources[0]).sort(), ['title','publisher','url','locator','checkedAt','validUntil'].sort());
    assert(!JSON.stringify(published).includes('ENGINEERING_SIMULATION_NOT_REAL'));
    assert.equal(state.publication.published('huang-qi'), null); assert.deepEqual(state.catalog.publicSnapshot(), before);
    assert.throws(() => state.action(snapshot.id), (e: any) => e.code === 'duplicate_publication');
  } finally { state.close(); }
});

test('test-fixture credentials and source checks cannot create approved snapshots or publication even in enabled local engineering mode', async () => {
  const state = await publicationFixture(false);
  try {
    const workspace = state.publication.workspace('huang-qi', true); assert.equal(workspace.basisDigest, null); assert.equal(workspace.preflight.readyForReleaseApproval, false);
    assert.throws(() => state.snapshot(), (e: any) => e.code === 'invalid_publication' || e.code === 'publication_prerequisites');
    assert.equal(state.publication.published('huang-qi', true), null);
    assert.equal(state.catalog.db.prepare('SELECT COUNT(*) n FROM publication_snapshots').get()!.n, 0);
  } finally { state.close(); }
});

test('snapshot and approval require current roles, independent approver, exact digest, versions and confirmation; history cannot be overwritten', async () => {
  const state = await publicationFixture();
  try {
    const basis = state.publication.workspace('huang-qi').basisDigest!;
    assert.throws(() => state.publication.createSnapshot('huang-qi', { expectedBasisDigest: basis, comment: '工程测试', confirmed: true }, state.reviewer), (e: any) => e.code === 'forbidden');
    assert.throws(() => state.publication.createSnapshot('huang-qi', { expectedBasisDigest: 'sha256:'+'0'.repeat(64), comment: '工程测试', confirmed: true }, state.editor), (e: any) => e.code === 'revision_conflict');
    const snapshot = state.snapshot(); state.resume();
    const input = { snapshotId: snapshot.id, snapshotDigest: snapshot.digest, expectedApprovalVersion: 0, expectedControlVersion: 1, decision: 'approve' as const, comment: '工程测试', confirmed: true };
    assert.throws(() => state.publication.approve('huang-qi', input, state.admin), (e: any) => e.code === 'self_approval');
    assert.throws(() => state.publication.approve('huang-qi', { ...input, confirmed: false }, state.approver), (e: any) => e.code === 'invalid_publication');
    state.approve(snapshot.id);
    assert.throws(() => state.publication.approve('huang-qi', input, state.approver), (e: any) => e.code === 'revision_conflict');
    assert.throws(() => state.snapshot(), (e: any) => e.code === 'duplicate_snapshot');
    for (const table of ['publication_snapshots', 'publication_approvals', 'publication_controls']) {
      assert.throws(() => state.catalog.db.exec(`UPDATE ${table} SET digest='changed'`), /immutable/);
      assert.throws(() => state.catalog.db.exec(`DELETE FROM ${table}`), /immutable/);
    }
    const row = state.catalog.db.prepare('SELECT * FROM publication_snapshots').get()!;
    assert.deepEqual(snapshotFrom(row), snapshot);
    assert.throws(() => snapshotFrom({ ...row, comment: 'tampered' }), (e: any) => e.code === 'publication_integrity');
  } finally { state.close(); }
});

test('new drafts preserve the published fixed snapshot; two reviewed revisions support real rollback and targeted old professional revocation', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const old = state.snapshot(); state.approve(old.id); state.action(old.id);
    const current = state.workflow.draft('huang-qi')!;
    const next = state.workflow.saveDraft('huang-qi', { ...current.content, educationText: '隔离工程模拟的新版正文。' }, current.lockVersion, state.editor);
    assert.equal(state.publication.published('huang-qi', true)!.snapshotId, old.id);
    const submitted = state.workflow.submit('huang-qi', next.lockVersion, state.editor);
    state.workflow.decide(submitted.task.id, 'accept', '仅工程模拟编辑审阅。', submitted.draft.lockVersion, state.reviewer);
    await state.review('tcm_physician'); await state.review('pharmacist');
    const newer = state.snapshot(); state.approve(newer.id);
    assert.throws(() => state.action(newer.id, 'rollback'), (e: any) => e.code === 'invalid_rollback');
    state.action(newer.id); assert.equal(state.publication.published('huang-qi', true)!.snapshotId, newer.id);
    state.action(old.id, 'rollback'); assert.equal(state.publication.published('huang-qi', true)!.snapshotId, old.id);
    await state.review('tcm_physician', old.basis.draft.revision, 'revoke');
    assert.equal(state.publication.published('huang-qi', true), null);
    // Revoking an OLD revision must not revoke the newer revision's opinion.
    assert.equal(state.workflow.professionalDetail('huang-qi').state, 'eligible_for_publication_approval');
    state.action(newer.id); assert.equal(state.publication.published('huang-qi', true)!.snapshotId, newer.id);
    assert.throws(() => state.action(old.id, 'rollback'), (e: any) => e.code === 'publication_prerequisites');
  } finally { state.close(); }
});

test('withdrawal requires a NEW approval, old approval revocation/regrant and recovery resume never silently resurrect a public pointer', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id);
    state.action(snapshot.id, 'withdraw', false); assert.equal(state.publication.published('huang-qi', true), null);
    assert.throws(() => state.action(snapshot.id, 'rollback'), (e: any) => e.code === 'publication_prerequisites');
    state.approve(snapshot.id); assert.equal(state.publication.published('huang-qi', true), null);
    state.action(snapshot.id); assert(state.publication.published('huang-qi', true));
    state.approve(snapshot.id, 'revoke'); state.approve(snapshot.id);
    assert.equal(state.publication.published('huang-qi', true), null); state.action(snapshot.id);
    const priorControl = state.publication.controlHistory()[0]; const frozen = recoveryFreeze(priorControl, 'isolated-engineering-recovery');
    state.catalog.db.prepare(CONTROL_INSERT).run(...controlValues(frozen));
    assert.equal(state.publication.published('huang-qi', true), null);
    state.resume(); assert.equal(state.publication.published('huang-qi', true), null);
    assert.throws(() => state.action(snapshot.id), (e: any) => e.code === 'publication_prerequisites');
    state.approve(snapshot.id); assert.equal(state.publication.published('huang-qi', true), null);
    state.action(snapshot.id); assert(state.publication.published('huang-qi', true));
    assert.equal(state.publication.controlHistory()[1].kind, 'recovery');
  } finally { state.close(); }
});

test('current qualifier/account/source changes invalidate already published records, including expiry, without editing the immutable snapshot', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id);
    const facts = state.publication.factsInTransaction('huang-qi');
    assert.equal(publicEducation(facts, true, Date.parse(snapshot.basis.sourceChecks[0].validUntil)), null);
    const { sourceId, version, actorId, actor, accountRevision, recordedAt, digest, ...check } = snapshot.basis.sourceChecks[0];
    state.workflow.saveSourceCheck(state.source.id, { ...check, decision: 'revoke', comment: '仅工程测试撤销来源核验。' }, 1, state.admin);
    assert.equal(state.publication.published('huang-qi', true), null);
    assert.deepEqual(state.publication.snapshot('huang-qi', snapshot.id), snapshot);
    assert.throws(() => state.action(snapshot.id), (e: any) => e.code === 'publication_prerequisites');
  } finally { state.close(); }
});

test('qualification reissue and publication approver account changes invalidate old authorizations instead of reviving them', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id);
    const qualification = state.workflow.qualificationHistory(state.pharmacist.id)[0];
    const { userId, revision, accountRevision, recordedById, recordedBy, recordedAt, digest, ...input } = qualification;
    state.workflow.saveQualification(userId, { ...input, status: 'revoked', comment: '仅测试撤销模拟资格。' }, revision, state.admin);
    assert.equal(state.publication.published('huang-qi', true), null);
    state.workflow.saveQualification(userId, { ...input, comment: '仅测试重新登记模拟资格，不复活旧意见。' }, revision + 1, state.admin);
    assert.equal(state.publication.published('huang-qi', true), null);
    await state.auth.updateUser(state.approver.id, 'admin', false, 1, state.admin.username, state.token);
    assert.throws(() => state.action(snapshot.id), (e: any) => e.code === 'forbidden');
    assert.equal(state.publication.published('huang-qi', true), null);
  } finally { state.close(); }
});

test('fixed publication rows and event hash chain persist through an actual SQLite close/reopen; normal restart does not behave as backup recovery', async () => {
  const state = await publicationFixture(); let reopened: CatalogRepository | undefined;
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id); state.action(snapshot.id, 'withdraw');
    const before = state.publication.workspace('huang-qi', true);
    assert.equal(before.events[0].previousDigest, before.events[1].digest);
    state.catalog.close(); reopened = new CatalogRepository(state.filename, state.seed);
    const publication = new PublicationRepository(reopened.db, new WorkflowRepository(reopened.db));
    assert.deepEqual(publication.workspace('huang-qi', true), before);
    assert.equal(publication.controlHistory()[0].action, 'resume');
  } finally { reopened?.close(); if (!reopened) state.catalog.close(); state.dispose(); }
});

test('snapshot parser rejects malformed JSON and nested forged records even when the outer digests are recomputed', async () => {
  const state = await publicationFixture();
  try {
    state.snapshot(); const row = state.catalog.db.prepare('SELECT * FROM publication_snapshots').get()!;
    const resign = (change: (basis: any) => void) => {
      const basis = JSON.parse(String(row.basis_payload)); change(basis);
      const candidate = { ...row, basis_payload: JSON.stringify(basis), basis_digest: publicationDigest(basis) };
      const snapshot = snapshotFrom(row); const { digest, ...original } = snapshot;
      candidate.digest = publicationDigest({ ...original, basis, basisDigest: candidate.basis_digest }); return candidate;
    };
    const invalid = (error: any) => error.code === 'publication_integrity';
    assert.throws(() => snapshotFrom({ ...row, basis_payload: '{invalid' }), invalid);
    for (const change of [
      (basis: any) => { basis.draft.content = null; },
      (basis: any) => { basis.professionalReviews[0].comment = '重算外层摘要不能伪造内层意见。'; },
      (basis: any) => { basis.qualifications[0].internalExtra = '不能夹带字段'; },
      (basis: any) => { basis.sourceChecks[0].verificationConfirmed = false; },
      (basis: any) => { basis.draft.visibility = 'public'; }
    ]) assert.throws(() => snapshotFrom(resign(change)), invalid);
    // A valid child hash still is not evidence that the child is the actual
    // historical opinion. The cross-table checker closes that second gap.
    const forged = snapshotFrom(resign((basis) => {
      const review = basis.professionalReviews[0]; review.comment = '此意见从未写入实际审校历史';
      const { digest, ...payload } = review; review.digest = professionalReviewDigest(payload);
    }));
    const facts = state.publication.factsInTransaction('huang-qi');
    assert.throws(() => verifyPublicationHistory({ ...facts, snapshots: [forged] }), invalid);
  } finally { state.close(); }
});

test('cross-table history rejects missing or mismatched fixed evidence, hash-chain gaps, epochs and cross-ingredient pointers', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id);
    state.action(snapshot.id, 'withdraw'); state.approve(snapshot.id); state.action(snapshot.id);
    const facts = state.publication.factsInTransaction('huang-qi'); verifyPublicationHistory(facts);
    const invalid = (error: any) => error.code === 'publication_integrity';
    const mutate = (change: (copy: typeof facts) => void) => {
      const copy = structuredClone(facts); change(copy);
      assert.throws(() => verifyPublicationHistory(copy), invalid);
    };
    mutate((copy) => { copy.revisions = []; });
    mutate((copy) => { copy.revisions[0].author = '不是实际作者'; });
    mutate((copy) => { copy.qualificationHistory = []; });
    mutate((copy) => { copy.editorial.find((item) => item.taskId === snapshot.basis.editorial.taskId)!.contentDigest = 'sha256:' + '0'.repeat(64); });
    mutate((copy) => { copy.sources[0].checks = []; });
    mutate((copy) => { copy.approvals.pop(); });
    mutate((copy) => { copy.approvals[0].snapshotDigest = 'sha256:' + '0'.repeat(64); });
    mutate((copy) => { copy.events.splice(1, 1); });
    mutate((copy) => { copy.events[0].previousDigest = null; });
    mutate((copy) => { copy.events[0].ingredientId = 'lian-zi'; });
    mutate((copy) => { copy.events[0].controlEpoch = 'unknown-recovery'; });
    mutate((copy) => { copy.controls[0].version = 2; });
    mutate((copy) => { copy.events[copy.events.length - 1].action = 'rollback'; });
    const reader = new WorkflowRepository(state.catalog.db);
    const missing = new PublicationRepository(state.catalog.db, { draft: (id) => reader.draft(id), source: (id, revision) => reader.source(id, revision), revision: () => undefined });
    assert.throws(() => missing.published('huang-qi', true), invalid);
  } finally { state.close(); }
});

test('fixed historical credentials are validated beyond the UI last-20 window without treating a reissued credential as the pinned one', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const snapshot = state.snapshot(); state.approve(snapshot.id); state.action(snapshot.id);
    const { userId, revision, accountRevision, recordedById, recordedBy, recordedAt, digest, ...input } = state.workflow.qualificationHistory(state.pharmacist.id)[0];
    for (let expected = 1; expected < 23; expected++) state.workflow.saveQualification(userId, { ...input, comment: `仅模拟资格重发 ${expected}` }, expected, state.admin);
    assert.equal(state.workflow.qualificationHistory(userId).length, 20);
    assert(!state.workflow.qualificationHistory(userId).some((item) => item.revision === 1));
    const facts = state.publication.factsInTransaction('huang-qi'); verifyPublicationHistory(facts);
    assert(facts.qualificationHistory.some((item) => item.userId === userId && item.revision === 1));
    assert.equal(state.publication.published('huang-qi', true), null);
    assert.deepEqual(state.publication.snapshot('huang-qi', snapshot.id), snapshot);
  } finally { state.close(); }
});

test('populated publication schema exports read-only with all 31 tables and encrypted backup preserves every fixed record', async () => {
  const state = await publicationFixture();
  try {
    state.resume(); const fixed = state.snapshot(); state.approve(fixed.id); state.action(fixed.id);
    const bytes = fileDigest(state.filename); const snapshot = state.read();
    assert.equal(fileDigest(state.filename), bytes); assert.equal(snapshot.schemaVersion, 10); assert.equal(snapshot.sourceSchemaVersion, 12);
    assert.equal(Object.keys(snapshot.tables).length, 32); assert.equal(snapshot.tables.publication_snapshots.length, 1);
    assert.equal(snapshot.tables.publication_approvals.length, 1); assert.equal(snapshot.tables.publication_events.length, 1); assert.equal(snapshot.tables.publication_controls.length, 1);
    const backup = unitBackup(snapshot); const key = randomBytes(32);
    assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, state.seed), backup);
    assert.deepEqual(validatePostgresBackup(backup, state.seed), backup);
  } finally { state.close(); }
});

test('rehashed publication backup with a forged historical relation is refused before any destination connection', async () => {
  const state = await publicationFixture(); let connections = 0;
  try {
    state.resume(); const fixed = state.snapshot(); state.approve(fixed.id); state.action(fixed.id);
    const original = unitBackup(state.read());
    for (const mutation of ['missing-credential', 'cross-ingredient', 'forged-author', 'missing-approval'] as const) {
      const backup = structuredClone(original);
      if (mutation === 'missing-credential') backup.data.tables.professional_qualifications = [];
      if (mutation === 'missing-approval') backup.data.tables.publication_approvals = [];
      if (mutation === 'cross-ingredient') {
        const row = backup.data.tables.publication_events[0]; row.ingredient_id = 'jiang';
        const current = state.publication.workspace('huang-qi').events[0]; const { digest, ...payload } = current;
        row.digest = publicationDigest({ ...payload, ingredientId: 'jiang' });
      }
      if (mutation === 'forged-author') {
        const row = backup.data.tables.publication_snapshots[0]; const basis = JSON.parse(String(row.basis_payload)); basis.draft.author = '伪造作者';
        row.basis_payload = JSON.stringify(basis); row.basis_digest = publicationDigest(basis);
        const { digest, ...payload } = fixed; row.digest = publicationDigest({ ...payload, basis, basisDigest: row.basis_digest });
      }
      rehashBackup(backup);
      const pool = { connect: async () => { connections++; throw new Error('Must not connect'); } };
      await assert.rejects(restorePostgresBackup(pool as any, 'invalid_publication_recovery', backup, state.seed));
    }
    assert.equal(connections, 0);
  } finally { state.close(); }
});
