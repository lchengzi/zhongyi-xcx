import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { createApp } from '../server/app.js';
import { professionalDetail, qualificationActive, qualificationDigest, professionalReviewDigest, reviewValues } from '../server/professional-values.js';
import { validateSnapshot, snapshotDigest, TABLES } from '../server/migration-snapshot.js';
import { encryptBackup, decryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { randomBytes } from 'node:crypto';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { fixturePassword, migrationFixture } from './migration-fixture.js';
import { addProfessionalFixture, credentialInput } from './professional-fixture.js';
import type { Account, ProfessionalDecisionInput, SessionInfo } from '../shared/contracts.js';

async function setup() {
  const fixture = await migrationFixture(undefined, false); const catalog = new CatalogRepository(fixture.filename, fixture.seed);
  const auth = new AuthRepository(catalog.db); const workflow = new WorkflowRepository(catalog.db);
  const pro = await addProfessionalFixture({ auth, workflow }, fixture.admin);
  const origin = 'https://professional.example.test'; const server = createApp(catalog, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sessions = new Map<string, { cookie: string; info: SessionInfo }>();
  for (const actor of [fixture.admin, fixture.editor, fixture.reviewer, pro.physician, pro.pharmacist]) {
    const response = await fetch(`${root}/api/v1/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password: fixturePassword }) }); assert.equal(response.status, 200);
    sessions.set(actor.id, { cookie: response.headers.get('set-cookie')!.split(';')[0], info: await response.json() });
  }
  const api = (path: string, actor: Account = fixture.admin, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => fetch(`${root}/api/v1${path}`, {
    method, headers: { Origin: origin, Cookie: sessions.get(actor.id)!.cookie, 'X-CSRF-Token': sessions.get(actor.id)!.info.csrfToken, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { ...fixture, catalog, auth, workflow, pro, root, api, adminToken: sessions.get(fixture.admin.id)!.cookie.split('=')[1], close: async () => { await new Promise<void>((done) => server.close(() => done())); catalog.close(); fixture.dispose(); } };
}

test('professional HTTP qualification records require admin, independent verification, exact inputs, CSRF and optimistic versions', async () => {
  const state = await setup(); const { pro, api, admin, editor, workflow } = state;
  try {
    assert.equal((await api(`/editorial/qualifications/${pro.physician.id}`, editor)).status, 403);
    assert.equal((await api(`/editorial/qualifications/${pro.physician.id}`, pro.physician)).status, 200);
    const credential = credentialInput('tcm_physician'); const body = { qualification: credential, expectedRevision: 1 };
    assert.equal((await api(`/editorial/qualifications/${pro.physician.id}`, pro.physician, 'POST', body)).status, 403);
    assert.equal((await api(`/editorial/qualifications/${admin.id}`, admin, 'POST', { qualification: credential, expectedRevision: 0 })).status, 403);
    assert.equal((await api(`/editorial/qualifications/${pro.physician.id}`, admin, 'POST', body, { 'X-CSRF-Token': '' })).status, 403);
    for (const patch of [{ verificationConfirmed: false }, { evidenceReference: '' }, { validUntil: '2000-01-01T00:00:00.000Z' }, { publicationEnabled: true }, { profession: 'doctor' }]) {
      assert.equal((await api(`/editorial/qualifications/${pro.physician.id}`, admin, 'POST', { ...body, qualification: { ...credential, ...patch } })).status, 400);
    }
    const parallel = await Promise.all([1, 2].map(() => api(`/editorial/qualifications/${pro.physician.id}`, admin, 'POST', body)));
    assert.deepEqual(parallel.map((response) => response.status).sort(), [201, 409]); assert.equal(workflow.qualificationHistory(pro.physician.id).length, 2);
    assert.equal((await api(`/editorial/qualifications/${pro.physician.id}?unexpected=1`)).status, 400);
    assert.equal((await fetch(`${state.root}/api/v1/editorial/professional/huang-qi`)).status, 401);
  } finally { await state.close(); }
});

test('two fixed-version fixture opinions remain private and never count as real professional approval or public publication', async () => {
  const state = await setup(); const { workflow, pro, api } = state;
  try {
    const publicBefore = await (await fetch(`${state.root}/api/v1/public/catalog`)).text();
    assert.equal((await api('/editorial/professional/huang-qi', pro.physician, 'POST', await pro.input('tcm_physician'))).status, 200);
    const response = await api('/editorial/professional/huang-qi', pro.pharmacist, 'POST', await pro.input('pharmacist')); assert.equal(response.status, 200);
    const detail = await response.json(); assert.equal(detail.state, 'recorded'); assert.equal(detail.reviewVersion, 2); assert.equal(detail.latestReviews.length, 2);
    assert.equal(detail.publicationEnabled, false); assert.equal(detail.scope, 'ingredient_education'); assert.equal(detail.visibility, 'private');
    assert(detail.reasons.every((reason: string) => reason.includes('test_fixture')));
    assert.equal(await (await fetch(`${state.root}/api/v1/public/catalog`)).text(), publicBefore);
    assert.equal(workflow.draft('huang-qi')!.professionalReviewState, 'pending'); assert.equal((await api('/publish', state.admin, 'POST', {})).status, 404);
  } finally { await state.close(); }
});

test('parallel professional decisions have one winner; stale drafts and returned revisions cannot be approved in place', async () => {
  const state = await setup(); const { pro, api, workflow, editor, reviewer } = state;
  try {
    const input = await pro.input('tcm_physician');
    const responses = await Promise.all([api('/editorial/professional/huang-qi', pro.physician, 'POST', input), api('/editorial/professional/huang-qi', pro.physician, 'POST', { ...input, decision: 'return' })]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const old = workflow.draft('huang-qi')!; const next = workflow.saveDraft('huang-qi', { ...old.content, educationText: '新测试内容，需要重新编辑及专业审校。' }, old.lockVersion, editor);
    assert.equal((await api('/editorial/professional/huang-qi', pro.physician, 'POST', input)).status, 409);
    assert.equal((await api('/editorial/professional/huang-qi', pro.pharmacist, 'POST', await pro.input('pharmacist'))).status, 409);
    const task = workflow.submit('huang-qi', next.lockVersion, editor); workflow.decide(task.task.id, 'accept', '测试编辑通过', task.draft.lockVersion, reviewer);
    assert.equal((await api('/editorial/professional/huang-qi', pro.pharmacist, 'POST', await pro.input('pharmacist', 'return'))).status, 200);
    assert.equal((await api('/editorial/professional/huang-qi', pro.pharmacist, 'POST', await pro.input('pharmacist'))).status, 409);
    assert.equal(workflow.professionalDetail('huang-qi').state, 'changes_requested');
  } finally { await state.close(); }
});

test('qualification revoke/regrant and account epochs invalidate previous opinions without changing immutable history', async () => {
  const state = await setup(); const { workflow, pro, admin, auth } = state;
  try {
    workflow.recordProfessionalReview('huang-qi', await pro.input('tcm_physician'), pro.physician);
    const original = workflow.professionalDetail('huang-qi').reviews[0]; const prior = workflow.qualificationHistory(pro.physician.id)[0];
    workflow.saveQualification(pro.physician.id, { ...credentialInput('tcm_physician'), status: 'revoked' }, prior.revision, admin);
    assert(workflow.professionalDetail('huang-qi').reasons.some((reason) => reason.includes('qualification_or_independence_changed')));
    workflow.saveQualification(pro.physician.id, credentialInput('tcm_physician'), 2, admin);
    assert.deepEqual(workflow.professionalDetail('huang-qi').reviews[0], original);
    assert(workflow.professionalDetail('huang-qi').reasons.some((reason) => reason.includes('qualification_or_independence_changed')));
    await auth.updateUser(pro.physician.id, 'reviewer', false, pro.physician.revision, admin.username, state.adminToken);
    assert.throws(() => workflow.recordProfessionalReview('huang-qi', { ...awaitableInput(original, workflow), decision: 'revoke' }, pro.physician), (error: any) => error.code === 'forbidden');
    workflow.recordProfessionalReview('huang-qi', { ...awaitableInput(original, workflow), decision: 'revoke' }, admin);
    assert.equal(workflow.professionalDetail('huang-qi').latestReviews[0].decision, 'revoke');
    assert.throws(() => state.catalog.db.prepare('UPDATE professional_reviews SET comment = ?').run('tampered'), /immutable/);
    assert.throws(() => state.catalog.db.prepare('DELETE FROM professional_qualifications').run(), /immutable/);
  } finally { await state.close(); }
});
function awaitableInput(review: import('../shared/contracts.js').ProfessionalReview, workflow: WorkflowRepository): ProfessionalDecisionInput {
  const detail = workflow.professionalDetail('huang-qi'); return { profession: review.profession, decision: 'revoke', contentRevision: review.contentRevision, contentDigest: review.contentDigest,
    expectedLockVersion: detail.draft!.lockVersion, expectedReviewVersion: detail.reviewVersion, expectedQualificationRevision: review.qualificationRevision, comment: '测试撤销意见，不涉及真实签审。' };
}

test('professional independence includes editorial reviewers and source authors, not merely the displayed recent content revisions', async () => {
  const state = await setup(); const { workflow, auth, admin, reviewer, pro } = state;
  try {
    workflow.saveQualification(reviewer.id, credentialInput('tcm_physician'), 0, admin);
    const editorialInput = await pro.input('tcm_physician');
    assert.throws(() => workflow.recordProfessionalReview('huang-qi', editorialInput, reviewer), (e: any) => e.code === 'self_review');
    const temporaryEditor = await auth.updateUser(pro.physician.id, 'editor', true, 1, admin.username, state.adminToken);
    const source = workflow.saveSource({ title: '专业人以前整理的测试来源', publisher: '工程测试', url: 'https://example.org/pro-self-source' }, temporaryEditor);
    const previous = workflow.draft('huang-qi')!;
    let draft = workflow.saveDraft('huang-qi', { ...previous.content, sourceRefs: [{ id: source.id, revision: 1, locator: '测试定位' }] }, previous.lockVersion, admin);
    for (let index = 0; index < 21; index++) draft = workflow.saveDraft('huang-qi', { ...draft.content, educationText: `测试完整历史 ${index}` }, draft.lockVersion, admin);
    const task = workflow.submit('huang-qi', draft.lockVersion, admin); workflow.decide(task.task.id, 'accept', '工程编辑意见', task.draft.lockVersion, reviewer);
    const physician = await auth.updateUser(pro.physician.id, 'reviewer', true, temporaryEditor.revision, admin.username, state.adminToken);
    workflow.saveQualification(physician.id, credentialInput('tcm_physician'), 1, admin);
    assert.equal(workflow.detail('huang-qi').revisions.length, 20);
    const sourceAuthorInput = { ...(await pro.input('tcm_physician')), expectedQualificationRevision: 2 };
    assert.throws(() => workflow.recordProfessionalReview('huang-qi', sourceAuthorInput, physician), (e: any) => e.code === 'self_review');
  } finally { await state.close(); }
});

test('qualification expiry and both independent manual-verification records are explicit prerequisites, not publication authority', async () => {
  const state = await setup(); const { workflow, pro, auth } = state;
  try {
    workflow.recordProfessionalReview('huang-qi', await pro.input('tcm_physician'), pro.physician); workflow.recordProfessionalReview('huang-qi', await pro.input('pharmacist'), pro.pharmacist);
    const detail = workflow.professionalDetail('huang-qi');
    // Hypothetical unit-only manual evidence, never written as a real credential.
    const qualifications = [pro.physician, pro.pharmacist].map((user) => { const { digest: _, ...payload } = workflow.qualificationHistory(user.id)[0]; const manual = { ...payload, evidenceKind: 'manual-verification' as const }; return { ...manual, digest: qualificationDigest(manual) }; });
    const facts = { ingredientId: 'huang-qi', draft: workflow.draft('huang-qi'), reviews: detail.reviews, users: auth.users(), qualifications, contributorIds: [] };
    const eligible = professionalDetail(facts); assert.equal(eligible.state, 'eligible_for_publication_approval'); assert.equal(eligible.publicationEnabled, false);
    assert.equal(qualificationActive(qualifications[0], pro.physician, Date.parse(qualifications[0].validUntil)), false);
    assert.notEqual(professionalDetail(facts, Date.parse(qualifications[0].validUntil) + 1).state, 'eligible_for_publication_approval');
  } finally { await state.close(); }
});

test('professional records survive actual SQLite reopen and encrypted business backup validates every new table and pinned relation', async () => {
  const state = await setup();
  try {
    state.workflow.recordProfessionalReview('huang-qi', await state.pro.input('tcm_physician'), state.pro.physician);
    const original = state.workflow.professionalDetail('huang-qi');
    const snapshot = state.read(); assert.equal(snapshot.tables.professional_qualifications.length, 2); assert.equal(snapshot.tables.professional_reviews.length, 1);
    const key = randomBytes(32); const backup = unitBackup(snapshot); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, state.seed), backup);
    for (const mutate of [(value: any) => { value.tables.professional_qualifications[0].evidence_reference = 'tampered'; }, (value: any) => { value.tables.professional_reviews[0].content_digest = 'sha256:' + '0'.repeat(64); }]) {
      const bad = structuredClone(snapshot); mutate(bad); const { digest: _, ...payload } = bad; bad.digest = snapshotDigest(payload); assert.throws(() => validateSnapshot(bad, state.seed));
    }
    // Recompute BOTH row and envelope digests: the pinned-relation check, not
    // merely a stale checksum, must reject this nonexistent credential version.
    const { digest: _, ...review } = original.reviews[0];
    const wrong = { ...review, qualificationRevision: 99 };
    const values = reviewValues({ ...wrong, digest: professionalReviewDigest(wrong) });
    const bad = structuredClone(backup);
    bad.data.tables.professional_reviews = [Object.fromEntries(TABLES.professional_reviews.columns.map((column, index) => [column, values[index]]))];
    rehashBackup(bad); assert.throws(() => validatePostgresBackup(bad, state.seed), (error: any) => error.code === 'professional_changed');
    const reopened = new CatalogRepository(state.filename, state.seed);
    try { assert.deepEqual(new WorkflowRepository(reopened.db).professionalDetail('huang-qi'), original); } finally { reopened.close(); }
  } finally { await state.close(); }
});

test('latest opinions for both professions remain addressable when one is older than the 20-row display window', async () => {
  const state = await setup();
  try {
    state.workflow.recordProfessionalReview('huang-qi', await state.pro.input('tcm_physician'), state.pro.physician);
    for (let index = 0; index < 11; index++) {
      state.workflow.recordProfessionalReview('huang-qi', await state.pro.input('pharmacist'), state.pro.pharmacist);
      const prior = state.workflow.professionalDetail('huang-qi').latestReviews.find((item) => item.profession === 'pharmacist')!;
      state.workflow.recordProfessionalReview('huang-qi', awaitableInput(prior, state.workflow), state.pro.pharmacist);
    }
    state.workflow.recordProfessionalReview('huang-qi', await state.pro.input('pharmacist'), state.pro.pharmacist);
    const detail = state.workflow.professionalDetail('huang-qi');
    assert.equal(detail.reviews.length, 20); assert(detail.reviews.every((item) => item.profession === 'pharmacist'));
    assert.equal(detail.latestReviews.length, 2);
    const physician = detail.latestReviews.find((item) => item.profession === 'tcm_physician')!;
    assert.equal(physician.version, 1);
    state.workflow.recordProfessionalReview('huang-qi', awaitableInput(physician, state.workflow), state.admin);
    assert.equal(state.workflow.professionalDetail('huang-qi').latestReviews.find((item) => item.profession === 'tcm_physician')!.decision, 'revoke');
  } finally { await state.close(); }
});
