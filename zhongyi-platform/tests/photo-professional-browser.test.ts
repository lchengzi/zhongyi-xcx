import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { PhotoSubmissionRepository } from '../server/photo-submissions.js';
import { PhotoRightsRepository } from '../server/photo-rights.js';
import { PhotoProfessionalRepository } from '../server/photo-professional.js';
import type { ProfessionalKind } from '../shared/contracts.js';
import type { PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from '../server/stores.js';
import { rehmanniaPhotoManifest, loadRehmanniaPhotoLibrary } from './private-photo-library-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';

// Genuine built React + Edge + authenticated HTTP + isolated SQLite.
// Real private originals remain immutable; every credential/decision is simulated.
test('real React professional image review preserves independent opinions and uncertain-write lifecycle', { timeout: 300000 }, async t => {
  const startedAt = new Date().toISOString(), directory = resolve('.local/photo-professional-browser', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const registry = loadRehmanniaPhotoLibrary(), [first, second, third] = registry.list().items;
  const manifestSha256 = createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex');
  const builtIndexSha256 = createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex');
  const repo = new CatalogRepository(':memory:', JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const auth = new AuthRepository(repo.db), workflow = new WorkflowRepository(repo.db), notes = new PhotoNoteRepository(repo.db);
  const submissions = new PhotoSubmissionRepository(repo.db), rights = new PhotoRightsRepository(repo.db), professional = new PhotoProfessionalRepository(repo.db);
  const password = 'engineering-only-photo-professional-browser-2026';
  async function person(username: string, role: 'admin' | 'editor' | 'reviewer') {
    await auth.createUser(username, password, role, 'ENGINEERING_SIMULATION_NOT_REAL');
    const login = await auth.login(username, password, `professional-browser-${username}`);
    return { account: login.info.user, token: login.token };
  }
  const editor = await person('photo-professional-fixture-editor', 'editor'), rightsReviewer = await person('photo-professional-fixture-rights', 'reviewer');
  const administrator = await person('photo-professional-fixture-verifier', 'admin'), before = repo.publicSnapshot();
  async function prepare(photo: PrivatePhoto, contributor?: WriteAuthority) {
    if (contributor) await notes.save(photo, noteInput((await notes.detail(photo)).version, photo), contributor);
    const note = await notes.save(photo, noteInput((await notes.detail(photo)).version, photo), editor);
    const submission = await submissions.submit(photo, submissionInput(note, (await submissions.detail(photo)).version), editor);
    await rights.review(photo, rightsInput(submission, (await rights.detail(photo)).version), rightsReviewer);
  }
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), { privatePhotos: registry }));
  let browser: Browser | undefined, completed = false, sequence = 0;
  const pageErrors: string[] = [], checks: { name: string; status: 'passed' | 'failed'; message?: string }[] = [];
  async function page(options: { role?: 'admin' | 'reviewer' | 'editor'; profession?: ProfessionalKind | null; width?: number; photo?: PrivatePhoto; contribute?: boolean } = {}) {
    const role = options.role ?? 'reviewer', photo = options.photo ?? first, profession = options.profession === undefined ? 'tcm_physician' : options.profession;
    const authority = await person(`photo-professional-${role}-${++sequence}`, role);
    if (role !== 'editor' && profession) await workflow.saveQualification(authority.account.id, credentialInput(profession), 0, administrator.account, administrator.token);
    if (options.contribute) await prepare(photo, authority);
    assert(browser);
    const context = await browser.newContext({ viewport: { width: options.width ?? 1200, height: 1000 } }); context.setDefaultTimeout(10000);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage(); p.on('pageerror', error => pageErrors.push(error.message));
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(authority.account.username); await p.getByLabel('密码', { exact: true }).fill(password);
    const login = p.waitForResponse(response => response.url() === `${origin}/api/v1/auth/login` && response.request().method() === 'POST');
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click(); assert.equal((await login).status(), 200);
    await expect(p.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: photo.name }).click();
    await p.getByRole('tab', { name: '专业审校', exact: true }).click();
    await expect(p.getByLabel('图片专业状态')).toBeVisible();
    return { p, authority, profession, photo };
  }
  async function fill(p: Page, comment: string, profession: ProfessionalKind = 'tcm_physician', decision = 'approve') {
    await p.getByLabel('审校专业', { exact: true }).selectOption(profession);
    await p.getByLabel('专业决定', { exact: true }).selectOption(decision);
    for (const name of ['身份结论', '部位结论', '加工结论']) await p.getByLabel(name, { exact: true }).selectOption('matches');
    await p.getByLabel('专业依据与定位', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL:professional-browser');
    await p.getByLabel('专业意见', { exact: true }).fill(comment);
  }
  const send = (p: Page) => p.getByRole('button', { name: '保存专业意见', exact: true });
  const confirmation = (p: Page) => p.getByRole('checkbox', { name: /已逐项核对当前原图/ });
  const feedback = (p: Page) => p.getByLabel('图片专业反馈');
  const reread = (p: Page) => p.getByRole('button', { name: '重新读取专业资料', exact: true });
  const endpoint = `**/api/v1/private-photo-professional/${first.id}`;
  async function check(name: string, run: () => Promise<void>) {
    await t.test(name, async () => { try { await run(); checks.push({ name, status: 'passed' }); }
      catch (error) { checks.push({ name, status: 'failed', message: error instanceof Error ? error.message : 'failed' }); throw error; } });
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    await check('pending basis disables professional form; editor has read-only state and no decisions', async () => {
      const reviewer = await page();
      try { await expect(send(reviewer.p)).toBeDisabled(); await expect(reviewer.p.getByText('请先完成当前原图的核对、送审及有效权利审核，再进行专业审校。')).toBeVisible(); }
      finally { await reviewer.p.context().close(); }
      const editorPage = await page({ role: 'editor' });
      try { await expect(send(editorPage.p)).toHaveCount(0); await expect(editorPage.p.getByLabel('图片专业状态')).toContainText('待专业审校'); }
      finally { await editorPage.p.context().close(); }
      await prepare(first); await prepare(second);
    });
    await check('two independent qualified professions submit explicit matching opinions; revoke and return preserve history without publishing', async () => {
      const physician = await page(), pharmacist = await page({ profession: 'pharmacist' });
      try {
        await fill(physician.p, '中医师工程演练，不是真人鉴定。'); await expect(send(physician.p)).toBeDisabled(); await confirmation(physician.p).check();
        await physician.p.getByLabel('部位结论', { exact: true }).selectOption('uncertain'); await expect(confirmation(physician.p)).not.toBeChecked(); await confirmation(physician.p).check(); await expect(send(physician.p)).toBeDisabled();
        await physician.p.getByLabel('部位结论', { exact: true }).selectOption('matches'); await confirmation(physician.p).check(); await send(physician.p).click();
        await expect(feedback(physician.p)).toHaveText('专业意见已保存，图片仍未公开。'); await expect(physician.p.getByLabel('专业意见', { exact: true })).toHaveValue('');
        const initial = await professional.detail(first); assert.equal(initial.version, 1); assert.equal(initial.state, 'recorded');
        await reread(pharmacist.p).click(); await expect(feedback(pharmacist.p)).toContainText('专业审校资料已重新读取');
        await fill(pharmacist.p, '药师工程演练，不是真人鉴定。', 'pharmacist'); await confirmation(pharmacist.p).check(); await send(pharmacist.p).click();
        await expect(feedback(pharmacist.p)).toHaveText('专业意见已保存，图片仍未公开。');
        const paired = await professional.detail(first); assert.equal(paired.version, 2); assert.equal(paired.state, 'recorded'); assert.equal(paired.latestReviews.length, 2);
        assert.equal(new Set(paired.latestReviews.map(item => item.actorId)).size, 2); assert.equal(paired.publicationEligible, false); assert.deepEqual(paired.history[1], initial.history[0]);
        await pharmacist.p.getByLabel('图片专业审校', { exact: true }).screenshot({ path: resolve(directory, 'professional-desktop.png') });
        await fill(pharmacist.p, '撤销工程演练意见，保留历史。', 'pharmacist', 'revoke'); await confirmation(pharmacist.p).check(); await send(pharmacist.p).click();
        await expect(feedback(pharmacist.p)).toHaveText('专业意见已保存，图片仍未公开。'); assert.equal((await professional.detail(first)).state, 'revoked');
        await fill(pharmacist.p, '退回工程演练资料，不能确认加工。', 'pharmacist', 'return'); await pharmacist.p.getByLabel('加工结论', { exact: true }).selectOption('mismatch');
        await confirmation(pharmacist.p).check(); await send(pharmacist.p).click(); await expect(feedback(pharmacist.p)).toHaveText('专业意见已保存，图片仍未公开。');
        const returned = await professional.detail(first); assert.equal(returned.version, 4); assert.equal(returned.state, 'changes_requested'); assert.deepEqual(returned.history.slice(2), paired.history);
      } finally { await physician.p.context().close(); await pharmacist.p.context().close(); }
    });
    await check('360px editor reads both professional histories and decodes immutable real original without overflow', async () => {
      const { p } = await page({ role: 'editor', width: 360 });
      try {
        await expect(send(p)).toHaveCount(0); await expect(p.getByLabel('图片专业历史')).toContainText('专业 #3 · 药师 · 撤销通过');
        await p.getByRole('button', { name: '查看原图', exact: true }).click();
        await expect.poll(() => p.locator('.private-photo-original img').evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
        const size = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(size.page <= size.width + 1, JSON.stringify(size));
        await p.getByLabel('图片专业审校', { exact: true }).screenshot({ path: resolve(directory, 'professional-editor-360.png') });
      } finally { await p.context().close(); }
      await prepare(first);
    });
    await check('missing credentials and earlier contributing admin cannot approve or return', async () => {
      const missing = await page({ profession: null });
      try {
        await missing.p.getByLabel('审校专业', { exact: true }).selectOption('tcm_physician');
        await expect(missing.p.getByLabel('专业决定', { exact: true }).locator('option[value="approve"]')).toBeDisabled(); await expect(send(missing.p)).toBeDisabled();
        await expect(missing.p.getByLabel('本账号专业资格')).toContainText('尚无资格');
      } finally { await missing.p.context().close(); }
      const contributor = await page({ role: 'admin', photo: third, contribute: true });
      try {
        await contributor.p.getByLabel('审校专业', { exact: true }).selectOption('tcm_physician');
        await expect(contributor.p.getByText(/当前账号参与过核对、送审或权利审核/)).toBeVisible();
        for (const decision of ['approve', 'return']) await expect(contributor.p.getByLabel('专业决定', { exact: true }).locator(`option[value="${decision}"]`)).toBeDisabled();
        assert.equal((await professional.detail(third)).version, 0);
      } finally { await contributor.p.context().close(); }
    });
    await check('dirty narrow form survives rejected tab, photo, navigation changes and local search hiding', async () => {
      const { p } = await page({ width: 360 });
      try {
        await fill(p, '未保存专业意见保留'); p.on('dialog', dialog => { void dialog.dismiss(); });
        await p.getByRole('tab', { name: '核对记录', exact: true }).click(); await expect(p.getByRole('tab', { name: '专业审校', exact: true })).toHaveAttribute('aria-selected', 'true');
        await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: second.name }).click(); await p.getByRole('button', { name: /食材资料/ }).click();
        await p.getByLabel('搜索照片候选', { exact: true }).fill('没有匹配候选'); await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('未保存专业意见保留');
        const size = await p.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth })); assert(size.page <= size.width + 1, JSON.stringify(size));
        await p.getByLabel('图片专业审校', { exact: true }).screenshot({ path: resolve(directory, 'professional-form-360.png') });
      } finally { await p.context().close(); }
    });
    await check('committed write with corrupt receipt preserves fields and reconciles exact record with only one POST', async () => {
      const { p } = await page(); let posts = 0;
      try {
        await fill(p, '坏回执专业演练'); await confirmation(p).check(); const version = (await professional.detail(first)).version;
        await p.route(endpoint, async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); const body: unknown = await response.json(); assert(body && typeof body === 'object');
          await route.fulfill({ response, json: { ...body, digest: `sha256:${'0'.repeat(64)}` } });
        });
        await send(p).click(); await expect(feedback(p)).toContainText('请先重新读取核对'); await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('坏回执专业演练');
        assert.equal((await professional.detail(first)).version, version + 1); assert.equal(posts, 1);
        await reread(p).click(); await expect(feedback(p)).toHaveText('已核对到本次专业意见，图片仍未公开。'); await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue(''); assert.equal(posts, 1);
      } finally { await p.context().close(); }
    });
    await check('valid receipt followed by failed refresh acknowledges saved result but retains input until explicit matching read', async () => {
      const { p } = await page(); let saved = false, posts = 0;
      try {
        await fill(p, '已保存但刷新失败演练'); await confirmation(p).check();
        await p.route(endpoint, async route => {
          if (route.request().method() === 'POST') { posts++; const response = await route.fetch(); saved = response.status() === 201; await route.fulfill({ response }); }
          else if (saved) await route.fulfill({ status: 503, json: { message: 'engineering refresh failure' } });
          else await route.continue();
        });
        await send(p).click(); await expect(feedback(p)).toContainText('专业意见已保存，但当前资料暂未刷新'); await expect(send(p)).toBeDisabled();
        await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('已保存但刷新失败演练'); assert.equal(posts, 1);
        await p.unroute(endpoint); await reread(p).click(); await expect(feedback(p)).toHaveText('已核对到本次专业意见，图片仍未公开。'); assert.equal(posts, 1);
      } finally { await p.context().close(); }
    });
    await check('real basis conflict retains fields and requires refreshed rights plus a separate new manual submission confirmation', async () => {
      const { p } = await page(); let posts = 0;
      try {
        await fill(p, '版本冲突专业演练'); await confirmation(p).check();
        await notes.save(first, noteInput((await notes.detail(first)).version, first), editor);
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-professional/${first.id}`)) posts++; });
        const response = p.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/private-photo-professional/${first.id}`));
        await send(p).click(); assert.equal((await response).status(), 409); await expect(feedback(p)).toContainText('请先重新读取核对');
        await reread(p).click(); await expect(feedback(p)).toContainText('未找到本次意见的匹配记录'); await expect(send(p)).toBeDisabled();
        await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('版本冲突专业演练');
        await prepare(first); await reread(p).click(); await expect(feedback(p)).toContainText('未找到本次意见的匹配记录'); await expect(confirmation(p)).not.toBeChecked();
        await confirmation(p).check(); p.once('dialog', dialog => { void dialog.dismiss(); }); await send(p).click(); assert.equal(posts, 1);
        p.once('dialog', dialog => { void dialog.accept(); }); await send(p).click(); await expect(feedback(p)).toHaveText('专业意见已保存，图片仍未公开。'); assert.equal(posts, 2);
        assert.equal((await professional.detail(first)).history[0].submissionVersion, (await submissions.detail(first)).version);
      } finally { await p.context().close(); }
    });
    await check('hide during held committed response preserves inputs and ignores late result without automatic retry', async () => {
      const { p } = await page(); let posts = 0, release!: () => void; const held = new Promise<void>(done => { release = done; });
      try {
        await fill(p, '隐藏时专业演练'); await confirmation(p).check();
        await p.route(endpoint, async route => { if (route.request().method() !== 'POST') { await route.continue(); return; }
          posts++; const response = await route.fetch(); assert.equal(response.status(), 201); await held; await route.fulfill({ response }).catch(() => {}); });
        await send(p).click(); await expect.poll(async () => (await professional.detail(first)).history[0].comment).toBe('隐藏时专业演练');
        await expect(p.getByRole('tab', { name: '核对记录', exact: true })).toBeDisabled();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(feedback(p)).toContainText('页面已隐藏'); release();
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('隐藏时专业演练'); assert.equal(posts, 1);
        await reread(p).click(); await expect(feedback(p)).toContainText('已核对到本次专业意见'); assert.equal(posts, 1);
      } finally { release(); await p.context().close(); }
    });
    await check('qualification digest tampering locks retained draft; real revocation prevents subsequent approval', async () => {
      const { p, authority } = await page();
      const qualificationEndpoint = `**/api/v1/editorial/qualifications/${authority.account.id}`;
      try {
        await fill(p, '资格异常保留输入'); await confirmation(p).check();
        await p.route(qualificationEndpoint, async route => { const response = await route.fetch(); const raw: unknown = await response.json();
          assert(raw && typeof raw === 'object' && 'items' in raw && Array.isArray(raw.items));
          const items = raw.items.map((item: unknown) => { assert(item && typeof item === 'object'); return { ...item, digest: `sha256:${'0'.repeat(64)}` }; });
          await route.fulfill({ response, json: { ...raw, items } }); });
        await reread(p).click(); await expect(feedback(p)).toContainText('资格历史摘要不匹配'); await expect(send(p)).toBeDisabled(); await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('资格异常保留输入');
        await p.unroute(qualificationEndpoint); await reread(p).click(); await expect(feedback(p)).toContainText('专业审校资料已重新读取'); await expect(confirmation(p)).not.toBeChecked();
        await workflow.saveQualification(authority.account.id, { ...credentialInput('tcm_physician'), status: 'revoked' }, 1, administrator.account, administrator.token);
        await reread(p).click(); await expect(feedback(p)).toContainText('专业审校资料已重新读取'); await expect(p.getByLabel('专业决定', { exact: true }).locator('option[value="approve"]')).toBeDisabled();
        await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('资格异常保留输入');
      } finally { await p.context().close(); }
    });
    await check('uncertain logout releases original and retained-session check cannot unlock professional input', async () => {
      const { p } = await page(); let posts = 0;
      try {
        await fill(p, '退出未知专业演练'); await confirmation(p).check();
        p.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/private-photo-professional/${first.id}`)) posts++; });
        await p.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(p.locator('.private-photo-original img')).toBeVisible();
        await p.route('**/api/v1/auth/logout', route => route.fulfill({ status: 500, json: { message: 'engineering logout failure' } }));
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '退出工作台 ↗', exact: true }).click();
        await expect(p.getByRole('button', { name: '核对退出状态', exact: true })).toBeVisible(); await expect(p.locator('.private-photo-original img')).toHaveCount(0);
        p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '核对退出状态', exact: true }).click();
        await expect(p.getByLabel('专业意见', { exact: true })).toHaveValue('退出未知专业演练'); await expect(send(p)).toBeDisabled(); await expect(confirmation(p)).not.toBeChecked();
        await reread(p).click(); await expect(feedback(p)).toContainText('专业审校资料已重新读取'); await expect(p.getByLabel('专业意见', { exact: true })).toBeEnabled(); assert.equal(posts, 0);
      } finally { await p.context().close(); }
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(repo.publicSnapshot(), before); assert(registry.list().items.every(item => !item.publicationEligible));
    assert.equal(createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex'), manifestSha256);
    assert.equal(createHash('sha256').update(readFileSync(resolve('dist/index.html'))).digest('hex'), builtIndexSha256);
    completed = true;
  } finally {
    await browser?.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close();
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ schemaVersion: 'photo-professional-browser.1', startedAt, finishedAt: new Date().toISOString(),
      status: completed && checks.length === 11 && checks.every(item => item.status === 'passed') && !pageErrors.length ? 'passed' : 'failed', checks, pageErrors,
      database: 'isolated-sqlite-memory', workingDatabaseModified: false, originalBytesModified: false, publicPhotosAdded: 0, actualRightsApproval: false,
      actualProfessionalApproval: false, actualWeChatOrDevice: false, actualAiCalls: 0, builtIndexSha256, manifestSha256 }, null, 2));
    console.log(`Photo professional browser evidence: ${resolve(directory, 'report.json')}`);
  }
});
