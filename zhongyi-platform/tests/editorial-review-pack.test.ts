import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseEditorialReviewPack, prepareEditorialReviewDemo } from '../server/editorial-review-pack.js';
import { fixtureSeed } from './fixture.js';
import { editorialReviewHtml } from '../server/editorial-review-html.js';

function sample() {
  return { schemaVersion: 'private-editorial-pack.1', visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false, externalAiEnabled: false,
    sources: [{ key: 'engineering-source', input: { title: '工程模拟来源', publisher: 'Test fixture', url: 'https://example.test/engineering-only' }, accessedOn: '2026-10-13', evidenceNote: '仅验证材料导入，不是专业意见或真实资料。' }],
    drafts: [{ ingredientId: 'huang-qi', content: { ediblePart: '工程部位，非正式资料', latinName: '', educationText: '工程私有草稿，不是食材说明。', safetyText: '待独立核验，不得发布或据此食用。', sourceRefs: [{ id: 'engineering-source', revision: 1, locator: '工程章节' }] } }] };
}
function fixture() {
  const parent = resolve('.local/editorial-review-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'run-')); mkdirSync(join(root, 'data')); mkdirSync(join(root, '.local'));
  writeFileSync(join(root, 'data/catalog.seed.json'), JSON.stringify(fixtureSeed()), { flag: 'wx' });
  const working = join(root, '.local/editorial.sqlite'); writeFileSync(working, 'owned test sentinel, never open as SQL', { flag: 'wx' });
  return { root, working };
}
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('private review pack strictly rejects approval/AI flags, unknown fields, duplicate keys and unpinned references', () => {
  const raw = sample(); assert.equal(parseEditorialReviewPack(raw).drafts[0]!.content.sourceRefs[0]!.id, 'engineering-source');
  for (const input of [{ ...raw, publicationEnabled: true }, { ...raw, externalAiEnabled: true }, { ...raw, professionalReviewState: 'approved' }, { ...raw, dbPath: 'working.sqlite' },
    { ...raw, sources: [...raw.sources, ...raw.sources] }, { ...raw, drafts: [...raw.drafts, ...raw.drafts] },
    { ...raw, sources: [{ ...raw.sources[0], accessedOn: '2026-02-30' }] },
    { ...raw, sources: [{ ...raw.sources[0], input: { ...raw.sources[0]!.input, url: 'http://example.test/not-https' } }] },
    { ...raw, drafts: [{ ...raw.drafts[0], content: { ...raw.drafts[0]!.content, sourceRefs: [{ id: 'unknown', revision: 1, locator: 'x' }] } }] },
    { ...raw, drafts: [{ ...raw.drafts[0], content: { ...raw.drafts[0]!.content, sourceRefs: [{ id: 'engineering-source', revision: 2, locator: 'x' }] } }] }]) assert.throws(() => parseEditorialReviewPack(input));
});

test('review preparation creates new owned stores with private draft/source history and no review, approval, task, session or AI records', async () => {
  const f = fixture(), before = digest(f.working), raw = sample();
  const one = await prepareEditorialReviewDemo(f.root, raw), two = await prepareEditorialReviewDemo(f.root, raw);
  assert.notEqual(one.demoId, two.demoId); assert.equal(digest(f.working), before);
  for (const prepared of [one, two]) {
    const db = new DatabaseSync(join(prepared.directory, 'editorial.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'localDemoId'").get()!.value, prepared.demoId);
      assert.equal(db.prepare('SELECT count(*) n FROM source_versions').get()!.n, 1);
      assert.equal(db.prepare('SELECT count(*) n FROM content_revisions').get()!.n, 1);
      assert.equal(db.prepare('SELECT state FROM content_drafts').get()!.state, 'draft');
      const payload = JSON.parse(String(db.prepare('SELECT payload FROM content_revisions').get()!.payload));
      assert.equal(payload.educationText, raw.drafts[0]!.content.educationText);
      assert.notEqual(payload.sourceRefs[0].id, 'engineering-source'); assert.equal(payload.sourceRefs[0].revision, 1);
      for (const table of ['source_checks', 'professional_qualifications', 'professional_reviews', 'review_tasks', 'publication_snapshots', 'publication_approvals', 'publication_events', 'assistant_events', 'editorial_excerpts', 'sessions']) {
        assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0, table);
      }
      assert.equal(db.prepare('SELECT count(*) n FROM ingredients').get()!.n, 3);
    } finally { db.close(); }
    assert.equal(JSON.parse(readFileSync(join(prepared.directory, 'review-pack-report.json'), 'utf8')).publicationEnabled, false);
    const credentials = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts;
    assert(credentials.every((value: { password: string }) => !JSON.stringify(prepared.report).includes(value.password)));
  }
});

test('unknown catalog targets are rejected before provisioning any demo or opening the working sentinel', async () => {
  const f = fixture(), raw = sample(), before = digest(f.working); raw.drafts[0]!.ingredientId = 'not-in-owned-catalog';
  await assert.rejects(prepareEditorialReviewDemo(f.root, raw));
  assert.equal(existsSync(join(f.root, '.local/local-demo')), false); assert.equal(digest(f.working), before);
});

test('private handoff renders source limits as escaped text without script, image, credentials or approval controls', () => {
  const raw = sample(); raw.drafts[0]!.content.educationText = '<script>alert("x")</script> & test';
  raw.sources[0]!.evidenceNote = '<img src="https://example.test/track">';
  const html = editorialReviewHtml(parseEditorialReviewPack(raw));
  assert(html.includes('&lt;script&gt;') && html.includes('&lt;img'));
  assert(!/<script|<img|<form|<button/i.test(html));
  assert(html.includes('default-src &#39;none&#39;') || html.includes("default-src 'none'"));
  assert(html.includes('尚未完成专业审校，未获发布批准')); assert(html.includes('不随工作台后续修改自动更新'));
  assert(!html.includes('credentials.json'));
});
