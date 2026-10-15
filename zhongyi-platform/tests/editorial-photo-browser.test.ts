import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect, type Page } from '@playwright/test';
import { prepareEditorialReviewDemo, readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import type { DemoCredential } from '../server/local-demo.js';
import { launchDemoCli } from './local-demo-process.js';

declare global { interface Window { __draftPhotoEvidence?: { created: string[]; revoked: string[] } } }

// Explicit local material acceptance, not a CI dependency on private research,
// a professional signature or a miniature replacement for the public product.
test('actual common-food drafts and prepared photos share the normal account-only editor without publication', async () => {
  const root = resolve('.'), assetRoot = resolve('../zhongyi/content-private/research-refresh');
  const edition = process.env.EDITORIAL_REVIEW_EDITION ?? 'common-foods-v2';
  assert(['common-foods-v2', 'primary-20261014'].includes(edition), 'Unknown local review edition');
  const packFile = edition === 'primary-20261014' ? '2026-10-14-common-foods-draft-pack-v3.json' : '2026-10-13-common-foods-draft-pack-v2.json';
  const raw = readEditorialReviewPack(join(assetRoot, packFile));
  const photos = { manifest: join(assetRoot, '2026-10-13-private-preview-common-foods-v2.json'), derivatives: resolve('.local/photo-derivatives/run-7ed21d9d-b89f-4a75-8557-b7fcd309d161') };
  const registry = new PrivatePhotoRegistry(assetRoot, photos.manifest), prepared = await prepareEditorialReviewDemo(root, raw);
  const users: DemoCredential[] = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts;
  const editor = users.find(user => user.role === 'editor'); assert(editor);
  const working = resolve('.local/editorial.sqlite'), hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = existsSync(working) ? hash(working) : null;
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  let app: Awaited<ReturnType<typeof launchDemoCli>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report = { schemaVersion: 'editorial-photo-browser.1', demoId: prepared.demoId, packFile, packDigest: prepared.report.packDigest, sourceCount: raw.sources.length, status: 'running', checks: [] as { ingredientId: string; width: number; photos: number }[], candidateViews: [] as { candidateId: string; width: number }[],
    errors: [] as string[], originalRequests: 0, previewRequests: 0, dirtyInputPreserved: false, mismatchedMetadataRejected: false, unavailableLibraryRejected: false, controlledHiddenVerified: false, logoutCleanupVerified: false,
    applicationStarts: 0, gracefulStops: 0, fixturesStopped: false, workingDatabaseUnchanged: false, publicationEnabled: false, professionalReviewVerified: false, realModelCalls: 0, finishedAt: null as string | null };
  try {
    app = await launchDemoCli(root, prepared.demoId, port, 'compiled', photos); report.applicationStarts++;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.addInitScript(() => {
      const evidence = { created: [] as string[], revoked: [] as string[] }; window.__draftPhotoEvidence = evidence;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { const result = create(value); evidence.created.push(result); return result; };
      URL.revokeObjectURL = value => { evidence.revoked.push(value); revoke(value); };
    });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.endsWith('/original')) report.originalRequests++; if (path.startsWith('/api/v1/private-photo-derivatives/') && path.endsWith('/image')) report.previewRequests++; });
    await page.goto(app.url); await page.getByLabel('用户名', { exact: true }).fill(editor.username); await page.getByLabel('密码', { exact: true }).fill(editor.password);
    const login = page.waitForResponse(value => value.url().endsWith('/api/v1/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: /登录工作台/ }).click(); assert.equal((await login).status(), 200);
    await expect(page.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible(); await page.getByRole('button', { name: '内容协作', exact: true }).click();
    await page.getByRole('button', { name: '内容修订', exact: true }).click();
    const names = new Map([['bai-he', '百合'], ['shan-yao', '山药'], ['lian-zi', '莲子']]);
    async function choose(target: Page, id: string) {
      const name = names.get(id); assert(name); await target.getByLabel('搜索待编辑食材', { exact: true }).fill(name); await target.getByRole('button', { name: `编辑${name}内容`, exact: true }).click();
      await expect(target.getByLabel('草稿教育说明', { exact: true })).toHaveValue(raw.drafts.find(draft => draft.ingredientId === id)!.content.educationText);
    }
    const panel = page.getByRole('region', { name: '当前食材待审图片', exact: true });
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const draft of raw.drafts) {
        await choose(page, draft.ingredientId); const candidates = registry.list().items.filter(photo => photo.ingredientId === draft.ingredientId); assert(candidates.length);
        await expect(panel.getByRole('group', { name: '切换当前食材照片', exact: true }).getByRole('button')).toHaveCount(candidates.length);
        for (const [index, candidate] of candidates.entries()) {
          if (index) await panel.getByRole('button', { name: candidate.name, exact: true }).click();
          await expect(panel.getByRole('img', { name: `${candidate.name}，私有待审展示图`, exact: true })).toBeVisible();
          await panel.screenshot({ path: join(prepared.directory, index ? `draft-photos-${candidate.id}-${width}.png` : `draft-photos-${draft.ingredientId}-${width}.png`) });
          report.candidateViews.push({ candidateId: candidate.id, width });
        }
        await expect(page.locator('.draft-source')).toHaveCount(draft.content.sourceRefs.length);
        for (const ref of draft.content.sourceRefs) {
          const source = raw.sources.find(value => value.key === ref.id); assert(source);
          await expect(page.locator('.draft-source').getByText(source.input.title, { exact: true })).toBeVisible();
        }
        if (edition === 'primary-20261014') await page.screenshot({ path: join(prepared.directory, `primary-draft-${draft.ingredientId}-${width}.png`), fullPage: true });
        assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        report.checks.push({ ingredientId: draft.ingredientId, width, photos: candidates.length });
      }
    }
    await choose(page, 'bai-he'); const candidates = registry.list().items.filter(photo => photo.ingredientId === 'bai-he'); assert.equal(candidates.length, 2);
    const originalText = raw.drafts.find(draft => draft.ingredientId === 'bai-he')!.content.educationText;
    const temporary = originalText + '\n工程临时输入，未保存。'; await page.getByLabel('草稿教育说明', { exact: true }).fill(temporary);
    await panel.getByRole('button', { name: candidates[1].name, exact: true }).click(); await expect(panel.getByRole('img', { name: `${candidates[1].name}，私有待审展示图`, exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '重新读取照片', exact: true }).click(); await expect(panel.getByRole('img', { name: `${candidates[1].name}，私有待审展示图`, exact: true })).toBeVisible();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(temporary);
    await page.getByLabel('搜索待编辑食材', { exact: true }).fill('山药'); const dialog = page.waitForEvent('dialog');
    await Promise.all([page.getByRole('button', { name: '编辑山药内容', exact: true }).click(), dialog.then(value => value.dismiss())]);
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(temporary); report.dirtyInputPreserved = true;
    await page.getByLabel('草稿教育说明', { exact: true }).fill(originalText);
    await panel.getByRole('button', { name: candidates[0].name, exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    const path = `/api/v1/private-photo-derivatives/${candidates[0].id}`, actual = await (await context.request.get(app.url + path)).json();
    const match = `**${path}`; await context.route(match, route => route.fulfill({ status: 200, json: { ...actual, digest: `sha256:${'0'.repeat(64)}` } }));
    await panel.getByRole('button', { name: '重新读取照片', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('展示图与当前候选不匹配'); await expect(panel.getByRole('img')).toHaveCount(0);
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(originalText); report.mismatchedMetadataRejected = true;
    await context.unroute(match); await panel.getByRole('button', { name: '重新读取展示图', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    const listPath = '**/api/v1/private-photos'; await context.route(listPath, route => route.fulfill({ status: 503, json: { message: '照片资料暂不可用。' } }));
    await panel.getByRole('button', { name: '重新读取照片', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('照片资料暂不可用');
    await expect(panel.getByRole('heading', { name: '对应照片 暂不可用', exact: true })).toBeVisible(); await expect(panel.getByRole('img')).toHaveCount(0);
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(originalText); report.unavailableLibraryRejected = true;
    await context.unroute(listPath); await panel.getByRole('button', { name: '重新读取照片', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(panel.getByRole('img')).toHaveCount(0); assert.equal(await page.evaluate(() => { const value = window.__draftPhotoEvidence!; return value.created.filter(url => !value.revoked.includes(url)).length; }), 0);
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(originalText); report.controlledHiddenVerified = true;
    await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); }); await expect(panel.getByRole('img')).toBeVisible();
    const publicCatalog = await (await context.request.get(`${app.url}/api/v1/public/catalog`)).text();
    for (const draft of raw.drafts) { assert(!publicCatalog.includes(JSON.stringify(draft.content.educationText).slice(1, -1))); assert.equal((await context.request.get(`${app.url}/api/v1/public/photos/${draft.ingredientId}`)).status(), 503); }
    assert.equal((await context.request.get(`${app.url}/api/v1/editorial/photo-publications/bai-he`)).status(), 503);
    await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => { const value = window.__draftPhotoEvidence!; return value.created.filter(url => !value.revoked.includes(url)).length; }), 0); report.logoutCleanupVerified = true;
    assert.equal(report.originalRequests, 0); assert.equal(report.candidateViews.length, 10); assert(report.previewRequests >= 10); assert.deepEqual(report.errors, []); report.status = 'passed';
    await context.close();
  } catch (error) { report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown browser failure'); throw error; }
  finally {
    try { await browser?.close(); if (app) { await app.close(); report.gracefulStops++; } report.fixturesStopped = report.applicationStarts === report.gracefulStops; }
    finally {
      report.workingDatabaseUnchanged = before === (existsSync(working) ? hash(working) : null);
      const db = new DatabaseSync(join(prepared.directory, 'editorial.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('SELECT count(*) n FROM content_revisions').get()!.n, raw.drafts.length);
        assert.equal(db.prepare('SELECT count(*) n FROM source_versions').get()!.n, raw.sources.length);
        for (const draft of raw.drafts) {
          const row = db.prepare('SELECT payload FROM content_revisions WHERE ingredient_id = ? AND revision = 1').get(draft.ingredientId); assert(row);
          const content: unknown = JSON.parse(String(row.payload)); assert(content && typeof content === 'object');
          assert.deepEqual(content, { ...draft.content, sourceRefs: draft.content.sourceRefs.map(ref => {
            const source = raw.sources.find(value => value.key === ref.id); assert(source);
            const record = db.prepare('SELECT source_id, revision FROM source_versions WHERE url = ?').get(source.input.url); assert(record);
            return { id: record.source_id, revision: record.revision, locator: ref.locator };
          }) });
        }
        for (const source of raw.sources) {
          const row = db.prepare('SELECT title, publisher, url FROM source_versions WHERE url = ?').get(source.input.url); assert.deepEqual({ ...row }, source.input);
        }
        for (const table of ['source_checks', 'photo_notes', 'photo_submissions', 'photo_rights_reviews', 'photo_professional_reviews', 'professional_qualifications', 'professional_reviews', 'review_tasks', 'publication_approvals', 'publication_events', 'assistant_events', 'sessions']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0, table);
      }
      finally { db.close(); }
      report.finishedAt = new Date().toISOString(); writeFileSync(join(prepared.directory, 'editorial-photo-browser-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
      console.log(`Private editorial photo evidence: ${prepared.directory}`); assert(report.workingDatabaseUnchanged && report.fixturesStopped);
    }
  }
});
