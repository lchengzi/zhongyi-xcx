import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { publicationFixture } from './publication-fixture.js';
import { fixturePassword } from './migration-fixture.js';
import { createEducationClient, type EducationClient, type EducationDocument } from '../../packages/catalog-core/src/index.js';

// Local engineering simulation, never production imports or real credentials.
// The browser uses real React assets, cookies, CSRF, Express routes and SQLite.
// Only the test's anonymous transport maps its pinned HTTPS origin to localhost.
const publicOrigin = 'https://content.example.test';
const binding = { ingredientId: 'huang-qi', name: '黄芪', baseReleaseId: 'release-test.1' } as const;
const marker = 'ENGINEERING_SIMULATION_NOT_REAL';
const firstText = `${marker}：第一版部位与形态资料，仅验证全栈工程，不提供食用指导。`;
const secondText = `${marker}：第二版修订资料，未经任何真实专业批准。`;
const sourceTitle = `${marker} 来源，仅隔离浏览器测试`;
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function login(page: Page, origin: string, username: string) {
  await page.goto(origin);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: '登录工作台 →', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
}
async function section(page: Page, name: string, fresh = false) {
  if (fresh) await page.reload();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function publication(page: Page, fresh = false) {
  await section(page, '固定版本发布', fresh);
  await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click();
  await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
}
async function act(page: Page, name: string, control = false) {
  await page.getByLabel('发布操作说明', { exact: true }).fill(`${marker}：本机隔离工程操作，非真实发布许可。`);
  if (control) await page.getByLabel('恢复或冻结核对编号', { exact: true }).fill(marker);
  await page.getByLabel('确认已核对发布依据', { exact: true }).check();
  page.once('dialog', dialog => dialog.accept());
  const written = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/v1/editorial/publication'));
  await page.getByRole('button', { name, exact: true }).click();
  const response = await written;
  assert.equal(response.status(), 201, await response.text());
  await expect(page.getByLabel('发布操作结果', { exact: true })).toContainText(`已记录「${name}」`);
  await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('确认已核对发布依据', { exact: true })).not.toBeChecked();
}
async function edit(page: Page, text: string, replaceSource: boolean) {
  await section(page, '内容修订');
  await page.getByRole('button', { name: '编辑黄芪内容', exact: true }).click();
  await expect(page.getByLabel('草稿教育说明', { exact: true })).toBeEditable();
  await page.getByLabel('草稿教育说明', { exact: true }).fill(text);
  await page.getByLabel('草稿食用部位', { exact: true }).fill('工程模拟部位，不是真实食材结论');
  await page.getByLabel('草稿安全边界', { exact: true }).fill(`${marker}：非医疗食养教育，不用于诊断、治疗或个人食用建议。`);
  if (replaceSource) {
    await page.getByRole('button', { name: '移除此引用', exact: true }).click();
    await page.getByLabel('搜索可引用来源', { exact: true }).fill(sourceTitle);
    await page.getByRole('button', { name: '引用此来源', exact: true }).click();
    await page.getByLabel(`${sourceTitle}的原文定位`, { exact: true }).fill(`${marker} 第 1 页，模拟定位`);
  }
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果', exact: true })).toContainText('已保存私有草稿');
  await page.getByRole('button', { name: '提交编辑审阅', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果', exact: true })).toContainText('已提交编辑审阅');
}
async function editorial(page: Page, revision: number, text: string) {
  await section(page, '编辑审阅任务', true);
  await page.getByRole('button', { name: `审阅黄芪修订${revision}`, exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.getByLabel('编辑审阅意见', { exact: true }).fill(`${marker}：仅资料整理工程模拟，不是专业签审。`);
  await page.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true }).click();
  await expect(page.getByRole('status', { name: '编辑审阅结果', exact: true })).toContainText('仍为私有待专业审校');
}
async function professional(page: Page, text: string) {
  await section(page, '专业审校记录', true);
  await page.getByRole('button', { name: '查看黄芪专业审校', exact: true }).click();
  await expect(page.getByLabel('专业审校状态', { exact: true })).toBeVisible();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.getByLabel('专业审校意见', { exact: true }).fill(`${marker}：模拟角色提交，不是真实中医师或药师意见。`);
  await page.getByRole('button', { name: '记录专业通过（不发布）', exact: true }).click();
  await expect(page.getByRole('status', { name: '专业审校结果', exact: true })).toContainText('未发布任何内容');
}

test('real React editing/review/publishing → anonymous TS client → rollback/withdraw/freeze/restart', { timeout: 240_000 }, async () => {
  const staticRoot = resolve('dist');
  assert.ok(existsSync(resolve(staticRoot, 'index.html')), 'Build the actual admin React assets before this test');
  const workingFile = resolve('.local/editorial.sqlite');
  const workingBefore = existsSync(workingFile) ? digest(workingFile) : null;
  const directory = resolve('../.refactor/evidence/fullstack-client-20261011', `run-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const reportFile = resolve(directory, 'report.json');
  const report = {
    schemaVersion: 1, scope: 'local-react-express-sqlite-and-new-ts-client', status: 'running',
    startedAt: new Date().toISOString(), finishedAt: null as string | null, phase: 'setup',
    databaseEngine: 'sqlite', browser: 'msedge', fixtureCatalogItems: 3,
    checks: [] as string[], requestCount: 0, artifacts: [] as string[], cleanupSucceeded: false,
    workingDatabaseUnchanged: null as boolean | null, professionalReviewVerified: false, publicDeploymentVerified: false,
    wechatNetworkVerified: false, postgresVerified: false, realModelCalls: 0,
    failure: null as { name: string; message: string } | null
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
  let fixture: Awaited<ReturnType<typeof publicationFixture>> | undefined;
  let repository: CatalogRepository | null = null;
  let server: Server | undefined; let origin = ''; let browser: Browser | undefined;
  const contexts: BrowserContext[] = []; let client: EducationClient | undefined;
  let failure: unknown;
  function phase(value: string) { report.phase = value; console.info(`Fullstack proof: ${value}`); }
  const checked = (name: string) => { report.checks.push(name); };
  async function start() {
    assert.ok(repository);
    const owned = createServer(); server = owned;
    owned.listen(0, '127.0.0.1'); await once(owned, 'listening');
    origin = `http://127.0.0.1:${(owned.address() as AddressInfo).port}`;
    // Bind the already-owned random port before constructing the trusted origin.
    // No probe/rebind race, no working DB, and no third-party fixture service.
    owned.on('request', createApp(repository, { mode: 'accounts', allowedOrigins: [origin] }, staticRoot, { publicationEnabled: true }));
  }
  async function stop() {
    const owned = server;
    if (owned) await new Promise<void>((done, reject) => owned.close(error => error ? reject(error) : done()));
    server = undefined;
  }
  async function account(username: string) {
    assert.ok(browser);
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    contexts.push(context); const page = await context.newPage(); await login(page, origin, username); return page;
  }
  async function closeContexts() {
    let closingError: unknown;
    for (const context of contexts.splice(0).reverse()) {
      try { await context.close(); } catch (error) { closingError ??= error; }
    }
    if (closingError) throw closingError;
  }
  async function snapshot(expectedText: string): Promise<EducationDocument> {
    assert.ok(client); const state = await client.refresh();
    assert.equal(state.status, 'ready'); assert.ok(state.document);
    assert.equal(state.document.educationText, expectedText);
    assert.deepEqual(Object.keys(state.document).sort(), ['scope', 'ingredientId', 'name', 'snapshotId', 'snapshotVersion', 'contentRevision', 'baseReleaseId', 'publishedAt', 'ediblePart', 'latinName', 'educationText', 'safetyText', 'sources', 'boundary'].sort());
    assert.equal('evidenceReference' in state.document.sources[0]!, false);
    return state.document;
  }
  async function unavailable() {
    assert.ok(client); const state = await client.refresh();
    assert.equal(state.status, 'withdrawn'); assert.equal(state.document, null);
  }
  async function screenshot(page: Page, name: string) {
    await page.screenshot({ path: resolve(directory, name), fullPage: true }); report.artifacts.push(name);
  }
  try {
    fixture = await publicationFixture(); repository = fixture.catalog;
    await start();
    client = createEducationClient({ origin: publicOrigin, binding, now: Date.now,
      scheduler: { after(ms, callback) { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } },
      transport: { request(input) {
        assert.deepEqual(input, { url: `${publicOrigin}/api/v1/public/education/huang-qi`, method: 'GET', header: { Accept: 'application/json' }, timeoutMs: 6000 });
        report.requestCount++;
        const controller = new AbortController();
        const promise = fetch(`${origin}/api/v1/public/education/huang-qi`, { method: input.method, headers: input.header, signal: controller.signal, redirect: 'error', credentials: 'omit' })
          .then(async response => ({ status: response.status, body: await response.json() as unknown }));
        return { promise, abort: () => controller.abort() };
      } }
    });
    await unavailable();
    const originalCatalog = await (await fetch(`${origin}/api/v1/public/catalog`)).text();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const editor = await account('migration-editor');
    const reviewer = await account('migration-reviewer');
    const admin = await account('migration-admin');
    const physician = await account('publication-physician');
    const pharmacist = await account('publication-pharmacist');
    const approver = await account('publication-approver');
    const asset = await editor.locator('script[type="module"][src]').getAttribute('src');
    assert.ok(asset && /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(asset));
    const served = await fetch(origin + asset); assert.equal(served.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(await served.arrayBuffer())).digest('hex'), digest(resolve(staticRoot, asset.slice(1))));
    checked('real-built-react-assets-served-by-same-express');

    phase('React source registration and draft revision 3');
    await section(editor, '来源登记');
    await editor.getByLabel('来源标题', { exact: true }).fill(sourceTitle);
    await editor.getByLabel('来源发布机构', { exact: true }).fill(`${marker} 模拟机构`);
    await editor.getByLabel('来源原始网址', { exact: true }).fill('https://example.org/engineering-simulation-only');
    await editor.getByRole('button', { name: '保存来源', exact: true }).click();
    await expect(editor.getByRole('status', { name: '来源保存结果', exact: true })).toContainText('来源已保存');
    await edit(editor, firstText, true); await unavailable(); checked('ui-source-registration-and-private-draft');
    phase('React independent editorial review');
    await editorial(reviewer, 3, firstText); await unavailable(); checked('ui-editorial-acceptance-does-not-publish');

    phase('React source verification, simulation only');
    await section(admin, '来源核验与发布检查');
    await admin.getByLabel('搜索待核验来源', { exact: true }).fill(sourceTitle);
    await admin.getByRole('button', { name: `核验${sourceTitle}`, exact: true }).click();
    await expect(admin.getByLabel('来源核验状态', { exact: true })).toBeVisible();
    await admin.getByLabel('来源核验依据类型', { exact: true }).selectOption('manual-check');
    await admin.getByLabel('来源类别', { exact: true }).selectOption('official');
    await admin.getByLabel('来源核验依据编号', { exact: true }).fill(marker);
    await admin.getByLabel('实际查证时间UTC', { exact: true }).fill(new Date(Date.now() - 120_000).toISOString().slice(0, 16));
    await admin.getByLabel('来源复核截止UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await admin.getByLabel('查找适用食材', { exact: true }).fill('黄芪');
    await admin.getByRole('button', { name: '加入黄芪核验范围', exact: true }).click();
    for (const label of ['身份依据', '食用部位', '加工形态', '安全边界', '目录适用范围']) await admin.getByLabel(label, { exact: true }).check();
    await admin.getByLabel('来源核验说明', { exact: true }).fill(`${marker}：仅隔离模拟核验，未访问或查证真实官方资料。`);
    await admin.getByLabel('确认已核对来源依据', { exact: true }).check();
    await admin.getByRole('button', { name: '保存来源核验', exact: true }).click();
    await expect(admin.getByRole('status', { name: '来源核验结果', exact: true })).toContainText('未发布内容');
    await unavailable(); checked('ui-fixed-source-verification-does-not-publish');
    phase('React two independent professional roles, simulation only');
    await professional(physician, firstText); await unavailable();
    await professional(pharmacist, firstText); await unavailable();
    checked('ui-two-professional-role-records-do-not-publish');

    phase('React snapshot, independent approval and explicit publication');
    await publication(editor); await act(editor, '生成固定快照'); await unavailable();
    await publication(admin); await act(admin, '恢复发布操作', true); await unavailable();
    await publication(approver); await act(approver, '批准此快照'); await unavailable();
    await act(approver, '发布此快照'); const first = await snapshot(firstText);
    assert.equal(first.snapshotVersion, 1); assert.equal(first.contentRevision, 3);
    checked('ui-publication-read-by-new-anonymous-ts-client'); await screenshot(approver, 'first-publication.png');

    phase('React revision 4 remains private until new review and publication');
    await edit(editor, secondText, false); assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    await editorial(reviewer, 4, secondText); assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    await professional(physician, secondText); await professional(pharmacist, secondText);
    assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    await publication(editor); await act(editor, '生成固定快照');
    await publication(approver, true);
    // The UI deliberately selects the active snapshot, not the latest private
    // candidate. Choose the new fixed version explicitly before approving it.
    await approver.getByLabel('固定快照版本', { exact: true }).selectOption({ label: '快照 2 · 正文 4' });
    await act(approver, '批准此快照');
    assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId, 'New approval alone does not change published content');
    await act(approver, '发布此快照'); const second = await snapshot(secondText);
    assert.equal(second.snapshotVersion, 2); assert.equal(second.contentRevision, 4); assert.notEqual(second.snapshotId, first.snapshotId);
    checked('ui-new-revision-review-and-publication-update-client');

    phase('React rollback, withdrawal and explicit recovery');
    await approver.getByLabel('固定快照版本', { exact: true }).selectOption(first.snapshotId);
    await act(approver, '回滚到此快照'); assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    await act(approver, '撤回当前发布'); await unavailable();
    await act(approver, '批准此快照'); await unavailable();
    await act(approver, '回滚到此快照'); assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    checked('ui-rollback-withdrawal-and-reapproval-do-not-auto-revive');
    await act(approver, '冻结全部教育发布', true); await unavailable();
    await act(approver, '恢复发布操作', true); await unavailable();
    await act(approver, '批准此快照'); await unavailable();
    await act(approver, '发布此快照'); assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    checked('ui-freeze-resume-requires-new-approval-and-publication');
    assert.equal(await (await fetch(`${origin}/api/v1/public/catalog`)).text(), originalCatalog);
    for (const path of ['/editorial/ingredients/huang-qi', '/editorial/professional/huang-qi', '/editorial/publications/huang-qi', '/users']) {
      assert.equal((await fetch(`${origin}/api/v1${path}`, { credentials: 'omit' })).status, 401);
    }
    checked('anonymous-private-routes-denied-and-historical-catalog-unchanged');

    phase('close service and reopen the actual SQLite file');
    await closeContexts(); await stop(); repository.close(); repository = null;
    repository = new CatalogRepository(fixture.filename, fixture.seed); await start();
    client.clear(client.getSnapshot().revision);
    assert.equal((await snapshot(firstText)).snapshotId, first.snapshotId);
    const reopened = await account('publication-approver'); await publication(reopened);
    await expect(reopened.getByLabel('教育发布状态', { exact: true })).toContainText('当前有效快照 1');
    await expect(reopened.getByLabel('固定快照内容', { exact: true })).toContainText(firstText);
    await screenshot(reopened, 'reopened-publication.png');
    checked('actual-database-reopen-preserves-publication-for-browser-and-client');
    report.workingDatabaseUnchanged = (existsSync(workingFile) ? digest(workingFile) : null) === workingBefore;
    assert.equal(report.workingDatabaseUnchanged, true); checked('working-database-unchanged');
    report.status = 'passed'; phase('complete');
  } catch (error) {
    failure = error; report.status = 'failed';
    report.failure = { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message.split('\n')[0] ?? 'Unknown failure' : 'Unknown failure' };
  } finally {
    client?.clear(client.getSnapshot().revision);
    let cleanupError: unknown;
    for (const close of [closeContexts, () => browser?.close(), stop]) {
      try { await close(); } catch (error) { cleanupError ??= error; }
    }
    // Never unlink a database while its service or database connection remains live.
    if (!server) {
      try { repository?.close(); repository = null; fixture?.dispose(); }
      catch (error) { cleanupError ??= error; }
    } else cleanupError ??= new Error('Owned HTTP server did not stop; fixture retained');
    if (cleanupError) {
      failure ??= cleanupError; report.status = 'failed';
      report.failure ??= { name: cleanupError instanceof Error ? cleanupError.name : 'CleanupError', message: 'Owned fixture cleanup did not complete' };
    } else report.cleanupSucceeded = true;
    report.workingDatabaseUnchanged = (existsSync(workingFile) ? digest(workingFile) : null) === workingBefore;
    if (!report.workingDatabaseUnchanged) { failure ??= new Error('Working database changed during isolated test'); report.status = 'failed'; }
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.info(`Fullstack evidence: ${reportFile}`);
  }
  if (failure) throw failure;
});
