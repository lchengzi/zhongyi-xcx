import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, ContentDraft, ProfessionalDecisionInput, ProfessionalDetail, ProfessionalQualification, ProfessionalReview, SessionInfo } from '../shared/contracts.js';
import { parseAccount, parseAccountList } from '../shared/account-response.js';
import { parseProfessionalDecision, parseProfessionalDetail, parseProfessionalReview, parseQualification, parseQualificationHistory, parseSavedQualification } from '../shared/professional-response.js';
import { parseContentDraft } from '../shared/workflow-response.js';
import { hasFixedSourceReferences } from '../web/fixed-source-references.js';
import { professionalDetail } from '../server/professional-values.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { contentRevisionDigest, WorkflowRepository } from '../server/workflow.js';
import { migrationFixture } from './migration-fixture.js';
import { addProfessionalFixture, credentialInput } from './professional-fixture.js';

const time = '2026-10-11T00:00:00.000Z', hash = `sha256:${'a'.repeat(64)}`;
const physician: Account = { id: 'test-physician', username: 'test-physician', role: 'reviewer', active: true, revision: 1, createdAt: time };
const admin: Account = { ...physician, id: 'test-admin', username: 'test-admin', role: 'admin' };
const signed = (user: Account): SessionInfo => ({ user, csrfToken: 'test-only', expiresAt: time });
const qualification: ProfessionalQualification = { ...credentialInput('tcm_physician'), userId: physician.id, revision: 1, accountRevision: 1,
  recordedById: admin.id, recordedBy: admin.username, recordedAt: time, digest: hash };
const draft: ContentDraft = { ingredientId: 'huang-qi', revision: 1, content: { ediblePart: '仅测试部位', latinName: '', educationText: '非专业资料', safetyText: '不用于诊疗', sourceRefs: [] },
  sources: [], digest: hash, baseReleaseId: 'test-release', authorId: 'test-editor', author: 'test-editor', createdAt: time,
  lockVersion: 3, state: 'editorial_accepted', ownerId: 'test-editor', owner: 'test-editor', updatedAt: time, visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false };
draft.digest = contentRevisionDigest(draft.baseReleaseId, draft.ingredientId, draft.content, draft.sources);
const review: ProfessionalReview = { ingredientId: draft.ingredientId, version: 1, contentRevision: 1, contentDigest: draft.digest, profession: 'tcm_physician', decision: 'approve',
  qualificationUserId: physician.id, qualificationRevision: 1, actorId: physician.id, actor: physician.username, accountRevision: 1, comment: '仅工程测试', recordedAt: time, digest: hash };
const facts = (reviews: ProfessionalReview[] = [], content: ContentDraft | undefined = structuredClone(draft)) => professionalDetail({ ingredientId: draft.ingredientId, draft: content,
  reviews, qualifications: [qualification], users: [physician], contributorIds: [] }, Date.parse(time));
const decision = (previous: ProfessionalDetail): ProfessionalDecisionInput => ({ profession: 'tcm_physician', decision: 'approve', contentRevision: 1, contentDigest: draft.digest,
  expectedLockVersion: 3, expectedReviewVersion: previous.reviewVersion, expectedQualificationRevision: 1, comment: ' 仅工程测试 ' });

test('account response explicitly projects valid fresh users, rejects extra fields, invalid epochs and duplicate identities', () => {
  const input = { items: [structuredClone(admin), structuredClone(physician)] };
  const parsed = parseAccountList(input); assert.deepEqual(parsed, input); parsed.items[0].username = 'changed'; assert.equal(input.items[0].username, admin.username);
  for (const value of [null, {}, { ...admin, password: 'must-not-pass' }, { ...admin, active: 1 }, { ...admin, role: 'root' }, { ...admin, revision: 0 }, { ...admin, createdAt: '2026-02-30T00:00:00.000Z' }]) assert.throws(() => parseAccount(value));
  assert.throws(() => parseAccountList({ items: [admin, admin] }));
  assert.throws(() => parseAccountList({ items: [admin, { ...physician, username: admin.username }] }));
});

test('qualification history binds even empty history, keeps expired records and validates bounded contiguous revisions', () => {
  assert.deepEqual(parseQualificationHistory({ userId: physician.id, items: [] }, physician.id), { userId: physician.id, items: [] });
  const expired = { ...qualification, validUntil: '2000-01-01T00:00:00.000Z' }; assert.deepEqual(parseQualification(expired, physician.id), expired);
  for (const value of [{ userId: 'another', items: [] }, { items: [] }, { userId: physician.id, items: [{ ...qualification, revision: 2 }] },
    { userId: physician.id, items: [qualification, qualification] }]) assert.throws(() => parseQualificationHistory(value, physician.id));
  for (const patch of [{ userId: 'other' }, { verificationConfirmed: false }, { digest: 'bad' }, { recordedAt: 'yesterday' }, { revision: 0 }, { comment: 'x'.repeat(1001) }]) assert.throws(() => parseQualification({ ...qualification, ...patch }, physician.id));
  const history = Array.from({ length: 20 }, (_, index) => ({ ...qualification, revision: 23 - index }));
  assert.equal(parseQualificationHistory({ userId: physician.id, items: history }, physician.id).items.length, 20);
  assert.throws(() => parseQualificationHistory({ userId: physician.id, items: history.slice(0, 19) }, physician.id));
});

test('qualification acknowledgement binds target account epoch, actor, exact submitted values and next revision', () => {
  const input = { ...qualification, evidenceReference: ` ${qualification.evidenceReference} `, comment: ` ${qualification.comment} ` };
  assert.deepEqual(parseSavedQualification(qualification, physician, 0, input, signed(admin)), qualification);
  for (const patch of [{ revision: 2 }, { accountRevision: 2 }, { recordedById: physician.id }, { recordedBy: 'substituted' }, { status: 'revoked' },
    { profession: 'pharmacist' }, { evidenceReference: 'substituted' }, { comment: 'substituted' }]) assert.throws(() => parseSavedQualification({ ...qualification, ...patch }, physician, 0, input, signed(admin)));
});

test('professional detail checks empty object identity, all history identities, state and false publication flags', () => {
  const absent = { ...facts(), draft: null }; assert.deepEqual(parseProfessionalDetail(absent, draft.ingredientId), absent);
  const recorded = facts([review]); assert.deepEqual(parseProfessionalDetail(recorded, draft.ingredientId), recorded);
  for (const value of [{ ...absent, ingredientId: 'jiang' }, { ...recorded, publicationEnabled: true }, { ...recorded, visibility: 'public' },
    { ...recorded, reviewVersion: 2 }, { ...recorded, reviews: [] }, { ...recorded, latestReviews: [] }, { ...recorded, state: 'pending' },
    { ...recorded, state: 'eligible_for_publication_approval', reasons: [] }, { ...recorded, reasons: ['tcm_physician:pending_or_revoked', 'pharmacist:pending_or_revoked'] },
    { ...recorded, latestReviews: [{ ...review, comment: 'substituted' }] }, { ...recorded, scope: 'prescription' }]) assert.throws(() => parseProfessionalDetail(value, draft.ingredientId));
  assert.throws(() => parseProfessionalReview({ ...review, actorId: 'another' }, draft.ingredientId));
  assert.equal(parseProfessionalReview({ ...review, decision: 'revoke', actorId: admin.id }, draft.ingredientId).qualificationUserId, physician.id);
});

test('latest professional opinion selects current revision, permits an outside-window record and keeps historical revoked approvals readable', () => {
  const reviews: ProfessionalReview[] = Array.from({ length: 23 }, (_, index) => ({ ...review, version: 23 - index, contentRevision: 2, decision: 'revoke' }));
  reviews[22] = { ...review, version: 1, contentRevision: 1, decision: 'approve' };
  const outside = facts(reviews); assert.equal(outside.latestReviews[0].version, 1); assert.equal(parseProfessionalDetail(outside, draft.ingredientId).reviews.length, 20);
  assert.throws(() => parseProfessionalDetail({ ...outside, latestReviews: [{ ...review, version: 10 }] }, draft.ingredientId));
  const revoked = facts([{ ...review, version: 24, decision: 'revoke' }, ...reviews]);
  assert.equal(revoked.state, 'recorded'); assert.equal(parseProfessionalDetail(revoked, draft.ingredientId).state, 'recorded');
  const changed = facts([review], { ...draft, revision: 2 }); assert.equal(parseProfessionalDetail(changed, draft.ingredientId).reasons[0], 'tcm_physician:content_changed');
});

test('professional read preserves a fixed-source gap without allowing acceptance or relaxing strict draft parsing', () => {
  // A transport gap remains inspectable without changing the server's own
  // digest/integrity checks or pretending this is a stored valid revision.
  const value = { ...facts(), draft: { ...draft, content: { ...draft.content, sourceRefs: [{ id: 'missing-fixed-source', revision: 1, locator: '第一段' }] } } };
  const parsed = parseProfessionalDetail(value, draft.ingredientId);
  assert.equal(hasFixedSourceReferences(parsed.draft!), false); assert.deepEqual(parsed.draft!.sources, []);
  assert.throws(() => parseContentDraft(parsed.draft, draft.ingredientId));
});

test('professional write acknowledgement binds actor, submitted opinion, unchanged draft and immutable previous history', () => {
  const before = facts(), next = facts([review]); assert.deepEqual(parseProfessionalDecision(next, draft.ingredientId, before, decision(before), signed(physician)), next);
  for (const patch of [{ actor: 'other' }, { accountRevision: 2 }, { comment: 'substituted' }, { contentDigest: `sha256:${'b'.repeat(64)}` }, { qualificationRevision: 2 }]) {
    const entry = { ...review, ...patch }; assert.throws(() => parseProfessionalDecision(facts([entry]), draft.ingredientId, before, decision(before), signed(physician)));
  }
  assert.throws(() => parseProfessionalDecision({ ...next, draft: { ...draft, content: { ...draft.content, educationText: 'changed' } } }, draft.ingredientId, before, decision(before), signed(physician)));
  const input = { ...decision(next), decision: 'revoke' as const }, revoke = { ...review, version: 2, decision: 'revoke' as const, actorId: admin.id, actor: admin.username };
  assert.deepEqual(parseProfessionalDecision(facts([revoke, review]), draft.ingredientId, next, input, signed(admin)), facts([revoke, review]));
  assert.throws(() => parseProfessionalDecision(facts([revoke, { ...review, comment: 'rewritten history' }]), draft.ingredientId, next, input, signed(admin)));
});

test('actual SQLite professional decisions and qualification changes pass parsers across two professions, historical windows, revocation and editorial revision', async () => {
  const fixture = await migrationFixture(undefined, false), catalog = new CatalogRepository(fixture.filename, fixture.seed);
  try {
    const auth = new AuthRepository(catalog.db), workflow = new WorkflowRepository(catalog.db), pro = await addProfessionalFixture({ auth, workflow }, fixture.admin);
    assert.deepEqual(parseAccountList({ items: auth.users() }).items, auth.users());
    for (const user of [pro.physician, pro.pharmacist]) assert.equal(parseQualificationHistory({ userId: user.id, items: workflow.qualificationHistory(user.id) }, user.id).items.length, 1);
    let previous = parseProfessionalDetail(workflow.professionalDetail('huang-qi'), 'huang-qi');
    for (const [person, kind] of [[pro.physician, 'tcm_physician'], [pro.pharmacist, 'pharmacist']] as const) {
      const input = await pro.input(kind); previous = parseProfessionalDecision(workflow.recordProfessionalReview('huang-qi', input, person), 'huang-qi', previous, input, signed(person));
    }
    for (let count = 0; count < 11; count++) for (const outcome of ['revoke', 'approve'] as const) {
      const person = outcome === 'revoke' ? fixture.admin : pro.physician, input = await pro.input('tcm_physician', outcome);
      previous = parseProfessionalDecision(workflow.recordProfessionalReview('huang-qi', input, person), 'huang-qi', previous, input, signed(person));
    }
    assert.equal(previous.reviews.length, 20); assert.equal(previous.latestReviews[1].version, 2);
    const revokedInput = { ...credentialInput('tcm_physician'), status: 'revoked' as const };
    const revoked = workflow.saveQualification(pro.physician.id, revokedInput, 1, fixture.admin);
    assert.deepEqual(parseSavedQualification(revoked, pro.physician, 1, revokedInput, signed(fixture.admin)), revoked);
    assert(parseProfessionalDetail(workflow.professionalDetail('huang-qi'), 'huang-qi').reasons.includes('tcm_physician:qualification_or_independence_changed'));
    const old = workflow.draft('huang-qi')!; workflow.saveDraft('huang-qi', { ...old.content, educationText: '下一内容修订，需重新审阅。' }, old.lockVersion, fixture.editor);
    assert(parseProfessionalDetail(workflow.professionalDetail('huang-qi'), 'huang-qi').reasons.every(reason => reason.endsWith('content_changed')));
  } finally { catalog.close(); fixture.dispose(); }
});
