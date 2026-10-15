import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentDraft, DraftContent, ManagedSource, SessionInfo } from '../shared/contracts.js';
import { fixedSourceReferences, hasFixedSourceReferences } from '../web/fixed-source-references.js';
import { createApp } from '../server/app.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { fixtureSeed } from './fixture.js';

test('fixed source display follows reference identity and revision rather than response order', () => {
  const first: ManagedSource = { id: 'a', revision: 1, title: 'Fixture A', publisher: 'A', url: 'https://example.org/a',
    recordedBy: 'fixture', recordedAt: '2026-10-10T00:00:00.000Z', verificationState: 'pending', visibility: 'private' };
  const second = { ...first, id: 'b', title: 'Fixture B', url: 'https://example.org/b' };
  const refs = [{ id: 'a', revision: 1, locator: 'first\nsecond' }, { id: 'b', revision: 1, locator: 'other' }];
  const sources = [second, first], before = JSON.stringify([refs, sources]);
  const result = fixedSourceReferences(refs, sources);
  assert.equal(result[0].source, first); assert.equal(result[1].source, second);
  assert.equal(result[0].ref.locator, 'first\nsecond'); assert.equal(JSON.stringify([refs, sources]), before);
});
test('fixed source display never substitutes latest revisions or another source for a missing reference', () => {
  const source: ManagedSource = { id: 'a', revision: 2, title: 'Newer fixture', publisher: 'A', url: 'https://example.org/a',
    recordedBy: 'fixture', recordedAt: '2026-10-10T00:00:00.000Z', verificationState: 'pending', visibility: 'private' };
  const refs = [{ id: 'a', revision: 1, locator: 'keep locator' }, { id: 'b', revision: 2, locator: 'other' }];
  assert(fixedSourceReferences(refs, [source]).every(row => row.source === null));
  assert.equal(fixedSourceReferences(refs, [source])[0].ref.locator, 'keep locator');
});
test('ambiguous fixed sources are not linked and unreferenced sources do not become evidence', () => {
  const source: ManagedSource = { id: 'a', revision: 1, title: 'Fixture', publisher: 'A', url: 'https://example.org/a',
    recordedBy: 'fixture', recordedAt: '2026-10-10T00:00:00.000Z', verificationState: 'pending', visibility: 'private' };
  assert.equal(fixedSourceReferences([{ id: 'a', revision: 1, locator: '1' }], [source, { ...source }])[0].source, null);
  assert.deepEqual(fixedSourceReferences([], [source]), []);
});
test('review approval availability requires nonempty uniquely matched fixed sources', () => {
  const source: ManagedSource = { id: 'a', revision: 1, title: 'Fixture', publisher: 'A', url: 'https://example.org/a',
    recordedBy: 'fixture', recordedAt: '2026-10-10T00:00:00.000Z', verificationState: 'pending', visibility: 'private' };
  const snapshot: ContentDraft = { ingredientId: 'fixture', revision: 1, digest: 'sha256:fixture', baseReleaseId: 'fixture',
    authorId: 'fixture', author: 'fixture', createdAt: source.recordedAt, lockVersion: 1, state: 'submitted', ownerId: 'fixture',
    owner: 'fixture', updatedAt: source.recordedAt, visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false,
    content: { ediblePart: '', latinName: '', educationText: '', safetyText: '', sourceRefs: [{ id: 'a', revision: 1, locator: '1' }] }, sources: [source] };
  assert.equal(hasFixedSourceReferences(snapshot), true);
  assert.equal(hasFixedSourceReferences({ ...snapshot, sources: [] }), false);
  assert.equal(hasFixedSourceReferences({ ...snapshot, sources: [source, { ...source }] }), false);
  assert.equal(hasFixedSourceReferences({ ...snapshot, sources: [{ ...source, revision: 2 }] }), false);
  assert.equal(hasFixedSourceReferences({ ...snapshot, content: { ...snapshot.content, sourceRefs: [] } }), false);
});
const password = 'workflow-test-only-password-2026';
const origin = 'https://workflow.example.test';
type Identity = 'admin' | 'editor' | 'reviewer' | 'other-editor';
async function serve(repo: CatalogRepository) {
  const auth = new AuthRepository(repo.db);
  if (!auth.users().length) for (const [username, role] of [['admin', 'admin'], ['editor', 'editor'], ['reviewer', 'reviewer'], ['other-editor', 'editor']] as const) await auth.createUser(username, password, role, 'test-fixture');
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sessions: Record<string, { cookie: string; info: SessionInfo }> = {};
  for (const username of ['admin', 'editor', 'reviewer', 'other-editor']) {
    const response = await fetch(`${url}/api/v1/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    sessions[username] = { cookie: response.headers.get('set-cookie')!.split(';')[0], info: await response.json() };
  }
  const api = (path: string, actor: Identity = 'editor', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/v1${path}`, {
    method, headers: { Origin: origin, Cookie: sessions[actor].cookie, 'X-CSRF-Token': sessions[actor].info.csrfToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { api, sessions, close: async () => { const closed = once(server, 'close'); server.close(); await closed; } };
}
const sourceInput = { title: '测试来源（非正式材料）', publisher: '测试机构', url: 'https://example.org/workflow' };
const content = (source?: ManagedSource): DraftContent => ({ ediblePart: '部位待核对', latinName: '', educationText: '测试教育草稿，非正式资料。', safetyText: '仅测试，不能用于医疗判断。', sourceRefs: source ? [{ id: source.id, revision: source.revision, locator: '第 2 页，食材身份段落（测试）' }] : [] });

test('real HTTP source CRUD, private provenance, version pinning, literal search and optimistic conflict', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    assert.equal((await service.api('/editorial/sources', 'reviewer', 'POST', sourceInput)).status, 403);
    const response = await service.api('/editorial/sources', 'editor', 'POST', sourceInput); assert.equal(response.status, 201);
    const source = await response.json() as ManagedSource;
    assert.equal(source.revision, 1); assert.equal(source.verificationState, 'pending'); assert.equal(source.visibility, 'private'); assert.equal(source.recordedBy, 'editor');
    assert.equal((await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).status, 409);
    assert.equal((await service.api('/editorial/sources?q=%25')).status, 200);
    assert.equal((await (await service.api('/editorial/sources?q=%25')).json()).total, 0);
    assert.equal((await (await service.api('/editorial/sources?q=%E6%B5%8B%E8%AF%95&pageSize=1')).json()).total, 1);
    for (const query of ['page=0', 'q=a&q=b', 'status=x', 'pageSize=51']) assert.equal((await service.api(`/editorial/sources?${query}`)).status, 400);
    for (const bad of [{ ...sourceInput, url: 'javascript:alert(1)' }, { ...sourceInput, url: 'https://user:pass@example.org' }, { ...sourceInput, title: '' }, { ...sourceInput, verificationState: 'reviewed' }, { ...sourceInput, publisher: {} }]) {
      assert.equal((await service.api('/editorial/sources', 'editor', 'POST', bad)).status, 400);
    }
    const draftResponse = await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 }); assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    const updates = await Promise.all([1, 2].map((index) => service.api(`/editorial/sources/${source.id}`, 'editor', 'PUT', { source: { ...sourceInput, title: `新标题 ${index}` }, expectedRevision: 1 })));
    assert.deepEqual(updates.map((item) => item.status).sort(), [200, 409]);
    const current = await (await service.api(`/editorial/sources/${source.id}`)).json(); assert.equal(current.revision, 2);
    assert.equal((await (await service.api(`/editorial/sources/${source.id}?revision=1`)).json()).title, source.title);
    const after = await (await service.api('/editorial/ingredients/huang-qi')).json();
    assert.equal(after.draft.sources[0].title, source.title); assert.equal(after.draft.sources[0].revision, 1); assert.equal(after.draft.digest, draft.digest);
    assert.throws(() => repo.db.prepare('UPDATE source_versions SET title = ? WHERE source_id = ?').run('tampered', source.id), /immutable/);
    const events = await (await service.api('/editorial/events')).json(); assert.equal(events.items.length, 3); assert.equal(events.items[0].actor, 'editor');
  } finally { await service.close(); repo.close(); }
});

test('draft → submit → return → new revision → accept remains private and professionally pending', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    const source = await (await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).json();
    assert.equal((await (await service.api('/editorial/ingredients/huang-qi')).json()).draft, null);
    let draft: ContentDraft = await (await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 })).json();
    assert.equal(draft.revision, 1); assert.equal(draft.lockVersion, 1); assert.equal(draft.state, 'draft');
    assert.equal((await service.api('/editorial/ingredients/huang-qi', 'other-editor', 'PUT', { content: content(source), expectedLockVersion: 1 })).status, 403);
    assert.equal((await service.api('/editorial/ingredients/huang-qi', 'reviewer', 'PUT', { content: content(source), expectedLockVersion: 1 })).status, 403);
    let submitted = await (await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: draft.lockVersion })).json();
    assert.equal(submitted.draft.lockVersion, 2); assert.equal(submitted.task.digest, draft.digest);
    assert.equal((await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 2 })).status, 409);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: 2 })).status, 409);
    assert.equal((await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'editor', 'POST', { decision: 'accept', comment: '不能自己审核', expectedLockVersion: 2 })).status, 403);
    const returnedResponse = await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'reviewer', 'POST', { decision: 'return', comment: '补充明确的出处定位', expectedLockVersion: 2 });
    assert.equal(returnedResponse.status, 200); draft = await returnedResponse.json(); assert.equal(draft.state, 'changes_requested'); assert.equal(draft.lockVersion, 3);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: 3 })).status, 409);
    const revisedContent = { ...content(source), educationText: '补充后的测试资料，仍未专业签审。' };
    draft = await (await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: revisedContent, expectedLockVersion: 3 })).json();
    assert.equal(draft.revision, 2); assert.equal(draft.lockVersion, 4); assert.equal(draft.state, 'draft');
    submitted = await (await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: 4 })).json();
    assert.equal(submitted.task.revision, 2); assert.equal(submitted.draft.lockVersion, 5);
    assert.equal((await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'reviewer', 'POST', { decision: 'accept', comment: 'stale', expectedLockVersion: 2 })).status, 409);
    const decisions = await Promise.all(['accept', 'return'].map((decision) => service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'reviewer', 'POST', { decision, comment: '资料整理质量检查（非专业审校）', expectedLockVersion: 5 })));
    assert.deepEqual(decisions.map((result) => result.status).sort(), [200, 409]);
    const success = decisions.find((result) => result.status === 200)!; draft = await success.json();
    assert.equal(draft.professionalReviewState, 'pending'); assert.equal(draft.visibility, 'private'); assert.equal(draft.publicationEnabled, false);
    assert.equal(repo.ingredient('huang-qi')?.professionalReviewState, 'pending'); assert.equal(repo.ingredient('huang-qi')?.ediblePart, '待核对');
    const detail = await (await service.api('/editorial/ingredients/huang-qi')).json(); assert.equal(detail.revisions.length, 2); assert.equal(detail.tasks.length, 2);
    assert.equal(detail.revisions[1].content.educationText, content(source).educationText);
    assert.throws(() => repo.db.prepare('UPDATE content_revisions SET payload = ?').run('{}'), /immutable/);
    assert.throws(() => repo.db.prepare('DELETE FROM revision_sources').run(), /immutable/);
    assert.equal((await service.api('/public/ingredients/huang-qi')).status, 404);
    assert.equal((await service.api('/publish', 'admin', 'POST', { ingredientId: 'huang-qi' })).status, 404);
    assert.equal((await (await service.api('/summary')).json()).publicationEnabled, false);
    const notes = await (await service.api('/ingredients/huang-qi')).json(); assert.ok(!JSON.stringify(notes).includes(revisedContent.educationText));
  } finally { await service.close(); repo.close(); }
});

test('strict bodies, references, completeness, source/decision forgery, RBAC and CSRF are enforced', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    const put = (body: unknown) => service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', body);
    const draftBody = { content: content(), expectedLockVersion: 0 };
    for (const body of [null, [], { ...draftBody, professionalReviewState: 'reviewed' }, { ...draftBody, expectedLockVersion: -1 }, { ...draftBody, content: { ...content(), publishable: true } }, { ...draftBody, content: { ...content(), educationText: 'x'.repeat(1601) } }, { ...draftBody, content: { ...content(), sourceRefs: [{ id: 'unknown', revision: 1, locator: 'page1' }] } }]) assert.equal((await put(body)).status, 400);
    assert.equal((await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', draftBody, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', draftBody, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await put(draftBody)).status, 200);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: 1 })).status, 400);
    const source = await (await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).json();
    const ref = { id: source.id, revision: 1, locator: '页1' };
    for (const refs of [[ref, ref], [{ ...ref, locator: '' }], [{ ...ref, revision: 99 }], [{ ...ref, revision: 1.5 }], [{ ...ref, verified: true }]]) {
      assert.equal((await put({ content: { ...content(), sourceRefs: refs }, expectedLockVersion: 1 })).status, 400);
    }
    assert.equal((await service.api('/editorial/ingredients/no-such-id', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 })).status, 404);
    assert.equal((await service.api('/editorial/tasks?status=published')).status, 400);
    assert.equal((await service.api('/editorial/sources/no-id')).status, 404);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/revisions/0')).status, 400);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/revisions/99')).status, 404);
    const saved = await (await put({ content: content(source), expectedLockVersion: 1 })).json();
    const submitted = await (await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: saved.lockVersion })).json();
    for (const body of [{ decision: 'publish', comment: 'no', expectedLockVersion: submitted.draft.lockVersion }, { decision: {}, comment: 'no', expectedLockVersion: 1 }, { decision: 'accept', comment: '', expectedLockVersion: 1 }, { decision: 'accept', comment: 'ok', expectedLockVersion: submitted.draft.lockVersion, professionalReviewState: 'reviewed' }]) {
      assert.equal((await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'reviewer', 'POST', body)).status, 400);
    }
    // Request limit is separate from P1 note limit; support valid Unicode drafts without silently truncating.
    assert.equal((await service.api('/editorial/sources', 'editor', 'POST', { ...sourceInput, title: 'x'.repeat(40000) })).status, 413);
    const refs = [];
    for (let index = 0; index < 10; index++) {
      const reference = await (await service.api('/editorial/sources', 'editor', 'POST', { ...sourceInput, url: `https://example.org/unicode/${index}` })).json();
      refs.push({ id: reference.id, revision: 1, locator: '段'.repeat(400) });
    }
    const maxUnicode = { ediblePart: '部'.repeat(200), latinName: 'a'.repeat(200), educationText: '教'.repeat(1600), safetyText: '安'.repeat(1000), sourceRefs: refs };
    assert.equal((await service.api('/editorial/ingredients/gou-qi-zi', 'editor', 'PUT', { content: maxUnicode, expectedLockVersion: 0 })).status, 200);
  } finally { await service.close(); repo.close(); }
});

test('administrators who contributed cannot self-review, while independent reviewers can accept privately', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    const source = await (await service.api('/editorial/sources', 'admin', 'POST', sourceInput)).json();
    const draft = await (await service.api('/editorial/ingredients/huang-qi', 'admin', 'PUT', { content: content(source), expectedLockVersion: 0 })).json();
    const submitted = await (await service.api('/editorial/ingredients/huang-qi/submit', 'admin', 'POST', { expectedLockVersion: draft.lockVersion })).json();
    const decision = { decision: 'accept', comment: '仅编辑质量检查，不是专业签审', expectedLockVersion: submitted.draft.lockVersion };
    assert.equal((await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'admin', 'POST', decision)).status, 403);
    const accepted = await service.api(`/editorial/tasks/${submitted.task.id}/decision`, 'reviewer', 'POST', decision); assert.equal(accepted.status, 200);
    const state = await accepted.json(); assert.equal(state.state, 'editorial_accepted'); assert.equal(state.professionalReviewState, 'pending'); assert.equal(state.publicationEnabled, false);
    assert.equal((await (await service.api('/editorial/tasks?status=accepted')).json()).items[0].comment, decision.comment);
    const revised = await (await service.api('/editorial/ingredients/huang-qi', 'admin', 'PUT', { content: { ...content(source), educationText: '新版本' }, expectedLockVersion: state.lockVersion })).json();
    assert.equal(revised.state, 'draft'); assert.equal(revised.revision, 2);
    assert.equal((await (await service.api(`/editorial/tasks/${submitted.task.id}`)).json()).status, 'accepted');
    assert.equal((await (await service.api('/editorial/ingredients/huang-qi/revisions/1')).json()).content.educationText, content(source).educationText);
    const historySource = await (await service.api('/editorial/ingredients/gou-qi-zi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 })).json();
    let head = await (await service.api('/editorial/ingredients/gou-qi-zi', 'admin', 'PUT', { content: content(source), expectedLockVersion: historySource.lockVersion })).json();
    for (let index = 3; index <= 23; index++) head = await (await service.api('/editorial/ingredients/gou-qi-zi', 'editor', 'PUT', { content: { ...content(source), educationText: `测试历史修订 ${index}` }, expectedLockVersion: head.lockVersion })).json();
    const longHistory = await (await service.api('/editorial/ingredients/gou-qi-zi')).json();
    assert.equal(longHistory.revisions.length, 20); assert.ok(longHistory.revisions.every((item: { author: string }) => item.author !== 'admin'));
    assert.ok(longHistory.contributorIds.includes(service.sessions.admin.info.user.id));
    const longTask = await (await service.api('/editorial/ingredients/gou-qi-zi/submit', 'editor', 'POST', { expectedLockVersion: head.lockVersion })).json();
    assert.equal((await service.api(`/editorial/tasks/${longTask.task.id}/decision`, 'admin', 'POST', { decision: 'accept', comment: '不能越过 20 条历史自审', expectedLockVersion: longTask.draft.lockVersion })).status, 403);
    const actor = service.sessions.admin.info.user;
    await new AuthRepository(repo.db).createUser('admin-backup', password, 'admin', 'test-fixture');
    new AuthRepository(repo.db).updateUser(actor.id, 'editor', true, actor.revision, 'test-other-admin');
    assert.throws(() => new WorkflowRepository(repo.db).saveSource({ ...sourceInput, url: 'https://example.org/stale-actor' }, actor), /权限已变化/);
  } finally { await service.close(); repo.close(); }
});

test('workflow transactions roll back failures and detect mismatched source snapshots before submission', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
  try {
    repo.db.exec("CREATE TRIGGER test_fail_workflow BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'test transaction failure'); END;");
    assert.equal((await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).status, 500);
    assert.equal(repo.db.prepare('SELECT COUNT(*) count FROM source_records').get()?.count, 0);
    assert.equal(repo.db.prepare('SELECT COUNT(*) count FROM source_versions').get()?.count, 0);
    repo.db.exec('DROP TRIGGER test_fail_workflow');
    const source = await (await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).json();
    const draft = await (await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 })).json();
    // Simulate out-of-band damage (not an API operation). The binding must still refuse submission.
    const extra = await (await service.api('/editorial/sources', 'editor', 'POST', { ...sourceInput, url: 'https://example.org/extra' })).json();
    repo.db.prepare('INSERT INTO revision_sources VALUES (?, ?, ?, ?, ?, ?)').run('huang-qi', 1, extra.id, 1, 'tamper', 1);
    assert.equal((await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: draft.lockVersion })).status, 409);
    assert.equal(new WorkflowRepository(repo.db).tasks('pending', 1, 12).total, 0);
  } finally { await service.close(); repo.close(); }
});

test('complete HTTP/database restart preserves draft, pinned sources, tasks and old notes; local keys cannot enter workflow', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-workflow-test-')); const filename = join(directory, 'test.sqlite');
  try {
    const repo = new CatalogRepository(filename, fixtureSeed()); const service = await serve(repo);
    let digest = '';
    try {
      repo.saveNote('huang-qi', '旧备注保持独立', 0);
      const source = await (await service.api('/editorial/sources', 'editor', 'POST', sourceInput)).json();
      const draft = await (await service.api('/editorial/ingredients/huang-qi', 'editor', 'PUT', { content: content(source), expectedLockVersion: 0 })).json(); digest = draft.digest;
      assert.equal((await service.api('/editorial/ingredients/huang-qi/submit', 'editor', 'POST', { expectedLockVersion: draft.lockVersion })).status, 200);
    } finally { await service.close(); repo.close(); }
    const reopened = new CatalogRepository(filename, fixtureSeed()); const next = await serve(reopened);
    try {
      const detail = await (await next.api('/editorial/ingredients/huang-qi')).json();
      assert.equal(detail.draft.digest, digest); assert.equal(detail.draft.state, 'submitted'); assert.equal(detail.tasks[0].revision, 1);
      assert.equal(detail.draft.sources[0].title, sourceInput.title); assert.equal(reopened.note('huang-qi').text, '旧备注保持独立');
      assert.equal(reopened.db.prepare('SELECT COUNT(*) count FROM migrations WHERE version = 3').get()?.count, 1);
      assert.equal((await next.api('/editorial/ingredients/huang-qi', 'editor', 'GET', undefined, { Cookie: '' })).status, 401);
    } finally { await next.close(); reopened.close(); }
    const localRepo = new CatalogRepository(':memory:', fixtureSeed()); const token = 'test-local-editor-token-with-32-characters';
    const localServer = createApp(localRepo, token).listen(0, '127.0.0.1'); await once(localServer, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${(localServer.address() as AddressInfo).port}/api/v1/editorial/sources`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 403);
    } finally { const closed = once(localServer, 'close'); localServer.close(); await closed; localRepo.close(); }
  } finally { unlinkSync(filename); rmdirSync(directory); }
});
