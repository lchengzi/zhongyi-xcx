import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, ManagedSource, PublicationPreflight, SessionInfo, SourceCheck, SourceCheckDetail } from '../shared/contracts.js';
import { parsePublicationPreflight, parseSavedSourceCheck, parseSourceCheck, parseSourceCheckDetail } from '../shared/source-check-response.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { fixtureSeed } from './fixture.js';
import { sourceCheckInput } from './source-check-fixture.js';

const time = '2026-10-11T00:00:00.000Z', hash = `sha256:${'a'.repeat(64)}`;
const source: ManagedSource = { id: 'source-test', revision: 1, title: '仅工程测试', publisher: '测试机构', url: 'https://example.org/test', recordedBy: 'test-editor', recordedAt: time, visibility: 'private', verificationState: 'pending' };
const actor: Account = { id: 'test-reviewer', username: 'test-reviewer', role: 'reviewer', revision: 1, active: true, createdAt: time };
const session: SessionInfo = { user: actor, csrfToken: 'test-only', expiresAt: time };
const check: SourceCheck = { sourceId: source.id, sourceRevision: 1, sourceDigest: hash, version: 1, decision: 'verified', evidenceKind: 'test-fixture', ingredientIds: ['huang-qi'],
  domains: ['identity'], authority: 'reference', checkedAt: time, validUntil: '2026-10-12T00:00:00.000Z', evidenceReference: 'test-only', comment: '仅工程测试核验', verificationConfirmed: true,
  actorId: actor.id, actor: actor.username, accountRevision: 1, recordedAt: time, digest: hash };
const empty = (): SourceCheckDetail => ({ source: structuredClone(source), sourceDigest: hash, checkVersion: 0, checks: [], latest: null, state: 'pending', reasons: ['source_check_missing'], publicationEnabled: false, visibility: 'private' });
const recorded = (): SourceCheckDetail => ({ ...empty(), checkVersion: 1, checks: [structuredClone(check)], latest: structuredClone(check), state: 'recorded', reasons: ['source_check_test_fixture'] });
const context = { id: source.id, revision: 1 };
const preflight = (): PublicationPreflight => ({ ingredientId: 'huang-qi', contentRevision: null, contentDigest: null, baseReleaseId: null, lockVersion: 0, professionalReviewVersion: 0,
  sources: [], missingDomains: ['identity', 'edible_part', 'processing', 'safety_boundary', 'directory_scope'], reasons: ['content_missing', 'professional_review_required', 'source_references_required', 'source_domains_incomplete', 'official_directory_scope_required'],
  readyForReleaseApproval: false, publicationEnabled: false, visibility: 'private' });

test('source responses reconstruct fresh private data; invalid structures, scope and dates are rejected', () => {
  assert.deepEqual(parseSourceCheckDetail(empty(), context), empty());
  const input = recorded(), result = parseSourceCheckDetail(input, context);
  assert.deepEqual(result, input); result.latest!.ingredientIds[0] = 'jiang'; result.source.title = 'changed'; assert.deepEqual(input, recorded());
  for (const value of [null, {}, { ...check, extra: 'private-unexpected' }, { ...check, sourceId: 'other' }, { ...check, version: '1' },
    { ...check, sourceDigest: 'bad' }, { ...check, domains: ['identity', 'identity'] }, { ...check, domains: [] }, { ...check, ingredientIds: ['huang-qi', 'huang-qi'] },
    { ...check, checkedAt: '2026-02-30T00:00:00.000Z' }, { ...check, validUntil: time }, { ...check, verificationConfirmed: false }, { ...check, comment: 'x'.repeat(1001) }])
    assert.throws(() => parseSourceCheck(value, source.id));
});

test('source detail binds selected version, latest record, global history and test-only state', () => {
  for (const value of [{ ...recorded(), publicationEnabled: true }, { ...recorded(), visibility: 'public' }, { ...recorded(), state: 'verified', reasons: [] },
    { ...recorded(), checkVersion: 2 }, { ...recorded(), checks: [] }, { ...recorded(), latest: null }, { ...recorded(), reasons: [] },
    { ...recorded(), latest: { ...check, sourceRevision: 2 } }, { ...recorded(), latest: { ...check, comment: 'substituted' } },
    { ...empty(), state: 'verified', reasons: [] }, { ...recorded(), latest: { ...check, sourceDigest: `sha256:${'b'.repeat(64)}` } }])
    assert.throws(() => parseSourceCheckDetail(value, context));
  assert.throws(() => parseSourceCheckDetail(recorded(), { id: 'other', revision: 1 }));
  assert.throws(() => parseSourceCheckDetail(recorded(), { ...context, revision: 2 }));
  const historical = { ...recorded(), checkVersion: 22, checks: Array.from({ length: 20 }, (_, index) => ({ ...check, version: 22 - index, sourceRevision: 2 })) };
  assert.equal(parseSourceCheckDetail(historical, context).latest?.version, 1);
  assert.throws(() => parseSourceCheckDetail({ ...historical, latest: { ...check, version: 10 } }, context));
  const pendingHistorical = { ...historical, latest: null, state: 'pending', reasons: ['source_check_missing'] };
  assert.equal(parseSourceCheckDetail(pendingHistorical, context).latest, null);
});

test('source save acknowledgement binds exact submitted values, actor and next collaboration version', () => {
  const input = { ...check, evidenceReference: ' test-only ', comment: ' 仅工程测试核验 ' };
  assert.deepEqual(parseSavedSourceCheck(recorded(), empty(), input, session), recorded());
  for (const patch of [{ comment: 'substituted' }, { actorId: 'other' }, { accountRevision: 2 }, { domains: ['processing'] }, { ingredientIds: ['jiang'] }]) {
    const latest = { ...check, ...patch }; assert.throws(() => parseSavedSourceCheck({ ...recorded(), latest, checks: [latest] }, empty(), input, session));
  }
  assert.throws(() => parseSavedSourceCheck(recorded(), recorded(), input, session));
  assert.throws(() => parseSavedSourceCheck({ ...recorded(), source: { ...source, title: 'substituted' } }, empty(), input, session));
});

test('preflight binds ingredient, no-content tuple and reason/readiness consistency without granting publication', () => {
  assert.deepEqual(parsePublicationPreflight(preflight(), 'huang-qi'), preflight());
  for (const value of [null, {}, { ...preflight(), ingredientId: 'jiang' }, { ...preflight(), contentRevision: 1 }, { ...preflight(), contentDigest: hash },
    { ...preflight(), lockVersion: 1 }, { ...preflight(), readyForReleaseApproval: true }, { ...preflight(), missingDomains: [] },
    { ...preflight(), reasons: ['unknown'] }, { ...preflight(), publicationEnabled: true }, { ...preflight(), extra: 'unexpected' }])
    assert.throws(() => parsePublicationPreflight(value, 'huang-qi'));
  const ready: PublicationPreflight = { ...preflight(), contentRevision: 1, contentDigest: hash, baseReleaseId: 'test-release', lockVersion: 3, professionalReviewVersion: 2,
    sources: [{ sourceId: source.id, sourceRevision: 1, checkVersion: 1, checkDigest: hash, ready: true, reasons: [] }], missingDomains: [], reasons: [], readyForReleaseApproval: true };
  assert.deepEqual(parsePublicationPreflight(ready, 'huang-qi'), ready);
  assert.equal(parsePublicationPreflight(ready, 'huang-qi').publicationEnabled, false);
  for (const value of [{ ...ready, professionalReviewVersion: 0 }, { ...ready, sources: [...ready.sources, ...ready.sources] }, { ...ready, sources: [{ ...ready.sources[0], checkDigest: null }] },
    { ...ready, sources: [{ ...ready.sources[0], reasons: ['source_check_test_fixture'] }] }, { ...ready, sources: [{ ...ready.sources[0], ready: false }] }])
    assert.throws(() => parsePublicationPreflight(value, 'huang-qi'));
});

test('actual SQLite source checks pass through fixture, historical revisions outside window, revocation and preflight', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const auth = new AuthRepository(repo.db), workflow = new WorkflowRepository(repo.db);
    const editor = await auth.createUser('source-response-editor', 'test-only-source-response-password-2026', 'editor', 'test-fixture');
    const reviewer = await auth.createUser('source-response-reviewer', 'test-only-source-response-password-2026', 'reviewer', 'test-fixture');
    const source = workflow.saveSource({ title: '来源核验响应工程测试', publisher: '测试机构', url: 'https://example.org/source-response' }, editor);
    let prior = parseSourceCheckDetail(workflow.sourceCheck(source.id, 1), { id: source.id, revision: 1 }); const input = sourceCheckInput(source);
    const credential: SessionInfo = { ...session, user: reviewer };
    let next = parseSavedSourceCheck(workflow.saveSourceCheck(source.id, input, 0, reviewer), prior, input, credential);
    assert.equal(next.state, 'recorded');
    const updated = workflow.saveSource({ title: '新修订', publisher: source.publisher, url: source.url }, editor, source.id, 1);
    prior = parseSourceCheckDetail(workflow.sourceCheck(source.id, 2), { id: source.id, revision: 2 }); assert.equal(prior.latest, null); assert.equal(prior.checkVersion, 1);
    for (let index = 1; index <= 21; index++) workflow.saveSourceCheck(source.id, sourceCheckInput(updated), index, reviewer);
    next = parseSourceCheckDetail(workflow.sourceCheck(source.id, 1), { id: source.id, revision: 1 }); assert.equal(next.checks.length, 20); assert.equal(next.latest?.version, 1);
    const revoke = { ...input, decision: 'revoke' as const }; next = parseSavedSourceCheck(workflow.saveSourceCheck(source.id, revoke, 22, reviewer), next, revoke, credential);
    assert.equal(next.state, 'revoked'); assert.equal(next.checkVersion, 23);
    assert.deepEqual(parsePublicationPreflight(workflow.publicationPreflight('huang-qi'), 'huang-qi'), workflow.publicationPreflight('huang-qi'));
    workflow.saveDraft('huang-qi', { ediblePart: '仅测试', latinName: '', educationText: '仅测试教育内容', safetyText: '不用于诊疗', sourceRefs: [{ id: source.id, revision: 2, locator: '第一段' }] }, 0, editor);
    const checked = parsePublicationPreflight(workflow.publicationPreflight('huang-qi'), 'huang-qi'); assert.equal(checked.sources[0].ready, false); assert(checked.sources[0].reasons.includes('source_check_test_fixture'));
  } finally { repo.close(); }
});
