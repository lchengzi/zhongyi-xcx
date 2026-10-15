import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ContentDraft, ContentRevision, DraftContent, ManagedSource, ReviewTask } from '../shared/contracts.js';
import { parseContentDraft, parseContentRevision, parseDraftDetail, parseDraftSubmission, parseIngredientPage, parseManagedSource, parseReviewTask, parseReviewTaskPage, parseSavedDraft, parseSourcePage } from '../shared/workflow-response.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { validateSeed } from '../server/seed.js';
import { hasFixedSourceReferences } from '../web/fixed-source-references.js';

const time = '2026-10-11T00:00:00.000Z', hash = `sha256:${'a'.repeat(64)}`;
const source: ManagedSource = { id: 'test-source', revision: 1, title: '仅测试来源', publisher: '测试机构', url: 'https://example.org/source',
  recordedBy: 'test-editor', recordedAt: time, verificationState: 'pending', visibility: 'private' };
const content: DraftContent = { ediblePart: '', latinName: '', educationText: '仅测试教育说明', safetyText: '非医疗资料', sourceRefs: [{ id: source.id, revision: 1, locator: '第一段\n第二行' }] };
const revision: ContentRevision = { ingredientId: 'huang-qi', revision: 1, content, sources: [source], digest: hash, baseReleaseId: 'test-release.1',
  authorId: 'test-editor', author: 'test-editor', createdAt: time };
const draft: ContentDraft = { ...revision, lockVersion: 1, state: 'draft', ownerId: 'test-editor', owner: 'test-editor', updatedAt: time,
  visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false };
const task: ReviewTask = { id: 'test-task', ingredientId: 'huang-qi', ingredientName: '黄芪', revision: 1, digest: hash, status: 'pending',
  submittedById: 'test-editor', submittedBy: 'test-editor', submittedAt: time, reviewedBy: null, reviewedAt: null, comment: null };
const detail = () => ({ draft: structuredClone(draft), revisions: [structuredClone(revision)], tasks: [structuredClone(task)], contributorIds: ['test-editor'] });

test('workflow response boundary returns fresh explicit data and accepts an initial empty draft detail', () => {
  const input = detail(), original = structuredClone(input); const parsed = parseDraftDetail(input, 'huang-qi');
  assert.deepEqual(parsed, input); parsed.draft!.content.sourceRefs[0].locator = 'changed'; parsed.revisions[0].sources[0].title = 'changed';
  assert.deepEqual(input, original);
  assert.deepEqual(parseDraftDetail({ draft: null, revisions: [], tasks: [], contributorIds: [] }, 'huang-qi'), { draft: null, revisions: [], tasks: [], contributorIds: [] });
  assert.deepEqual(parseManagedSource(source, { id: 'test-source', revision: 1 }), source);
});

test('draft boundary rejects missing/unknown fields, false approvals, unsafe versions and another ingredient', () => {
  for (const value of [null, [], {}, { ...draft, privateEvidence: 'must-not-pass' }, { ...draft, visibility: 'public' }, { ...draft, professionalReviewState: 'approved' },
    { ...draft, publicationEnabled: true }, { ...draft, revision: '1' }, { ...draft, lockVersion: 0 }, { ...draft, lockVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...draft, state: 'published' }, { ...draft, ingredientId: 'gou-qi-zi' }, { ...draft, digest: 'sha256:fake' }, { ...draft, updatedAt: '2026-02-30T00:00:00.000Z' },
    { ...draft, content: { ...content, educationText: 'x'.repeat(1601) } }, { ...draft, content: { ...content, sourceRefs: [...content.sourceRefs, ...content.sourceRefs] } }]) {
    assert.throws(() => parseContentDraft(value, 'huang-qi'));
  }
});

test('fixed sources reject substituted identities, versions, unsafe URLs and duplicate objects; revision gaps remain explicit', () => {
  for (const value of [{ ...source, url: 'javascript:alert(1)' }, { ...source, url: 'https://user:secret@example.org/a' }, { ...source, verificationState: 'verified' },
    { ...source, recordedAt: 'invalid' }, { ...source, revision: -1 }, { ...source, title: {} }]) assert.throws(() => parseManagedSource(value));
  assert.throws(() => parseManagedSource(source, { id: 'other' })); assert.throws(() => parseManagedSource(source, { id: source.id, revision: 2 }));
  for (const sources of [[{ ...source, revision: 2 }], [{ ...source, id: 'other' }], [source, source]]) assert.throws(() => parseContentRevision({ ...revision, sources }, 'huang-qi', 1));
  assert.throws(() => parseContentRevision(revision, 'huang-qi', 2));
  const missing = parseContentRevision({ ...revision, sources: [] }, 'huang-qi', 1);
  assert.equal(hasFixedSourceReferences(missing), false);
  assert.throws(() => parseContentDraft({ ...draft, sources: [] }, 'huang-qi'));
});

test('detail rejects mixed ingredients, duplicate history, inconsistent current draft and incomplete contributor protection', () => {
  const wrongTask = detail(); wrongTask.tasks[0].ingredientId = 'other'; assert.throws(() => parseDraftDetail(wrongTask, 'huang-qi'));
  const wrongRevision = detail(); wrongRevision.revisions[0].ingredientId = 'other'; assert.throws(() => parseDraftDetail(wrongRevision, 'huang-qi'));
  const changed = detail(); changed.revisions[0].content.educationText = 'different'; assert.throws(() => parseDraftDetail(changed, 'huang-qi'));
  for (const changed of [{ ...detail(), contributorIds: [] }, { ...detail(), contributorIds: ['test-editor', 'test-editor'] },
    { ...detail(), revisions: [revision, revision] }, { ...detail(), tasks: [task, task] }, { ...detail(), draft: null }, { ...detail(), revisions: [] }])
    assert.throws(() => parseDraftDetail(changed, 'huang-qi'));
});

test('save acknowledgement binds content after server trimming, versions and retained owner', () => {
  const input = { ...content, educationText: `  ${content.educationText}  ` };
  assert.deepEqual(parseSavedDraft(draft, 'huang-qi', null, input), draft);
  for (const changed of [{ ...draft, revision: 2 }, { ...draft, lockVersion: 2 }, { ...draft, state: 'submitted' },
    { ...draft, content: { ...content, educationText: 'substituted response' } }]) assert.throws(() => parseSavedDraft(changed, 'huang-qi', null, input));
  const next = { ...draft, revision: 2, lockVersion: 4 };
  const previous = { ...draft, lockVersion: 3, state: 'changes_requested' as const };
  assert.deepEqual(parseSavedDraft(next, 'huang-qi', previous, content), next);
  assert.throws(() => parseSavedDraft({ ...next, ownerId: 'other' }, 'huang-qi', previous, content));
});

test('submission and review task statuses are contextual, not an arbitrary string or another task', () => {
  const submitted = { ...draft, state: 'submitted' as const, lockVersion: 2 };
  assert.deepEqual(parseDraftSubmission({ draft: submitted, task }, 'huang-qi', draft), { draft: submitted, task });
  for (const changed of [{ ...task, ingredientId: 'other' }, { ...task, revision: 2 }, { ...task, digest: `sha256:${'b'.repeat(64)}` },
    { ...task, status: 'accepted' }, { ...task, reviewedBy: 'test-reviewer' }]) assert.throws(() => parseDraftSubmission({ draft: submitted, task: changed }, 'huang-qi', draft));
  assert.throws(() => parseDraftSubmission({ draft: { ...submitted, lockVersion: 9 }, task }, 'huang-qi', draft));
  assert.throws(() => parseReviewTask(task, 'other-task'));
  assert.throws(() => parseReviewTask({ ...task, status: 'accepted' }));
  assert.equal(parseReviewTask({ ...task, status: 'returned', reviewedBy: 'test-reviewer', reviewedAt: time, comment: '仅测试退回' }).status, 'returned');
});

test('paged responses reject malformed counts, wrong page/size/filter and duplicate source identities', () => {
  const sources = { items: [source], total: 1, page: 1, pageSize: 12 };
  assert.deepEqual(parseSourcePage(sources, { page: 1, pageSize: 12 }), sources);
  for (const changed of [{ ...sources, total: '1' }, { ...sources, total: 0 }, { ...sources, page: 2 }, { ...sources, pageSize: 5 },
    { ...sources, items: [source, source], total: 2 }, { ...sources, secret: 'unexpected' }]) assert.throws(() => parseSourcePage(changed, { page: 1, pageSize: 12 }));
  const tasks = { items: [task], total: 1, page: 1, pageSize: 12 };
  assert.deepEqual(parseReviewTaskPage(tasks, { page: 1, pageSize: 12, status: 'pending' }), tasks);
  assert.throws(() => parseReviewTaskPage(tasks, { page: 1, pageSize: 12, status: 'accepted' }));
});

test('current real catalog projection passes the workflow picker boundary without importing private research', () => {
  const seed = validateSeed(JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url), 'utf8')));
  const repo = new CatalogRepository(':memory:', seed);
  try {
    assert.equal(seed.ingredients.length, 106);
    for (let page = 1; page <= Math.ceil(seed.ingredients.length / 8); page++) {
      const result = repo.list('', page, 8);
      assert.deepEqual(parseIngredientPage(result, { page, pageSize: 8 }), result);
    }
  } finally { repo.close(); }
});

test('real SQLite workflow results pass across source versions, save, submit, return and acceptance', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url), 'utf8')));
  const repo = new CatalogRepository(':memory:', seed);
  try {
    const auth = new AuthRepository(repo.db), workflow = new WorkflowRepository(repo.db);
    const editor = await auth.createUser('response-editor', 'test-only-response-editor-password-2026', 'editor', 'test-fixture');
    const reviewer = await auth.createUser('response-reviewer', 'test-only-response-reviewer-password-2026', 'reviewer', 'test-fixture');
    assert.equal(parseDraftDetail(workflow.detail('huang-qi'), 'huang-qi').draft, null);
    const savedSource = parseManagedSource(workflow.saveSource({ title: source.title, publisher: source.publisher, url: source.url }, editor));
    const input: DraftContent = { ...content, sourceRefs: [{ id: savedSource.id, revision: 1, locator: '测试原文位置' }] };
    const first = parseSavedDraft(workflow.saveDraft('huang-qi', input, 0, editor), 'huang-qi', null, input);
    const submitted = parseDraftSubmission(workflow.submit('huang-qi', first.lockVersion, editor), 'huang-qi', first);
    assert.equal(parseDraftDetail(workflow.detail('huang-qi'), 'huang-qi').tasks[0].id, submitted.task.id);
    const returned = parseContentDraft(workflow.decide(submitted.task.id, 'return', '测试退回', submitted.draft.lockVersion, reviewer), 'huang-qi');
    assert.equal(returned.state, 'changes_requested');
    const second = parseSavedDraft(workflow.saveDraft('huang-qi', input, returned.lockVersion, editor), 'huang-qi', returned, input);
    const again = parseDraftSubmission(workflow.submit('huang-qi', second.lockVersion, editor), 'huang-qi', second);
    const accepted = parseContentDraft(workflow.decide(again.task.id, 'accept', '测试编辑通过，非专业批准', again.draft.lockVersion, reviewer), 'huang-qi');
    assert.equal(accepted.state, 'editorial_accepted'); assert.equal(accepted.publicationEnabled, false);
    const final = parseDraftDetail(workflow.detail('huang-qi'), 'huang-qi'); assert.equal(final.tasks.length, 2);
    assert.equal(parseReviewTaskPage(workflow.tasks('accepted', 1, 12), { status: 'accepted', page: 1, pageSize: 12 }).total, 1);
    const updatedSource = parseManagedSource(workflow.saveSource({ title: '新的测试标题', publisher: source.publisher, url: source.url }, editor, savedSource.id, 1), { id: savedSource.id, revision: 2 });
    assert.equal(updatedSource.revision, 2); assert.equal(parseDraftDetail(workflow.detail('huang-qi'), 'huang-qi').draft?.sources[0].revision, 1);
  } finally { repo.close(); }
});
