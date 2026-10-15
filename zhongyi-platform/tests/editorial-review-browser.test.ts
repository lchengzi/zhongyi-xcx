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
import { launchCompiledDemo } from './compiled-demo-process.js';
import type { DemoCredential } from '../server/local-demo.js';

test('actual Baihe research pack is editable in React, retains pinned sources after compiled-server restart and stays unpublished', async () => {
  const edition = process.env.BAIHE_REVIEW_EDITION ?? 'initial';
  assert(['initial', 'domestic-20261014', 'domestic-scale-20261014', 'domestic-standard-20261014', 'domestic-drying-20261014'].includes(edition), 'Unknown local Baihe review edition');
  const packFile = edition === 'domestic-drying-20261014' ? '2026-10-14-baihe-domestic-draft-pack-v4.json' : edition === 'domestic-standard-20261014' ? '2026-10-14-baihe-domestic-draft-pack-v3.json' : edition === 'domestic-scale-20261014' ? '2026-10-14-baihe-domestic-draft-pack-v2.json' : edition === 'domestic-20261014' ? '2026-10-14-baihe-domestic-draft-pack.json' : '2026-10-13-baihe-draft-pack.json';
  const root = resolve('.'), raw = readEditorialReviewPack(resolve('../zhongyi/content-private/research-refresh', packFile));
  const prepared = await prepareEditorialReviewDemo(root, raw), item = raw.drafts[0]; assert(item?.ingredientId === 'bai-he');
  const users: DemoCredential[] = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts;
  const working = resolve('.local/editorial.sqlite'), hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = existsSync(working) ? hash(working) : null;
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  let app: Awaited<ReturnType<typeof launchCompiledDemo>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report = { schemaVersion: 'editorial-review-browser.1', demoId: prepared.demoId, packFile, packDigest: prepared.report.packDigest, contentOrigin: 'actual-private-baihe-research-pack',
    status: 'running', sourceCount: raw.sources.length, applicationStarts: 0, gracefulStops: 0, fixturesStopped: false,
    actualReactEditVerified: false, restartPersistenceVerified: false, reviewerReadOnlyVerified: false, privateBoundaryVerified: false,
    workingDatabaseUnchanged: false, publicationEnabled: false, professionalReviewVerified: false, realModelCalls: 0,
    productionDeploymentVerified: false, errors: [] as string[], finishedAt: null as string | null };
  async function login(page: Page, role: 'editor' | 'reviewer') {
    const user = users.find(value => value.role === role); assert(user && app);
    await page.goto(app.url); await page.getByLabel('用户名', { exact: true }).fill(user.username); await page.getByLabel('密码', { exact: true }).fill(user.password);
    const response = page.waitForResponse(value => value.url().endsWith('/api/v1/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: /登录工作台/ }).click(); assert.equal((await response).status(), 200);
    await expect(page.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '内容修订', exact: true }).click();
    await page.getByLabel('搜索待编辑食材', { exact: true }).fill('百合'); await page.getByRole('button', { name: '编辑百合内容', exact: true }).click();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toBeVisible();
  }
  try {
    app = await launchCompiledDemo(root, prepared.demoId, port); report.applicationStarts++;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message)); await login(page, 'editor');
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(item.content.educationText);
    await expect(page.locator('.draft-source')).toHaveCount(item.content.sourceRefs.length);
    for (const source of raw.sources) await expect(page.locator('.draft-source').getByText(source.input.title, { exact: true })).toBeVisible();
    await page.screenshot({ path: join(prepared.directory, 'baihe-review-1200.png'), fullPage: true });
    const updated = item.content.educationText + '\n\n本地编辑演练记录：来源范围和待审问题保留，不构成审核批准。';
    await page.getByLabel('草稿教育说明', { exact: true }).fill(updated); await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果', exact: true })).toContainText('已保存私有草稿'); report.actualReactEditVerified = true;
    const privateDraft = await (await context.request.get(`${app.url}/api/v1/editorial/ingredients/bai-he`)).json();
    assert.equal(privateDraft.draft.revision, 2); assert.equal(privateDraft.draft.content.educationText, updated); assert.equal(privateDraft.draft.sources.length, item.content.sourceRefs.length);
    await app.close(); report.gracefulStops++; app = undefined;
    app = await launchCompiledDemo(root, prepared.demoId, port); report.applicationStarts++;
    const nextContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), next = await nextContext.newPage(); await login(next, 'editor');
    await expect(next.getByLabel('草稿教育说明', { exact: true })).toHaveValue(updated);
    await expect(next.locator('.draft-source')).toHaveCount(item.content.sourceRefs.length); report.restartPersistenceVerified = true;
    assert.equal(await next.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await next.screenshot({ path: join(prepared.directory, 'baihe-review-390.png'), fullPage: true });
    const reader = await browser.newContext(), reviewer = await reader.newPage(); await login(reviewer, 'reviewer');
    await expect(reviewer.getByLabel('草稿教育说明', { exact: true })).toHaveAttribute('readonly', '');
    await expect(reviewer.getByRole('button', { name: '保存内容草稿', exact: true })).toBeDisabled(); report.reviewerReadOnlyVerified = true;
    const publicCatalog = await (await reader.request.get(`${app.url}/api/v1/public/catalog`)).text();
    for (const value of [updated, item.content.educationText, item.content.safetyText, ...raw.sources.map(source => source.input.url)]) {
      assert(!publicCatalog.includes(JSON.stringify(value).slice(1, -1)), 'New private material must not leak through the catalog');
    }
    assert.equal((await reader.request.get(`${app.url}/api/v1/public/education/bai-he`)).status(), 503);
    const ai = await (await reader.request.get(`${app.url}/api/v1/editorial/assistant/config`)).json(); assert.equal(ai.enabled, false);
    report.privateBoundaryVerified = true; report.status = 'passed'; assert.deepEqual(report.errors, []);
  } catch (error) { report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown private review test failure'); throw error; }
  finally {
    try { await browser?.close(); if (app) { await app.close(); report.gracefulStops++; } report.fixturesStopped = report.applicationStarts === report.gracefulStops; }
    finally {
      report.workingDatabaseUnchanged = before === (existsSync(working) ? hash(working) : null);
      const db = new DatabaseSync(join(prepared.directory, 'editorial.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('SELECT count(*) n FROM source_versions').get()!.n, raw.sources.length);
        for (const source of raw.sources) assert.deepEqual({ ...db.prepare('SELECT title, publisher, url FROM source_versions WHERE url = ?').get(source.input.url) }, source.input);
        for (const table of ['source_checks', 'professional_qualifications', 'professional_reviews', 'review_tasks', 'publication_approvals', 'publication_events', 'assistant_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0, table);
      }
      finally { db.close(); }
      report.finishedAt = new Date().toISOString(); writeFileSync(join(prepared.directory, 'review-browser-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(`Private Baihe review evidence: ${prepared.directory}`);
      assert(report.workingDatabaseUnchanged && report.fixturesStopped);
    }
  }
});
