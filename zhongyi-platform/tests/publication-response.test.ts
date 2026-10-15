import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, PublicationActionInput, PublicationApprovalInput, PublicationControlInput, PublicationSnapshotInput, SessionInfo } from '../shared/contracts.js';
import { parsePublicationApproval, parsePublicationControl, parsePublicationEvent, parsePublicationSnapshot, parsePublicationWorkspace, parseSavedPublicationApproval, parseSavedPublicationControl, parseSavedPublicationEvent, parseSavedPublicationSnapshot } from '../shared/publication-response.js';
import { publicationSnapshotView } from '../server/publication-http.js';
import { recoveryFreeze } from '../server/publication-values.js';
import { parsePublicationPreflight } from '../shared/source-check-response.js';
import { publicationFixture } from './publication-fixture.js';

type Fixture = Awaited<ReturnType<typeof publicationFixture>>;
const session = (user: Account): SessionInfo => ({ user, csrfToken: 'test-only', expiresAt: new Date().toISOString() });
const view = (fixture: Fixture, version?: number) => { const full = fixture.publication.workspace('huang-qi', true, version); return { ...full, snapshots: full.snapshots.map(publicationSnapshotView) }; };
async function using(work: (fixture: Fixture) => void | Promise<void>) { const fixture = await publicationFixture(); try { await work(fixture); } finally { fixture.close(); } }
const hash = `sha256:${'a'.repeat(64)}`;

test('publication empty workspace is bound to its ingredient and private preflight authority checks stay explicit', async () => using(f => {
  const empty = view(f); assert.deepEqual(parsePublicationWorkspace(empty, 'huang-qi'), empty);
  const noContent = f.publication.workspace('jiang', true); assert(noContent.preflight.reasons.includes('editorial_authority_changed'));
  assert.deepEqual(parsePublicationWorkspace(noContent, 'jiang'), noContent);
  assert.throws(() => parsePublicationPreflight(noContent.preflight, 'jiang')); // General workflow endpoint has no added publication-authority reason.
  for (const value of [null, {}, { ...empty, ingredientId: 'jiang' }, { ...empty, enabled: 1 }, { ...empty, basisDigest: null },
    { ...empty, blockedReasons: [] }, { ...empty, activeSnapshotId: 'unexpected' }, { ...empty, eventVersion: 1 }, { ...empty, extra: 'must-not-pass' }]) assert.throws(() => parsePublicationWorkspace(value, 'huang-qi'));
}));

test('publication snapshot reconstructs its reduced private projection and binds sources, fixed opinions and qualification summaries', async () => using(f => {
  const fixed = publicationSnapshotView(f.snapshot()), parsed = parsePublicationSnapshot(fixed, 'huang-qi'); assert.deepEqual(parsed, fixed);
  parsed.basis.draft.content.educationText = 'changed'; assert.notEqual(fixed.basis.draft.content.educationText, 'changed');
  const q = fixed.basis.qualifications[0], review = fixed.basis.professionalReviews[0], check = fixed.basis.sourceChecks[0];
  for (const basis of [{ ...fixed.basis, qualifications: [{ ...q, evidenceReference: 'PRIVATE-MUST-NOT-LEAK' }, fixed.basis.qualifications[1]] },
    { ...fixed.basis, qualifications: [q, q] }, { ...fixed.basis, professionalReviews: [review, review] },
    { ...fixed.basis, qualifications: [{ ...q, revision: q.revision + 1 }, fixed.basis.qualifications[1]] },
    { ...fixed.basis, professionalReviews: [{ ...review, contentDigest: hash }, fixed.basis.professionalReviews[1]] },
    { ...fixed.basis, sourceChecks: [] }, { ...fixed.basis, sourceChecks: [{ ...check, ingredientIds: ['jiang'] }] },
    { ...fixed.basis, sourceChecks: [{ ...check, sourceRevision: 2 }] }, { ...fixed.basis, sourceChecks: [{ ...check, authority: 'reference' }] },
    { ...fixed.basis, draft: { ...fixed.basis.draft, sources: [] } }]) assert.throws(() => parsePublicationSnapshot({ ...fixed, basis }, 'huang-qi'));
  const historical = structuredClone(fixed); historical.basis.qualifications[0].validUntil = '2001-01-01T00:00:00.000Z';
  historical.basis.sourceChecks[0].checkedAt = '2000-01-01T00:00:00.000Z'; historical.basis.sourceChecks[0].validUntil = '2001-01-01T00:00:00.000Z';
  assert.deepEqual(parsePublicationSnapshot(historical, 'huang-qi'), historical); // Readability is not current validity.
}));

test('publication workspace associates approval, current pointer, control epoch and contiguous event digest links', async () => using(async f => {
  f.resume(); const first = f.snapshot(); f.approve(first.id); f.action(first.id);
  let current = view(f); assert.deepEqual(parsePublicationWorkspace(current, 'huang-qi'), current);
  for (const patch of [{ activeSnapshotId: null }, { activeSnapshotId: 'other' }, { blockedReasons: ['publication_missing'] }, { control: null },
    { approvals: [] }, { approvals: [{ ...current.approvals[0], snapshotDigest: hash }] }, { approvals: [{ ...current.approvals[0], controlEpoch: 'other' }] },
    { events: [{ ...current.events[0], previousDigest: hash }] }]) assert.throws(() => parsePublicationWorkspace({ ...current, ...patch }, 'huang-qi'));
  await f.advance(); const second = f.snapshot(); f.approve(second.id); f.action(second.id); current = view(f);
  assert.deepEqual(parsePublicationWorkspace(current, 'huang-qi'), current);
  assert.throws(() => parsePublicationWorkspace({ ...current, events: [{ ...current.events[0], previousDigest: hash }, current.events[1]] }, 'huang-qi'));
  f.action(second.id, 'withdraw'); assert.equal(parsePublicationWorkspace(view(f), 'huang-qi').activeSnapshotId, null);
}));

test('historical workspace keeps a current and explicitly focused snapshot outside the latest twenty without sorting away their identities', async () => using(async f => {
  f.resume(); const first = f.snapshot(); f.approve(first.id); f.action(first.id);
  for (let index = 0; index < 22; index++) { await f.advance(`ENGINEERING_SIMULATION_NOT_REAL：历史窗口 ${index}`); f.snapshot(); }
  const focused = view(f, 2); assert.equal(focused.snapshots.length, 22); assert.equal(focused.snapshots[20].id, first.id); assert.equal(focused.snapshots[21].version, 2);
  assert.deepEqual(parsePublicationWorkspace(focused, 'huang-qi', 2), focused);
  assert.throws(() => parsePublicationWorkspace(focused, 'huang-qi'));
  assert.throws(() => parsePublicationWorkspace(focused, 'huang-qi', 3));
  assert.throws(() => parsePublicationWorkspace({ ...focused, snapshots: focused.snapshots.slice(1) }, 'huang-qi', 2));
}));

test('snapshot and approval write acknowledgements bind exact input, actor, next version and fixed current basis', async () => using(f => {
  f.resume(); let previous = view(f);
  const input: PublicationSnapshotInput = { expectedBasisDigest: previous.basisDigest!, comment: ' 工程模拟快照 ', confirmed: true };
  const snapshot = publicationSnapshotView(f.publication.createSnapshot('huang-qi', input, f.editor));
  assert.deepEqual(parseSavedPublicationSnapshot(snapshot, previous, input, session(f.editor)), snapshot);
  for (const patch of [{ actorId: f.admin.id }, { actor: 'substituted' }, { accountRevision: 99 }, { version: 2 }, { comment: 'substituted' }, { basisDigest: hash }]) assert.throws(() => parseSavedPublicationSnapshot({ ...snapshot, ...patch }, previous, input, session(f.editor)));
  previous = view(f); const approvalInput: PublicationApprovalInput = { snapshotId: snapshot.id, snapshotDigest: snapshot.digest, expectedApprovalVersion: 0, expectedControlVersion: previous.control!.version, decision: 'approve', comment: ' 工程模拟批准 ', confirmed: true };
  const approval = f.publication.approve('huang-qi', approvalInput, f.approver);
  assert.deepEqual(parseSavedPublicationApproval(approval, previous, approvalInput, session(f.approver)), approval);
  for (const patch of [{ snapshotId: 'other' }, { snapshotDigest: hash }, { version: 2 }, { decision: 'revoke' }, { controlEpoch: 'other' }, { actorId: f.admin.id }, { comment: 'substituted' }]) assert.throws(() => parseSavedPublicationApproval({ ...approval, ...patch }, previous, approvalInput, session(f.approver)));
}));

test('publish, withdrawal, rollback and revocation acknowledgements remain distinct and bind actual prior event and approval versions', async () => using(async f => {
  f.resume(); const first = f.snapshot(); f.approve(first.id);
  const act = (snapshotId: string, action: PublicationActionInput['action']) => {
    const previous = view(f), input: PublicationActionInput = { snapshotId, action, expectedVersion: previous.eventVersion, expectedControlVersion: previous.control!.version, comment: ' 仅工程模拟事件 ', confirmed: true };
    const result = f.publication.action('huang-qi', input, f.approver, undefined, true);
    assert.deepEqual(parseSavedPublicationEvent(result, previous, input, session(f.approver)), result);
    for (const patch of [{ ingredientId: 'jiang' }, { snapshotId: 'other' }, { approvalVersion: result.approvalVersion + 1 }, { controlEpoch: 'other' }, { comment: 'substituted' }]) assert.throws(() => parseSavedPublicationEvent({ ...result, ...patch }, previous, input, session(f.approver)));
    return result;
  };
  act(first.id, 'publish'); await f.advance(); const second = f.snapshot(); f.approve(second.id); act(second.id, 'publish'); act(first.id, 'rollback');
  const previous = view(f), input: PublicationApprovalInput = { snapshotId: first.id, snapshotDigest: first.digest, expectedApprovalVersion: previous.approvals.find(item => item.snapshotId === first.id)!.version, expectedControlVersion: previous.control!.version, decision: 'revoke', comment: '工程模拟撤销批准', confirmed: true };
  const revoked = f.publication.approve('huang-qi', input, f.approver); assert.equal(parseSavedPublicationApproval(revoked, previous, input, session(f.approver)).decision, 'revoke');
  const withdrawn = act(first.id, 'withdraw'); assert.equal(withdrawn.approvalVersion, revoked.version); assert.equal(parsePublicationWorkspace(view(f), 'huang-qi').activeSnapshotId, null);
}));

test('freeze and resume acknowledgements bind operator and epoch; recovery controls are strictly non-operator historical records', async () => using(f => {
  let previous = view(f).control;
  for (const action of ['resume', 'freeze', 'resume'] as const) {
    const input: PublicationControlInput = { action, expectedVersion: previous?.version || 0, evidenceReference: ' 仅工程模拟编号 ', comment: ' 仅工程模拟全局控制 ', confirmed: true };
    const result = f.publication.control(input, f.admin); assert.deepEqual(parseSavedPublicationControl(result, previous, input, session(f.admin)), result);
    for (const patch of [{ actorId: f.editor.id }, { accountRevision: 10 }, { version: result.version + 1 }, { comment: 'substituted' }, { evidenceReference: 'substituted' }]) assert.throws(() => parseSavedPublicationControl({ ...result, ...patch }, previous, input, session(f.admin)));
    if (previous) assert.throws(() => parseSavedPublicationControl({ ...result, epoch: action === 'freeze' ? previous!.epoch : 'wrong-resume-epoch' }, previous, input, session(f.admin)));
    previous = result;
  }
  const recovery = recoveryFreeze(previous || undefined, '仅工程恢复'); assert.deepEqual(parsePublicationControl(recovery), recovery);
  for (const patch of [{ action: 'resume' }, { actorId: f.admin.id }, { accountRevision: 1 }, { actor: f.admin.username }]) assert.throws(() => parsePublicationControl({ ...recovery, ...patch }));
  assert.throws(() => parsePublicationApproval({ ...f.approver })); assert.throws(() => parsePublicationEvent({ version: 1 }, 'huang-qi'));
}));
