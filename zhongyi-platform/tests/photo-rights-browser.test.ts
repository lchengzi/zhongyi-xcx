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
import { PhotoRightsRepository } from '../server/photo-rights.js';
import type { PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from '../server/stores.js';
import { rehmanniaPhotoManifest, loadRehmanniaPhotoLibrary } from './private-photo-library-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';

// Actual local React/Edge/HTTP/SQLite with immutable real private originals.
// Every decision uses test-fixture evidence; no real rights/professional approval.
test('real React rights review → account HTTP → isolated immutable SQLite history', { timeout: 300000 }, async t => {
  const startedAt = new Date().toISOString(), directory = resolve('.local/photo-rights-browser', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const registry = loadRehmanniaPhotoLibrary(), [first, second, third] = registry.list().items;
  const manifestSha256 = createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex');
  const repo = new CatalogRepository(':memory:', JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'))), auth = new AuthRepository(repo.db);
  const notes = new PhotoNoteRepository(repo.db), submissions = new PhotoSubmissionRepository(repo.db), rights = new PhotoRightsRepository(repo.db);
  const password = 'engineering-only-rights-browser-password-2026';
  await auth.createUser('rights-fixture-editor', password, 'editor', 'engineering-test');
  const editor = await auth.login('rights-fixture-editor', password, 'rights-fixture-setup'), editorAuthority = { account: editor.info.user, token: editor.token };
  const before = repo.publicSnapshot();
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), { privatePhotos: registry }));
  let browser: Browser | undefined, completed = false, sequence = 0;
  const pageErrors: string[] = [], checks: { name: string; status: 'passed' | 'failed'; message?: string }[] = [];
  async function prepare(photo: PrivatePhoto, authority: WriteAuthority = editorAuthority) {
    const head = await notes.detail(photo), note = await notes.save(photo, noteInput(head.version, photo), authority);
    return submissions.submit(photo, submissionInput(note, (await submissions.detail(photo)).version), authority);
  }
  async function page(role: 'editor' | 'reviewer' | 'admin' = 'reviewer', width = 1200, photo = first, contribute = false) {
    const username = `rights-${role}-${++sequence}`; await auth.createUser(username, password, role, 'engineering-test');
    if (contribute) { const login = await auth.login(username, password, `rights-setup-${sequence}`); await prepare(photo, { account: login.info.user, token: login.token }); }
    const context = await browser!.newContext({ viewport: { width, height: 1000 } });
    context.setDefaultTimeout(10000);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage(); p.on('pageerror', error => pageErrors.push(error.message));
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(username); await p.getByLabel('密码', { exact: true }).fill(password);
    const login = p.waitForResponse(response => response.url() === `${origin}/api/v1/auth/login` && response.request().method() === 'POST');
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click(); assert.equal((await login).status(), 200);
    await expect(p.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: photo.name }).click();
    await p.getByRole('tab', { name: '权利审核', exact: true }).click();
    await expect(p.getByLabel('图片权利状态')).toBeVisible();
    return p;
  }
  async function fill(p: Page, comment: string, decision = 'approve') {
    await p.getByLabel('审核决定', { exact: true }).selectOption(decision);
    await p.getByLabel('依据类别', { exact: true }).selectOption('test-fixture');
    await p.getByLabel('权利依据与定位', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL:rights-browser');
    await p.getByLabel('署名方案', { exact: true }).fill('工程演练：作者、来源与许可链接，真实署名待审核。');
    await p.getByLabel('修改与脱敏方案', { exact: true }).fill('工程演练：移除元数据、修改说明及同方式共享另行核验。');
    const localTomorrow = await p.evaluate(() => { const date = new Date(Date.now() + 86400000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); });
    await p.getByLabel('依据有效期或复核时间（本机时区）', { exact: true }).fill(localTomorrow);
    await p.getByLabel('审核意见', { exact: true }).fill(comment);
  }
  const confirmation = (p: Page) => p.getByRole('checkbox', { name: /已核对当前送审版本/ });
  const send = (p: Page) => p.getByRole('button', { name: '保存审核记录', exact: true });
  const feedback = (p: Page) => p.getByLabel('图片权利反馈');
  const reread = (p: Page) => p.getByRole('button', { name: '重新读取审核资料', exact: true });
  async function check(name: string, run: () => Promise<void>) {
    await t.test(name, async () => { try { await run(); checks.push({ name, status: 'passed' }); } catch (error) { checks.push({ name, status: 'failed', message: error instanceof Error ? error.message : 'failed' }); throw error; } });
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    await check('editor reads pending rights with no decision form; missing current submission blocks review', async () => {
      const p = await page('editor');
      try { await expect(send(p)).toHaveCount(0); await expect(p.getByText('请先补充当前原图与来源版本的核对意见及送审资料。')).toBeVisible(); }
      finally { await p.context().close(); }
      await prepare(first); await prepare(second);
    });
    await check('independent reviewer confirms approval, revocation and return; expiry and history stay bounded and private', async () => {
      const p = await page();
      try {
        await fill(p, '工程演练审批，不构成真实权利审核。'); await expect(send(p)).toBeDisabled();
        await p.getByLabel('依据有效期或复核时间（本机时区）', { exact: true }).fill('2000-01-01T00:00'); await confirmation(p).check(); await send(p).click();
        await expect(feedback(p)).toContainText('批准有效期须晚于当前时间'); assert.equal((await rights.detail(first)).version, 0);
        await fill(p, '工程演练审批，不构成真实权利审核。'); await confirmation(p).check();
        await p.getByLabel('审核意见', { exact: true }).fill('工程演练审批：确认重置检查。'); await expect(confirmation(p)).not.toBeChecked(); await confirmation(p).check();
        await send(p).click(); await expect(feedback(p)).toHaveText('审核记录已保存，图片仍未公开。');
        await expect(p.getByLabel('图片权利状态')).toContainText('工程演练记录'); await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('');
        const saved = await rights.detail(first); assert.equal(saved.version, 1); assert.equal(saved.state, 'recorded'); assert.equal(saved.history[0].evidenceKind, 'test-fixture'); assert.equal(saved.publicationEligible, false);
        await p.getByLabel('图片权利审核').screenshot({ path: resolve(directory, 'rights-desktop.png') });
        await fill(p, '工程演练撤销，保留初始审核记录。', 'revoke'); await confirmation(p).check(); await send(p).click();
        await expect(feedback(p)).toHaveText('审核记录已保存，图片仍未公开。'); await expect(p.getByLabel('图片权利状态')).toContainText('已撤销');
        const revoked = await rights.detail(first); assert.equal(revoked.version, 2); assert.deepEqual(revoked.history[1], saved.history[0]); assert.equal(revoked.state, 'revoked');
        await fill(p, '工程演练退回，资料待补充。', 'return'); await confirmation(p).check(); await send(p).click();
        await expect(feedback(p)).toHaveText('审核记录已保存，图片仍未公开。'); await expect(p.getByLabel('图片权利状态')).toContainText('已退回');
        const returned = await rights.detail(first); assert.equal(returned.version, 3); assert.deepEqual(returned.history.slice(1), revoked.history); assert.equal(returned.state, 'changes_requested');
        assert.deepEqual(repo.publicSnapshot(), before);
      } finally { await p.context().close(); }
    });
    await check('360px editor reads immutable approval/revocation history without controls or page overflow', async () => {
      const p = await page('editor', 360);
      try {
        await expect(send(p)).toHaveCount(0); await expect(p.getByLabel('图片权利历史')).toContainText('审核 #2 · 撤销批准');
        const size = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(size.page <= size.width + 1, JSON.stringify(size));
        await p.getByLabel('图片权利审核').screenshot({ path: resolve(directory, 'rights-editor-360.png') });
      } finally { await p.context().close(); }
    });
    await check('contributing administrator cannot approve or return its own image despite admin role', async () => {
      const p = await page('admin', 1200, third, true);
      try {
        await expect(p.getByText(/当前账号参与过该图片的核对或送审/)).toBeVisible();
        await expect(p.getByLabel('审核决定', { exact: true }).locator('option[value="approve"]')).toBeDisabled();
        await expect(p.getByLabel('审核决定', { exact: true }).locator('option[value="return"]')).toBeDisabled(); await expect(send(p)).toBeDisabled();
        assert.equal((await rights.detail(third)).version, 0);
      } finally { await p.context().close(); }
    });
    await check('dirty rights survive rejected tab, candidate and navigation changes and local search hiding', async () => {
      const p = await page();
      try {
        await fill(p, '未保存审核保留'); p.on('dialog', dialog => { void dialog.dismiss(); });
        await p.getByRole('tab', { name: '核对记录', exact: true }).click(); await expect(p.getByRole('tab', { name: '权利审核', exact: true })).toHaveAttribute('aria-selected', 'true');
        await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: second.name }).click(); await p.getByRole('button', { name: /食材资料/ }).click();
        await p.getByLabel('搜索照片候选', { exact: true }).fill('未匹配的搜索'); await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('未保存审核保留');
      } finally { await p.context().close(); }
    });
    await check('committed write with corrupt receipt preserves fields, prohibits retry and reconciles exact record', async () => {
      const p = await page(); let posts = 0;
      try {
        await fill(p, '坏回执审核演练'); await confirmation(p).check(); const version = (await rights.detail(first)).version;
        await p.route(`**/api/v1/private-photo-rights/${first.id}`, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ response, json: { ...body, digest: `sha256:${'0'.repeat(64)}` } });
        });
        await send(p).click(); await expect(feedback(p)).toContainText('请先重新读取审核资料'); await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('坏回执审核演练');
        assert.equal((await rights.detail(first)).version, version + 1); assert.equal(posts, 1);
        await reread(p).click(); await expect(feedback(p)).toHaveText('已核对到本次审核记录，图片仍未公开。'); await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue(''); assert.equal(posts, 1);
      } finally { await p.context().close(); }
    });
    await check('real note conflict retains input, waits for current submission, then requires separate new-write confirmation', async () => {
      const p = await page(); let posts = 0;
      try {
        await fill(p, '版本冲突审核演练'); await confirmation(p).check();
        const head = await notes.detail(first), note = await notes.save(first, noteInput(head.version, first), editorAuthority);
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-rights/${first.id}`)) posts++; });
        const response = p.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/private-photo-rights/${first.id}`));
        await send(p).click(); assert.equal((await response).status(), 409); await expect(feedback(p)).toContainText('请先重新读取审核资料');
        await reread(p).click(); await expect(feedback(p)).toContainText('未找到本次审核的匹配记录'); await expect(send(p)).toBeDisabled();
        await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('版本冲突审核演练');
        await submissions.submit(first, submissionInput(note, (await submissions.detail(first)).version), editorAuthority);
        await reread(p).click(); await expect(feedback(p)).toContainText('未找到本次审核的匹配记录'); await expect(confirmation(p)).not.toBeChecked();
        await confirmation(p).check(); p.once('dialog', dialog => { void dialog.dismiss(); }); await send(p).click(); assert.equal(posts, 1);
        p.once('dialog', dialog => { void dialog.accept(); }); await send(p).click(); await expect(feedback(p)).toHaveText('审核记录已保存，图片仍未公开。'); assert.equal(posts, 2);
        assert.equal((await rights.detail(first)).history[0].submissionVersion, 2);
      } finally { await p.context().close(); }
    });
    await check('hide cancels a held committed receipt; visibility alone never unlocks or resubmits', async () => {
      const p = await page(); let posts = 0, release!: () => void;
      const held = new Promise<void>(done => { release = done; });
      try {
        await fill(p, '隐藏时审核演练'); await confirmation(p).check();
        await p.route(`**/api/v1/private-photo-rights/${first.id}`, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); await held; await route.fulfill({ response }).catch(() => {});
        });
        // Poll the actual committed database because the response is deliberately held.
        await send(p).click(); await expect.poll(async () => (await rights.detail(first)).history[0].comment).toBe('隐藏时审核演练');
        await expect(p.getByRole('tab', { name: '核对记录', exact: true })).toBeDisabled();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(feedback(p)).toContainText('页面已隐藏'); release();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('隐藏时审核演练'); assert.equal(posts, 1);
        await reread(p).click(); await expect(feedback(p)).toContainText('已核对到本次审核记录'); assert.equal(posts, 1);
      } finally { release(); await p.context().close(); }
    });
    await check('invalid detail response retains draft and locks editing until a valid explicit reread', async () => {
      const p = await page();
      try {
        await fill(p, '读取异常审核演练'); await confirmation(p).check();
        await p.route(`**/api/v1/private-photo-rights/${first.id}`, async route => {
          const response = await route.fetch(); const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ response, json: { ...body, noteDigest: `sha256:${'0'.repeat(64)}` } });
        });
        await reread(p).click(); await expect(feedback(p)).toHaveAttribute('role', 'alert'); await expect(send(p)).toBeDisabled();
        await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('读取异常审核演练');
        await p.unroute(`**/api/v1/private-photo-rights/${first.id}`); await reread(p).click(); await expect(feedback(p)).toContainText('审核资料已重新读取');
        await expect(p.getByLabel('审核意见', { exact: true })).toBeEnabled(); await expect(confirmation(p)).not.toBeChecked();
      } finally { await p.context().close(); }
    });
    await check('unknown logout releases real original preview; retained-session check alone cannot unlock review', async () => {
      const p = await page(); let posts = 0;
      try {
        await fill(p, '退出未知审核演练'); await confirmation(p).check();
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-rights/${first.id}`)) posts++; });
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        await expect.poll(() => p.locator('.private-photo-original img').evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
        await p.route('**/api/v1/auth/logout', route => route.fulfill({ status: 500, json: { message: 'engineering fixture logout failure' } }));
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '退出工作台 ↗', exact: true }).click();
        await expect(p.getByRole('button', { name: '核对退出状态', exact: true })).toBeVisible(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '核对退出状态', exact: true }).click();
        await expect(p.getByLabel('审核意见', { exact: true })).toHaveValue('退出未知审核演练'); await expect(send(p)).toBeDisabled(); await expect(confirmation(p)).not.toBeChecked();
        await reread(p).click(); await expect(feedback(p)).toContainText('审核资料已重新读取'); await expect(p.getByLabel('审核意见', { exact: true })).toBeEnabled(); assert.equal(posts, 0);
      } finally { await p.context().close(); }
    });
    assert.deepEqual(pageErrors, []); assert.equal((await rights.detail(first)).version, 6); assert.equal((await rights.detail(second)).version, 0); assert.equal((await rights.detail(third)).version, 0);
    assert.deepEqual(repo.publicSnapshot(), before); assert(registry.list().items.every(item => item.publicationEligible === false));
    assert.equal(createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex'), manifestSha256); completed = true;
  } finally {
    await browser?.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close();
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ schemaVersion: 'photo-rights-browser.1', startedAt, finishedAt: new Date().toISOString(), status: completed && checks.length === 10 && checks.every(item => item.status === 'passed') && !pageErrors.length ? 'passed' : 'failed', checks, pageErrors,
      database: 'isolated-sqlite-memory', workingDatabaseModified: false, originalBytesModified: false, publicPhotosAdded: 0, actualRightsApproval: false, actualProfessionalApproval: false, actualWeChatOrDevice: false, actualAiCalls: 0,
      builtIndexSha256: createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex'), manifestSha256 }, null, 2));
    console.log(`Photo rights browser evidence: ${resolve(directory, 'report.json')}`);
  }
});
