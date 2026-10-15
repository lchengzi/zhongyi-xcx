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
import { expandedPhotoManifest, loadRealPhotoLibrary } from './private-photo-library-fixture.js';
import { parsePrivatePhotoList } from '../shared/private-photos.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { photoBindingDigest } from '../server/photo-note-values.js';

// Opt-in local evidence with the existing real originals, not a public asset or
// a remote download. No working DB, real professional signature or AI calls.
test('real React private-photo preview → account API → original-byte binding', { timeout: 180000 }, async t => {
  const startedAt = new Date().toISOString(), directory = resolve('.local/private-photo-browser', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const registry = loadRealPhotoLibrary();
  const candidates = registry.list().items, first = candidates[0], second = candidates[1];
  assert.equal(candidates.length, 13);
  const repo = new CatalogRepository(':memory:', JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'))), auth = new AuthRepository(repo.db);
  for (const role of ['editor', 'reviewer'] as const) await auth.createUser(`photo-${role}`, 'test-only-photo-browser-password-2026', role, 'test-fixture');
  for (const username of ['photo-editor-search', 'photo-editor-forms']) await auth.createUser(username, 'test-only-photo-browser-password-2026', 'editor', 'test-fixture');
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening'); const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), { privatePhotos: registry }));
  let browser: Browser | undefined;
  let completed = false;
  const checks: { name: string; status: 'passed' | 'failed'; message?: string }[] = [], pageErrors: string[] = [], methods: string[] = [];
  async function page(role: 'editor' | 'reviewer', width = 1200, username = `photo-${role}`): Promise<Page> {
    const context = await browser!.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage();
    p.on('pageerror', error => pageErrors.push(error.message));
    p.on('request', req => { const url = new URL(req.url()); if (url.origin === origin && url.pathname.startsWith('/api/v1/private-photos')) methods.push(req.method()); });
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(username); await p.getByLabel('密码', { exact: true }).fill('test-only-photo-browser-password-2026');
    const loginResponse = p.waitForResponse(response => response.url() === `${origin}/api/v1/auth/login` && response.request().method() === 'POST');
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click(); assert.equal((await loginResponse).status(), 200, 'Isolated scenario login must succeed before UI assertions');
    await expect(p.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await expect(p.getByRole('button', { name: new RegExp(first.name) })).toBeVisible();
    return p;
  }
  async function check(name: string, run: () => Promise<void>) {
    await t.test(name, async () => { try { await run(); checks.push({ name, status: 'passed' }); } catch (error) { checks.push({ name, status: 'failed', message: error instanceof Error ? error.message : 'failed' }); throw error; } });
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    await check('editor sees two actual originals with matching browser-decoded dimensions and no approval action', async () => {
      const p = await page('editor');
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click(); await p.getByRole('button', { name: '查看原图', exact: true }).click();
        await expect(p.locator('.private-photo-original img')).toBeVisible();
        assert.deepEqual(await p.locator('.private-photo-original img').evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]), [first.width, first.height]);
        await expect(p.getByText(first.sha256, { exact: true })).toBeVisible(); await expect(p.getByRole('button', { name: /批准|发布/ })).toHaveCount(0);
        await p.screenshot({ path: resolve(directory, 'jianghuang-editor.png') });
        await p.getByRole('button', { name: new RegExp(second.name) }).click(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        assert.deepEqual(await p.locator('.private-photo-original img').evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]), [second.width, second.height]);
        await p.screenshot({ path: resolve(directory, 'danggui-editor.png') });
      } finally { await p.context().close(); }
    });
    await check('reviewer can preview at 360px without horizontal page overflow', async () => {
      const p = await page('reviewer', 360);
      try {
        await p.getByRole('button', { name: new RegExp(second.name) }).click(); await p.getByRole('button', { name: '查看原图', exact: true }).click();
        await expect(p.locator('.private-photo-original img')).toBeVisible();
        const dimensions = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(dimensions.page <= dimensions.width + 1, JSON.stringify(dimensions));
        await p.screenshot({ path: resolve(directory, 'reviewer-360.png'), fullPage: true });
      } finally { await p.context().close(); }
    });
    await check('invalid approved metadata and expired original session fail closed with explicit retry', async () => {
      const p = await page('reviewer');
      try {
        await p.route('**/api/v1/private-photos', route => route.fulfill({ json: { ...registry.list(), items: [{ ...first, rightsReview: 'approved' }] } }));
        await p.getByRole('button', { name: '重新读取候选', exact: true }).click(); await expect(p.getByRole('alert')).toContainText('数据格式无效'); await expect(p.getByRole('button', { name: '查看原图', exact: true })).toHaveCount(0);
        await p.unroute('**/api/v1/private-photos'); await p.getByRole('button', { name: '重新读取候选', exact: true }).click();
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.route('**/api/v1/private-photos/*/original', route => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.getByRole('alert')).toContainText('会话已失效'); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        await p.unroute('**/api/v1/private-photos/*/original'); await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
      } finally { await p.context().close(); }
    });
    await check('cancelled late original cannot appear under a different candidate', async () => {
      const p = await page('editor'); let release!: () => void;
      const held = new Promise<void>(done => { release = done; }), entered = new Promise<void>(done => {
        void p.route(`**/api/v1/private-photos/${first.id}/original`, async route => { done(); await held; await route.fulfill({ contentType: 'image/jpeg', headers: { 'Content-Length': String(first.bytes) }, body: registry.asset(first.id)! }).catch(() => {}); });
      });
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click(); await p.getByRole('button', { name: '查看原图', exact: true }).click(); await entered;
        await p.getByRole('button', { name: '取消读取', exact: true }).click(); await p.getByRole('button', { name: new RegExp(second.name) }).click(); release();
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        await expect(p.locator('.private-photo-original img')).toHaveAttribute('alt', `${second.name}，待核对原图`);
        assert.equal(await p.locator('.private-photo-original img').evaluate((element: HTMLImageElement) => element.naturalWidth), second.width);
      } finally { release(); await p.context().close(); }
    });
    await check('page hide and navigation revoke preview URLs without automatically fetching again', async () => {
      const p = await page('editor');
      try {
        await p.evaluate(() => { const original = URL.revokeObjectURL; Object.defineProperty(window, '__revokedPhotoUrls', { value: [] }); URL.revokeObjectURL = value => { const list: unknown = Reflect.get(window, '__revokedPhotoUrls'); if (Array.isArray(list)) list.push(value); original(value); }; });
        await p.getByRole('button', { name: new RegExp(first.name) }).click(); await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        const url = await p.locator('.private-photo-original img').getAttribute('src');
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(p.locator('.private-photo-original img')).toHaveCount(0); assert(await p.evaluate(value => { const list: unknown = Reflect.get(window, '__revokedPhotoUrls'); return Array.isArray(list) && list.includes(value); }, url));
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        const nextUrl = await p.locator('.private-photo-original img').getAttribute('src'); await p.getByRole('button', { name: /食材资料/ }).click();
        assert(await p.evaluate(value => { const list: unknown = Reflect.get(window, '__revokedPhotoUrls'); return Array.isArray(list) && list.includes(value); }, nextUrl));
        await p.getByRole('button', { name: '图片审阅', exact: true }).click(); await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        const logoutUrl = await p.locator('.private-photo-original img').getAttribute('src'); await p.getByRole('button', { name: '退出工作台 ↗', exact: true }).click();
        await expect(p.getByRole('button', { name: '登录工作台 →', exact: true })).toBeVisible();
        assert(await p.evaluate(value => { const list: unknown = Reflect.get(window, '__revokedPhotoUrls'); return Array.isArray(list) && list.includes(value); }, logoutUrl));
      } finally { await p.context().close(); }
    });
    await check('actual editor save persists a real-candidate opinion, clears form and remains private', async () => {
      const p = await page('editor');
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：需专业人员核对部位，不是实际鉴定。');
        await p.getByLabel('依据与定位', { exact: true }).fill('fixture:visible-original-1');
        await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toHaveText('核对意见已保存。');
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('');
        await expect(p.getByLabel('图片核对历史')).toContainText('fixture:visible-original-1');
        await p.getByLabel('图片核对历史').getByText('当时的候选与来源', { exact: true }).click();
        await expect(p.getByLabel('图片核对历史').getByRole('link', { name: '当时的来源文件页 ↗', exact: true })).toHaveAttribute('href', `${first.sourcePage}?oldid=${first.sourceRevision}`);
        await p.screenshot({ path: resolve(directory, 'photo-notes-editor.png'), fullPage: true });
      } finally { await p.context().close(); }
    });
    await check('360px reviewer reads recorded opinions without write controls or horizontal overflow', async () => {
      const p = await page('reviewer', 360);
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await expect(p.getByLabel('图片核对历史')).toContainText('fixture:visible-original-1');
        await expect(p.getByRole('button', { name: '保存核对意见', exact: true })).toHaveCount(0);
        assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await p.screenshot({ path: resolve(directory, 'photo-notes-reviewer-360.png'), fullPage: true });
      } finally { await p.context().close(); }
    });
    await check('unsaved opinion protects candidate switch, candidate reload and workspace navigation', async () => {
      const p = await page('editor');
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('输入保护测试，不保存。');
        for (const action of [() => p.getByRole('button', { name: new RegExp(second.name) }).click(), () => p.getByRole('button', { name: '重新读取候选', exact: true }).click(), () => p.getByRole('button', { name: /食材资料/ }).click()]) {
          p.once('dialog', dialog => { void dialog.dismiss(); }); await action(); await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('输入保护测试，不保存。');
        }
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: new RegExp(second.name) }).click();
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('');
      } finally { await p.context().close(); }
    });
    await check('malformed receipt after real commit locks resubmission until explicit history reread confirms it', async () => {
      const p = await page('editor'); let posts = 0;
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：回执异常但实际已提交。');
        await p.getByLabel('依据与定位', { exact: true }).fill('fixture:committed-unknown-receipt');
        await p.route(`**/api/v1/private-photo-notes/${first.id}`, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201);
          const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ status: 201, json: { ...body, actorName: 'wrong-response-actor' } });
        });
        await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toContainText('无法确认提交结果');
        await expect(p.getByRole('button', { name: '保存核对意见', exact: true })).toBeDisabled();
        await p.getByRole('button', { name: '刷新内容 ↻', exact: true }).click();
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('ENGINEERING_SIMULATION_NOT_REAL：回执异常但实际已提交。');
        await p.getByRole('button', { name: '重新读取核对记录', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toHaveText('已核对到本次保存记录。');
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue(''); assert.equal(posts, 1);
      } finally { await p.context().close(); }
    });
    await check('real competing writer causes 409; reread keeps input and requires confirmation before a new manual save', async () => {
      const p = await page('editor');
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：冲突后保留的意见。');
        await p.getByLabel('依据与定位', { exact: true }).fill('fixture:manual-after-conflict');
        const store = new PhotoNoteRepository(repo.db), other = await auth.login('photo-editor', 'test-only-photo-browser-password-2026', 'other-window-fixture');
        const current = await store.detail(first);
        await store.save(first, { bindingDigest: photoBindingDigest(first), expectedVersion: current.version, category: 'processing', text: 'ENGINEERING_SIMULATION_NOT_REAL：另一窗口的不同意见。', evidenceReference: 'fixture:other-window' }, { account: other.info.user, token: other.token });
        await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toContainText('已变化');
        await p.getByRole('button', { name: '重新读取核对记录', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toContainText('再次保存前需单独确认');
        p.once('dialog', dialog => { void dialog.dismiss(); }); await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('ENGINEERING_SIMULATION_NOT_REAL：冲突后保留的意见。');
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
        await expect(p.getByLabel('图片核对反馈')).toHaveText('核对意见已保存。');
      } finally { await p.context().close(); }
    });
    await check('invalid history fails closed and a cancelled late read cannot move history into another candidate', async () => {
      const p = await page('editor'); let release = () => {};
      try {
        await p.route(`**/api/v1/private-photo-notes/${first.id}`, route => route.fulfill({ json: { schemaVersion: 'unexpected' } }));
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await expect(p.getByLabel('图片核对反馈')).toContainText('数据格式无效');
        await expect(p.getByRole('button', { name: '保存核对意见', exact: true })).toBeDisabled();
        await p.unroute(`**/api/v1/private-photo-notes/${first.id}`);
        await p.getByRole('button', { name: new RegExp(second.name) }).click(); await expect(p.getByLabel('图片核对历史')).toContainText('尚无核对意见');
        const held = new Promise<void>(done => { release = done; }); let entered!: () => void; const waiting = new Promise<void>(done => { entered = done; });
        await p.route(`**/api/v1/private-photo-notes/${first.id}`, async route => { entered(); await held; await route.continue().catch(() => {}); });
        await p.getByRole('button', { name: new RegExp(first.name) }).click(); await waiting;
        await p.getByRole('button', { name: new RegExp(second.name) }).click(); release();
        await p.unroute(`**/api/v1/private-photo-notes/${first.id}`);
        await expect(p.getByLabel('图片核对历史')).toContainText('尚无核对意见');
        await expect(p.getByLabel('图片核对历史')).not.toContainText('fixture:manual-after-conflict');
      } finally { release(); await p.context().close(); }
    });
    await check('failed logout closes original but retains opinion across explicit valid-session verification', async () => {
      const p = await page('editor');
      try {
        await p.getByRole('button', { name: new RegExp(first.name) }).click();
        await p.getByLabel('核对意见', { exact: true }).fill('退出失败后保留，不保存。');
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        await p.route('**/api/v1/auth/logout', route => route.fulfill({ status: 500, json: { message: 'fixture logout failure' } }));
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '退出工作台 ↗', exact: true }).click();
        await expect(p.getByRole('button', { name: '核对退出状态', exact: true })).toBeVisible(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '核对退出状态', exact: true }).click();
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('退出失败后保留，不保存。'); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
      } finally { await p.context().close(); }
    });
    await check('all 13 real originals decode with their exact dimensions, fixed source revisions and retained concerns', async () => {
      const p = await page('reviewer');
      try {
        await expect(p.getByText('13 张候选 · 12 种食材', { exact: true })).toBeVisible();
        await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(13);
        for (const candidate of candidates) {
          await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: candidate.name }).click();
          await expect(p.locator('.private-photo-detail h3')).toHaveText(candidate.name);
          await expect(p.getByRole('link', { name: '查看来源文件页 ↗', exact: true })).toHaveAttribute('href', `${candidate.sourcePage}?oldid=${candidate.sourceRevision}`);
          for (const concern of candidate.concerns) await expect(p.locator('.private-photo-detail').getByText(concern, { exact: true })).toBeVisible();
          await p.getByRole('button', { name: '查看原图', exact: true }).click();
          await expect(p.locator('.private-photo-original img')).toBeVisible();
          assert.deepEqual(await p.locator('.private-photo-original img').evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]), [candidate.width, candidate.height]);
          await expect(p.locator('.private-photo-original img')).toHaveAttribute('alt', `${candidate.name}，待核对原图`);
          const image = await p.locator('.private-photo-original img').getAttribute('src'); assert(image?.startsWith('blob:'));
          if (candidate.ingredientId === 'hua-ju-hong') await p.screenshot({ path: resolve(directory, 'expanded-huajuhong.png'), fullPage: true });
          await p.getByRole('button', { name: '收起原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        }
        await expect(p.getByRole('button', { name: /批准|发布/ })).toHaveCount(0);
      } finally { await p.context().close(); }
    });
    await check('local candidate search keeps the selected draft across matching and empty results at 360px', async () => {
      // The original editor has legitimately used all ten allowed logins.
      // Verify the limiter stays enforced, then use an independent scenario user.
      await assert.rejects(auth.login('photo-editor', 'test-only-photo-browser-password-2026', 'fixture-limit-diagnostic'), { status: 429, code: 'rate_limited' });
      const p = await page('editor', 360, 'photo-editor-search'); let listReads = 0;
      try {
        await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: first.name }).click();
        await expect(p.getByLabel('核对意见', { exact: true })).toBeEditable();
        await p.getByLabel('核对意见', { exact: true }).fill('搜索不改变当前候选，也不丢弃输入。');
        await p.route('**/api/v1/private-photos', route => { listReads++; return route.continue(); });
        await p.getByLabel('搜索照片候选', { exact: true }).fill(' 铁皮石斛 ');
        await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(2);
        await expect(p.locator('.private-photo-detail h3')).toHaveText(first.name);
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('搜索不改变当前候选，也不丢弃输入。');
        await expect(p.getByText(`当前核对：${first.name}`, { exact: true })).toBeVisible();
        await p.getByLabel('搜索照片候选', { exact: true }).fill('没有这张照片');
        await expect(p.getByText('没有匹配的照片候选。', { exact: true })).toBeVisible();
        await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(0);
        await p.getByRole('button', { name: '清除照片搜索', exact: true }).click();
        await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(13);
        await expect(p.getByLabel('核对意见', { exact: true })).toHaveValue('搜索不改变当前候选，也不丢弃输入。');
        await p.getByLabel('搜索照片候选', { exact: true }).fill('TIE-PI-SHI-HU');
        await expect(p.getByLabel('照片候选列表').getByRole('button')).toHaveCount(2);
        const layout = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(layout.page <= layout.width + 1);
        assert.equal(listReads, 0);
        await p.screenshot({ path: resolve(directory, 'expanded-search-360.png'), fullPage: true });
        await p.getByLabel('搜索照片候选', { exact: true }).scrollIntoViewIfNeeded();
        await p.screenshot({ path: resolve(directory, 'expanded-search-360-viewport.png') });
      } finally { await p.context().close(); }
    });
    await check('same-ingredient stems and rolls have separate fixed-candidate histories after actual UI saves', async () => {
      const p = await page('editor', 1200, 'photo-editor-forms');
      const forms = candidates.filter(item => item.ingredientId === 'tie-pi-shi-hu'); assert.equal(forms.length, 2);
      try {
        await p.getByLabel('搜索照片候选', { exact: true }).fill('铁皮石斛');
        for (const candidate of forms) {
          await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: candidate.name }).click();
          await expect(p.getByLabel('图片核对历史')).toContainText('尚无核对意见');
          await p.getByLabel('核对类别', { exact: true }).selectOption('processing');
          await p.getByLabel('核对意见', { exact: true }).fill(`ENGINEERING_SIMULATION_NOT_REAL：${candidate.name}，不是同批加工链或专业结论。`);
          await p.getByLabel('依据与定位', { exact: true }).fill(`fixture:separate-candidate:${candidate.id}`);
          await p.getByRole('button', { name: '保存核对意见', exact: true }).click();
          await expect(p.getByLabel('图片核对反馈')).toHaveText('核对意见已保存。');
          await expect(p.getByLabel('图片核对历史')).toContainText(`fixture:separate-candidate:${candidate.id}`);
          const history = await new PhotoNoteRepository(repo.db).detail(candidate);
          assert.equal(history.version, 1); assert.equal(history.history[0].candidate.id, candidate.id);
        }
        for (const candidate of forms) {
          await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: candidate.name }).click();
          await expect(p.getByLabel('图片核对历史')).toContainText(`fixture:separate-candidate:${candidate.id}`);
          for (const other of forms.filter(item => item.id !== candidate.id)) await expect(p.getByLabel('图片核对历史')).not.toContainText(`fixture:separate-candidate:${other.id}`);
        }
      } finally { await p.context().close(); }
    });
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM photo_notes').get()?.n, 6);
    assert.deepEqual(pageErrors, []); assert(methods.every(method => method === 'GET'));
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM editorial_notes').get()?.n, 0);
    assert(parsePrivatePhotoList(registry.list()).items.every(item => item.publicationEligible === false));
    completed = true;
  } finally {
    await browser?.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close();
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ schemaVersion: 'private-photo-browser.1', startedAt, finishedAt: new Date().toISOString(), status: completed && checks.length === 15 && checks.every(check => check.status === 'passed') && !pageErrors.length ? 'passed' : 'failed', checks, pageErrors,
      candidates: candidates.map(item => ({ id: item.id, sha256: item.sha256, bytes: item.bytes })), privateGetCount: methods.length, database: 'isolated-sqlite-memory', workingDatabaseModified: false, originalBytesModified: false, publicPhotosAdded: 0, actualProfessionalApproval: false, actualWeChatOrDevice: false, actualAiCalls: 0,
      builtIndexSha256: createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex'), manifestSha256: createHash('sha256').update(readFileSync(expandedPhotoManifest)).digest('hex') }, null, 2));
    console.log(`Private photo browser evidence: ${resolve(directory, 'report.json')}`);
  }
});
