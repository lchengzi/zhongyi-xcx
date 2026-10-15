import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { PhotoSubmissionRepository } from '../server/photo-submissions.js';
import { loadRehmanniaPhotoLibrary, rehmanniaPhotoManifest } from './private-photo-library-fixture.js';

// Explicit local evidence using new source originals and isolated test accounts.
// This does not change the working service configuration or grant photo approval.
test('new Rehmannia originals → actual React preview/opinion/submission → isolated SQLite', { timeout: 180000 }, async t => {
  const startedAt = new Date().toISOString(), directory = resolve('.local/photo-acquisition-browser', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const registry = loadRehmanniaPhotoLibrary(), candidates = registry.list().items.filter(item => item.ingredientId === 'di-huang');
  const repo = new CatalogRepository(':memory:', JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const auth = new AuthRepository(repo.db), notes = new PhotoNoteRepository(repo.db), submissions = new PhotoSubmissionRepository(repo.db);
  const publicBefore = await repo.publicSnapshot(), password = 'engineering-only-photo-acquisition-2026';
  for (const role of ['editor', 'reviewer'] as const) await auth.createUser(`acquisition-${role}`, password, role, 'engineering-test');
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), { privatePhotos: registry }));
  let browser: Browser | undefined, completed = false;
  const pageErrors: string[] = [], checks: { name: string; status: 'passed' | 'failed' }[] = [];
  async function page(role: 'editor' | 'reviewer', width: number): Promise<Page> {
    const context = await browser!.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage(); p.on('pageerror', error => pageErrors.push(error.message));
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(`acquisition-${role}`); await p.getByLabel('密码', { exact: true }).fill(password);
    const login = p.waitForResponse(response => response.url() === `${origin}/api/v1/auth/login` && response.request().method() === 'POST');
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click(); assert.equal((await login).status(), 200);
    await expect(p.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(15);
    await p.getByLabel('搜索照片候选', { exact: true }).fill('地黄');
    await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(2);
    return p;
  }
  async function chooseAndPreview(p: Page, index: number) {
    const photo = candidates[index];
    await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: photo.name }).click();
    await expect(p.getByRole('link', { name: '查看来源文件页 ↗', exact: true })).toHaveAttribute('href', `${photo.sourcePage}?oldid=${photo.sourceRevision}`);
    await p.getByRole('button', { name: '查看原图', exact: true }).click();
    const img = p.locator('.private-photo-original img'); await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([photo.width, photo.height]);
    await expect(p.getByText(photo.sha256, { exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: /批准|发布/ })).toHaveCount(0);
  }
  async function check(name: string, run: () => Promise<void>) {
    await t.test(name, async () => {
      try { await run(); checks.push({ name, status: 'passed' }); }
      catch (error) { checks.push({ name, status: 'failed' }); throw error; }
    });
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    await check('two source-bound originals decode and keep separate actual opinion/submission histories', async () => {
      const p = await page('editor', 1200);
      try {
        for (const [index, photo] of candidates.entries()) {
          await chooseAndPreview(p, index);
          await p.screenshot({ path: resolve(directory, `original-${index + 1}-desktop.png`), fullPage: true });
          await p.getByRole('tab', { name: '核对记录', exact: true }).click();
          await p.getByLabel('核对意见', { exact: true }).fill(`ENGINEERING_SIMULATION_NOT_REAL：${photo.name}基原、部位、工艺和权利均待核对。`);
          await p.getByLabel('依据与定位', { exact: true }).fill(`${photo.sourcePage}?oldid=${photo.sourceRevision}`);
          await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
          await expect(p.getByLabel('图片核对反馈')).toHaveText('核对意见已保存。');
          await p.getByRole('tab', { name: '送审资料', exact: true }).click();
          await expect(p.getByLabel('图片送审资料')).not.toHaveAttribute('aria-busy', 'true');
          await p.getByLabel('图片说明', { exact: true }).fill(`工程演练：${photo.name}，不作鉴定或公开。`);
          await p.getByLabel('部位描述', { exact: true }).fill('工程演练，实际部位待专业核对');
          await p.getByLabel('加工形态描述', { exact: true }).fill('工程演练，来源标签不证明加工工艺或同批次');
          await p.getByLabel('送审依据与定位', { exact: true }).fill(`fixture:${photo.id};source-revision:${photo.sourceRevision}`);
          await p.getByRole('checkbox', { name: /已核对以上说明/ }).check();
          await p.getByRole('button', { name: '提交送审资料', exact: true }).click();
          await expect(p.getByLabel('图片送审反馈')).toHaveText('送审资料已提交，后续审核尚未完成。');
          const detail = await submissions.detail(photo), opinion = await notes.detail(photo);
          assert.equal(detail.version, 1); assert.equal(opinion.version, 1);
          assert.equal(detail.history[0].candidate.id, photo.id); assert.equal(detail.history[0].candidate.sha256, photo.sha256);
          assert.equal(detail.history[0].noteDigest, opinion.history[0].digest); assert.equal(detail.history[0].candidate.publicationEligible, false);
        }
        assert.notEqual((await submissions.detail(candidates[0])).history[0].digest, (await submissions.detail(candidates[1])).history[0].digest);
      } finally { await p.context().close(); }
    });
    await check('360px reviewer reads each original and its own history without write controls or overflow', async () => {
      const p = await page('reviewer', 360);
      try {
        for (const [index, photo] of candidates.entries()) {
          await chooseAndPreview(p, index);
          await p.getByRole('tab', { name: '送审资料', exact: true }).click();
          await expect(p.getByLabel('图片送审历史')).toContainText('送审 #1');
          await expect(p.getByLabel('图片送审历史')).toContainText(`工程演练：${photo.name}`);
          await expect(p.getByRole('button', { name: '提交送审资料', exact: true })).toHaveCount(0);
          assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await p.screenshot({ path: resolve(directory, `original-${index + 1}-reviewer-360.png`), fullPage: true });
        }
      } finally { await p.context().close(); }
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(await repo.publicSnapshot(), publicBefore);
    assert(registry.list().items.every(item => !item.publicationEligible)); completed = true;
  } finally {
    await browser?.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close();
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ schemaVersion: 'private-photo-acquisition-browser.1', startedAt, finishedAt: new Date().toISOString(), status: completed && checks.length === 2 && checks.every(item => item.status === 'passed') && !pageErrors.length ? 'passed' : 'failed', checks, pageErrors,
      database: 'isolated-sqlite-memory', workingDatabaseModified: false, originalBytesModified: false, historicalRecordsModified: false, historicalGapClosed: false, publicPhotosAdded: 0, actualProfessionalApproval: false, actualWeChatOrDevice: false, actualAiCalls: 0,
      builtIndexSha256: createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex'), manifestSha256: createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex') }, null, 2));
    console.log(`Private photo acquisition browser evidence: ${resolve(directory, 'report.json')}`);
  }
});
