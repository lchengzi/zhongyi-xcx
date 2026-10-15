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
import { expandedPhotoManifest, loadRealPhotoLibrary } from './private-photo-library-fixture.js';
import { noteInput } from './photo-note-fixture.js';

// Opt-in local real-image evidence. Engineering accounts are not professionals;
// originals, working databases, public assets and system settings stay unchanged.
test('real React image submission → authenticated HTTP → isolated SQLite history', { timeout: 240000 }, async t => {
  const startedAt = new Date().toISOString(), directory = resolve('.local/photo-submissions-browser', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const registry = loadRealPhotoLibrary(), [first, second] = registry.list().items;
  const repo = new CatalogRepository(':memory:', JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'))), auth = new AuthRepository(repo.db);
  const notes = new PhotoNoteRepository(repo.db), submissions = new PhotoSubmissionRepository(repo.db);
  const password = 'engineering-only-submission-browser-password-2026';
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), { privatePhotos: registry }));
  let browser: Browser | undefined, completed = false, sequence = 0;
  const pageErrors: string[] = [], checks: { name: string; status: 'passed' | 'failed'; message?: string }[] = [];
  async function page(role: 'editor' | 'reviewer' = 'editor', width = 1200) {
    const username = `submission-${role}-${++sequence}`; await auth.createUser(username, password, role, 'engineering-test');
    const context = await browser!.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage(); p.on('pageerror', error => pageErrors.push(error.message));
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(username); await p.getByLabel('密码', { exact: true }).fill(password);
    const login = p.waitForResponse(response => response.url() === `${origin}/api/v1/auth/login` && response.request().method() === 'POST');
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click(); assert.equal((await login).status(), 200);
    await expect(p.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: first.name }).click();
    return p;
  }
  async function open(p: Page) { await p.getByRole('tab', { name: '送审资料', exact: true }).click(); await expect(p.getByLabel('图片送审资料')).not.toHaveAttribute('aria-busy', 'true'); await expect(p.getByText(/已读送审版本/)).toBeVisible(); }
  async function fill(p: Page, caption: string) {
    await p.getByLabel('图片说明', { exact: true }).fill(caption);
    await p.getByLabel('部位描述', { exact: true }).fill('工程演练，部位待专业核对');
    await p.getByLabel('加工形态描述', { exact: true }).fill('工程演练，切片形态待核对');
    await p.getByLabel('送审依据与定位', { exact: true }).fill('fixture:engineering-only-not-professional-approval');
  }
  const confirmation = (p: Page) => p.getByRole('checkbox', { name: /已核对以上说明/ });
  const send = (p: Page) => p.getByRole('button', { name: '提交送审资料', exact: true });
  const feedback = (p: Page) => p.getByLabel('图片送审反馈');
  async function check(name: string, run: () => Promise<void>) {
    await t.test(name, async () => { try { await run(); checks.push({ name, status: 'passed' }); } catch (error) { checks.push({ name, status: 'failed', message: error instanceof Error ? error.message : 'failed' }); throw error; } });
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    await check('missing opinion blocks submission; actual UI opinion and explicit confirmation create one pinned private version', async () => {
      const p = await page();
      try {
        await open(p); await expect(p.getByLabel('图片说明', { exact: true })).toBeDisabled();
        await p.getByRole('tab', { name: '核对记录', exact: true }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：身份和部位尚待专业核对。');
        await p.getByLabel('依据与定位', { exact: true }).fill('fixture:submission-browser-opinion');
        await p.getByRole('button', { name: '保存核对意见', exact: true }).click(); await expect(p.getByLabel('图片核对反馈')).toHaveText('核对意见已保存。');
        await open(p); await fill(p, '工程演练图片说明，不构成鉴定'); await expect(send(p)).toBeDisabled(); await confirmation(p).check();
        await p.getByLabel('部位描述', { exact: true }).fill('工程演练，更新部位描述待核对'); await expect(confirmation(p)).not.toBeChecked(); await confirmation(p).check();
        await send(p).click(); await expect(feedback(p)).toHaveText('送审资料已提交，后续审核尚未完成。');
        await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue(''); await expect(p.getByLabel('图片送审历史')).toContainText('送审 #1');
        const saved = await submissions.detail(first); assert.equal(saved.version, 1); assert.equal(saved.history[0].noteDigest, (await notes.detail(first)).history[0].digest); assert.equal(saved.history[0].candidate.publicationEligible, false);
        await p.getByLabel('图片送审资料').screenshot({ path: resolve(directory, 'submission-desktop.png') });
      } finally { await p.context().close(); }
    });
    await check('360px reviewer reads history without submission controls or horizontal overflow', async () => {
      const p = await page('reviewer', 360);
      try {
        await open(p); await expect(p.getByLabel('图片送审历史')).toContainText('送审 #1'); await expect(send(p)).toHaveCount(0);
        const size = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(size.page <= size.width + 1, JSON.stringify(size));
        await p.getByLabel('图片送审资料').screenshot({ path: resolve(directory, 'submission-reviewer-360.png') });
      } finally { await p.context().close(); }
    });
    await check('dirty submission survives rejected tab/candidate/navigation changes and local search hiding the candidate', async () => {
      const p = await page();
      try {
        await open(p); await fill(p, '保留送审输入'); p.on('dialog', dialog => { void dialog.dismiss(); });
        await p.getByRole('tab', { name: '核对记录', exact: true }).click(); await expect(p.getByRole('tab', { name: '送审资料', exact: true })).toHaveAttribute('aria-selected', 'true');
        await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: second.name }).click();
        await p.getByRole('button', { name: /食材资料/ }).click(); await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('保留送审输入');
        await p.getByLabel('搜索照片候选', { exact: true }).fill('没有这张图片'); await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('保留送审输入');
      } finally { await p.context().close(); }
    });
    await check('committed write with corrupt receipt retains input and locks retries until explicit matching history reread', async () => {
      const p = await page(); let posts = 0;
      try {
        await open(p); await fill(p, '回执异常工程演练'); await confirmation(p).check(); const before = (await submissions.detail(first)).version;
        await p.route(`**/api/v1/private-photo-submissions/${first.id}`, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ response, json: { ...body, digest: `sha256:${'0'.repeat(64)}` } });
        });
        await send(p).click(); await expect(feedback(p)).toContainText('请先重新读取送审资料'); await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('回执异常工程演练');
        assert.equal((await submissions.detail(first)).version, before + 1); assert.equal(posts, 1);
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toHaveText('已核对到本次送审记录，后续审核尚未完成。');
        await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue(''); assert.equal(posts, 1);
      } finally { await p.context().close(); }
    });
    await check('changed opinion produces real conflict, retains fields and requires separate manual confirmation after reread', async () => {
      const p = await page(); let posts = 0;
      try {
        await open(p); await fill(p, '意见更新冲突工程演练'); await confirmation(p).check();
        const cookie = (await p.context().cookies()).find(item => item.name === 'food_session'); assert(cookie); const session = auth.session(cookie.value); assert(session);
        const head = await notes.detail(first); await notes.save(first, noteInput(head.version, first), { account: session.user, token: cookie.value });
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-submissions/${first.id}`)) posts++; });
        const response = p.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/private-photo-submissions/${first.id}`));
        await send(p).click(); assert.equal((await response).status(), 409); await expect(feedback(p)).toContainText('请先重新读取送审资料');
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toContainText('未找到本次送审的匹配记录');
        await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('意见更新冲突工程演练'); await expect(confirmation(p)).not.toBeChecked();
        await confirmation(p).check(); p.once('dialog', dialog => { void dialog.dismiss(); }); await send(p).click(); assert.equal(posts, 1);
        p.once('dialog', dialog => { void dialog.accept(); }); await send(p).click(); await expect(feedback(p)).toHaveText('送审资料已提交，后续审核尚未完成。'); assert.equal(posts, 2);
        assert.equal((await submissions.detail(first)).history[0].noteVersion, head.version + 1);
      } finally { await p.context().close(); }
    });
    await check('page hide cancels a held committed receipt, never auto-resubmits and requires manual history reconciliation', async () => {
      const p = await page(); let posts = 0, release!: () => void, entered!: () => void;
      const held = new Promise<void>(done => { release = done; }), reached = new Promise<void>(done => { entered = done; });
      try {
        await open(p); await fill(p, '隐藏页面工程演练'); await confirmation(p).check();
        await p.route(`**/api/v1/private-photo-submissions/${first.id}`, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); entered(); await held; await route.fulfill({ response }).catch(() => {});
        });
        await send(p).click(); await reached; await expect(p.getByRole('tab', { name: '核对记录', exact: true })).toBeDisabled();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(feedback(p)).toContainText('页面已隐藏'); release();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('隐藏页面工程演练'); assert.equal(posts, 1);
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toContainText('已核对到本次送审记录'); assert.equal(posts, 1);
      } finally { release(); await p.context().close(); }
    });
    await check('invalid current-head response locks editing without erasing the draft; explicit repaired reread restores manual confirmation', async () => {
      const p = await page();
      try {
        await open(p); await fill(p, '读取异常后保留'); await confirmation(p).check();
        await p.route(`**/api/v1/private-photo-submissions/${first.id}`, async route => {
          const response = await route.fetch(); const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ response, json: { ...body, noteDigest: `sha256:${'0'.repeat(64)}` } });
        });
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toHaveAttribute('role', 'alert');
        await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('读取异常后保留'); await expect(send(p)).toBeDisabled();
        await p.unroute(`**/api/v1/private-photo-submissions/${first.id}`);
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toContainText('送审资料已重新读取');
        await expect(p.getByLabel('图片说明', { exact: true })).toBeEnabled(); await expect(confirmation(p)).not.toBeChecked();
      } finally { await p.context().close(); }
    });
    await check('unknown logout blocks the form and releases original preview; account check alone cannot unlock submission', async () => {
      const p = await page(); let posts = 0;
      try {
        await open(p); await fill(p, '退出结果不明仍保留'); await confirmation(p).check();
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-submissions/${first.id}`)) posts++; });
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        await p.route('**/api/v1/auth/logout', route => route.fulfill({ status: 500, json: { message: 'engineering fixture logout failure' } }));
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '退出工作台 ↗', exact: true }).click();
        await expect(p.getByRole('button', { name: '核对退出状态', exact: true })).toBeVisible(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '核对退出状态', exact: true }).click();
        await expect(p.getByLabel('图片说明', { exact: true })).toHaveValue('退出结果不明仍保留'); await expect(send(p)).toBeDisabled(); await expect(confirmation(p)).not.toBeChecked();
        await p.getByRole('button', { name: '重新读取送审资料', exact: true }).click(); await expect(feedback(p)).toContainText('送审资料已重新读取');
        await expect(p.getByLabel('图片说明', { exact: true })).toBeEnabled(); assert.equal(posts, 0);
      } finally { await p.context().close(); }
    });
    assert.deepEqual(pageErrors, []); assert.equal((await submissions.detail(first)).version, 4); assert.equal((await submissions.detail(second)).version, 0);
    assert(registry.list().items.every(item => item.publicationEligible === false)); completed = true;
  } finally {
    await browser?.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close();
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ schemaVersion: 'photo-submissions-browser.1', startedAt, finishedAt: new Date().toISOString(), status: completed && checks.length === 8 && checks.every(item => item.status === 'passed') && !pageErrors.length ? 'passed' : 'failed', checks, pageErrors,
      database: 'isolated-sqlite-memory', workingDatabaseModified: false, originalBytesModified: false, publicPhotosAdded: 0, actualProfessionalApproval: false, actualWeChatOrDevice: false, actualAiCalls: 0,
      builtIndexSha256: createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex'), manifestSha256: createHash('sha256').update(readFileSync(expandedPhotoManifest)).digest('hex') }, null, 2));
    console.log(`Photo submissions browser evidence: ${resolve(directory, 'report.json')}`);
  }
});
