import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { prepareLocalDemo, type DemoCredential } from '../server/local-demo.js';
import { validateSeed } from '../server/seed.js';
import { launchDemoCli, launchCompiledDemoCli } from './local-demo-process.js';
import { launchCompiledDemo } from './compiled-demo-process.js';
import { MiniDemoFlowError, verifyMiniDemoFlow } from './mini-demo-flow.js';

// Separate opt-in real Edge proof. Each runtime owns its database and report.
// Neither substitutes for PostgreSQL, HTTPS, real qualifications or devices.
for (const runtime of ['typescript-demo-cli', 'compiled-node-server', 'compiled-demo-cli'] as const) {
test(`${runtime} and React preserve the 106-item historical catalog and private review through a process restart`, async () => {
  const root = resolve('.'); const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const ingredient = seed.ingredients.find((item) => item.id === 'huang-qi'); assert(ingredient);
  const alternative = seed.ingredients.find((item) => item.id === 'jiang'); assert(alternative);
  const workingFile = resolve('.local/editorial.sqlite');
  const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const workingBefore = existsSync(workingFile) ? digest(workingFile) : null;
  const prepared = await prepareLocalDemo(root);
  const users = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts as DemoCredential[];
  const reportFile = join(prepared.directory, 'browser-proof.json');
  const compiled = runtime !== 'typescript-demo-cli';
  const entry = resolve(runtime === 'compiled-demo-cli' ? 'build/tools/local-demo.js' : 'build/server/index.js');
  const entryDigest = compiled ? digest(entry) : null;
  const report = { schemaVersion: 1, kind: compiled ? 'isolated-compiled-demo' : 'isolated-local-demo', applicationRuntime: runtime,
    compiledEntrySha256: entryDigest, failurePhase: null as string | null, miniFailurePhase: null as string | null,
    startedAt: new Date().toISOString(), finishedAt: null as string | null,
    status: 'running', demoId: prepared.demoId, releaseId: seed.releaseId, sourceAsOf: seed.sourceAsOf, ingredientCount: seed.ingredients.length,
    checks: { realReactReviewFlow: false, privateBoundary: false, restartPersistence: false, reviewerReadOnly: false,
      narrowViewport: false, governanceReadRecovery: false, servedProductionAssets: false, workingDatabaseUnchanged: false,
      miniTaskBeforeRestart: false, miniTaskAfterRestart: false },
    miniFlows: [] as Array<Awaited<ReturnType<typeof verifyMiniDemoFlow>>>,
    applicationStarts: 0, gracefulStops: 0, fixturesStopped: false, databaseEngine: 'sqlite', browser: 'msedge',
    governancePickerReadsDuringDetailRefresh: null as number | null,
    compiledBackendVerified: false, productionDeploymentVerified: false, professionalReviewVerified: false, mobileDevicesVerified: false, realModelCalls: 0, publicationEnabled: false };
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>((done) => probe.close(() => done()));
  const launch = runtime === 'compiled-node-server' ? launchCompiledDemo : runtime === 'compiled-demo-cli' ? launchCompiledDemoCli : launchDemoCli;
  let app: { url: string; close(): Promise<void> } | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let phase = 'start'; let failure: unknown;
  async function login(page: Page, role: string) {
    const user = users.find((u) => u.role === role)!;
    await page.goto(app!.url);
    await page.getByLabel('用户名', { exact: true }).fill(user.username);
    await page.getByLabel('密码', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: /登录工作台/ }).click();
    await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
  }
  async function choose(page: Page) {
    await page.getByRole('button', { name: '内容修订', exact: true }).click();
    await page.getByLabel('搜索待编辑食材').fill(ingredient!.name);
    await page.getByRole('button', { name: `编辑${ingredient!.name}内容`, exact: true }).click();
    await expect(page.getByLabel('草稿教育说明')).toBeVisible();
  }
  try {
    app = await launch(root, prepared.demoId, port); report.applicationStarts += 1;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const editorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const reviewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await editorContext.newPage(); const reviewer = await reviewerContext.newPage();
    const publicBefore = await (await editorContext.request.get(`${app.url}/api/v1/public/catalog`)).json();
    assert.equal(publicBefore.items.length, seed.ingredients.length); assert.equal(publicBefore.releaseId, seed.releaseId);
    phase = 'React login and note'; await login(page, 'editor');
    const assistant = await (await editorContext.request.get(`${app.url}/api/v1/editorial/assistant/config`)).json();
    assert.equal(assistant.enabled, false);
    const script = await page.locator('script[type="module"][src]').getAttribute('src');
    assert(script && /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(script));
    const asset = await editorContext.request.get(`${app.url}${script}`); assert.equal(asset.status(), 200);
    assert.equal(createHash('sha256').update(await asset.body()).digest('hex'), digest(join(root, 'dist', script.slice(1))));
    report.checks.servedProductionAssets = true;
    await page.getByRole('textbox', { name: '搜索食材' }).fill(ingredient.name);
    await page.getByRole('button', { name: `查看${ingredient.name}`, exact: true }).click();
    await page.getByLabel('编辑备注', { exact: true }).fill('独立演示备注，重启后应保留；不是专业意见。');
    await page.getByRole('button', { name: '保存备注', exact: true }).click();
    await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
    phase = 'React source and draft'; await page.getByRole('button', { name: '内容协作', exact: true }).click();
    await page.getByRole('button', { name: '来源登记', exact: true }).click();
    const title = '独立演示来源，不是正式依据';
    await page.getByLabel('来源标题', { exact: true }).fill(title);
    await page.getByLabel('来源发布机构').fill('演示用占位机构');
    await page.getByLabel('来源原始网址').fill('https://example.org/local-demo-not-professional-evidence');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存');
    await choose(page);
    await page.getByLabel('草稿教育说明').fill('独立演示草稿，仅验证编辑协作，不描述疗效或食用建议。');
    await page.getByLabel('草稿安全边界').fill('演示内容不用于诊断、治疗、处方或安全保证，尚未专业审校。');
    await page.getByLabel('搜索可引用来源').fill(title);
    await page.getByRole('button', { name: '引用此来源', exact: true }).click();
    await page.getByLabel(`${title}的原文定位`).fill('演示定位，不是真实出版物');
    await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
    await page.getByRole('button', { name: '提交编辑审阅', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已提交编辑审阅');
    phase = 'React independent editorial acceptance'; await login(reviewer, 'reviewer');
    await reviewer.getByRole('button', { name: '内容协作', exact: true }).click();
    await reviewer.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
    await reviewer.getByRole('button', { name: `审阅${ingredient.name}修订1`, exact: true }).click();
    await reviewer.getByLabel('编辑审阅意见').fill('仅通过资料整理演示，不是中医师或药师签审，也不批准发布。');
    await reviewer.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true }).click();
    await expect(reviewer.getByRole('status', { name: '编辑审阅结果' })).toContainText('仍为私有待专业审校');
    await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
    await expect(page.getByText('编辑审阅通过 · 未发布', { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: '来源加载状态' })).toHaveCount(0);
    await expect(page.getByText('正在读取原文摘录…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(prepared.directory, 'desktop.png'), fullPage: true });
    report.checks.realReactReviewFlow = true;
    phase = 'governance select fixed draft';
    await page.getByRole('button', { name: '专业审校记录', exact: true }).click();
    const professional = page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name: '固定版本专业审校', exact: true }) });
    await professional.getByLabel('搜索待专业审校食材', { exact: true }).fill(ingredient.name);
    await professional.getByRole('button', { name: `查看${ingredient.name}专业审校`, exact: true }).click();
    await expect(professional.getByLabel('专业审校状态', { exact: true })).toBeVisible();
    const opinion = professional.getByLabel('专业审校意见', { exact: true });
    await opinion.fill('未提交的演示说明，不是专业审校结论。');
    phase = 'governance list read failure';
    let writes = 0; let pickerReads = 0;
    const countWrites = (request: { method(): string; url(): string }) => {
      if (request.method() !== 'GET') writes++;
      if (new URL(request.url()).pathname === '/api/v1/ingredients') pickerReads++;
    };
    page.on('request', countWrites);
    const before = await (await editorContext.request.get(`${app.url}/api/v1/editorial/professional/${ingredient.id}`)).json();
    await page.route('**/api/v1/ingredients?*', (route) => route.abort());
    await professional.getByLabel('搜索待专业审校食材', { exact: true }).fill('姜');
    await expect(professional.getByRole('alert')).toBeVisible();
    await expect(opinion).toHaveValue('未提交的演示说明，不是专业审校结论。');
    await expect(professional.getByRole('button', { name: `查看${ingredient.name}专业审校`, exact: true })).toHaveCount(0);
    await page.unroute('**/api/v1/ingredients?*');
    await professional.getByRole('button', { name: '重试专业审校食材', exact: true }).click();
    phase = 'governance list read retry';
    await expect(professional.getByRole('button', { name: `查看${alternative.name}专业审校`, exact: true })).toBeVisible();
    await expect(opinion).toHaveValue('未提交的演示说明，不是专业审校结论。');
    const pickerReadsBeforeDetailRefresh = pickerReads;
    phase = 'governance detail read failure';
    await page.route(`**/api/v1/editorial/professional/${ingredient.id}`, (route) => route.abort());
    page.once('dialog', (dialog) => dialog.accept());
    await professional.getByRole('button', { name: '刷新专业审校', exact: true }).click();
    await expect(professional.getByRole('alert')).toBeVisible();
    await expect(opinion).toHaveValue('未提交的演示说明，不是专业审校结论。');
    await expect(opinion).toBeDisabled();
    await expect(professional.getByLabel('专业审校状态', { exact: true })).toHaveCount(0);
    await expect(professional.getByText('正在读取待审校食材…', { exact: true })).toHaveCount(0);
    await expect(professional.getByText('正在读取固定版本与资格…', { exact: true })).toHaveCount(0);
    await expect(professional.getByRole('button', { name: `查看${alternative.name}专业审校`, exact: true })).toBeVisible();
    assert.equal(pickerReads, pickerReadsBeforeDetailRefresh);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await page.screenshot({ path: join(prepared.directory, 'governance-recovery.png'), fullPage: true });
    phase = 'governance detail read retry';
    await page.unroute(`**/api/v1/editorial/professional/${ingredient.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await professional.getByRole('button', { name: '刷新专业审校', exact: true }).click();
    await expect(opinion).toHaveValue('');
    await expect(professional.getByLabel('专业审校状态', { exact: true })).toBeVisible();
    assert.equal(pickerReads, pickerReadsBeforeDetailRefresh);
    report.governancePickerReadsDuringDetailRefresh = pickerReads - pickerReadsBeforeDetailRefresh;
    assert.equal(writes, 0); page.off('request', countWrites);
    assert.deepEqual(await (await editorContext.request.get(`${app.url}/api/v1/editorial/professional/${ingredient.id}`)).json(), before);
    report.checks.governanceReadRecovery = true;
    assert.deepEqual(await (await editorContext.request.get(`${app.url}/api/v1/public/catalog`)).json(), publicBefore);
    assert.equal((await editorContext.request.get(`${app.url}/api/v1/public/education/${ingredient.id}`)).status(), 503);
    report.checks.privateBoundary = true;
    phase = 'native task chain against same server before restart';
    report.miniFlows.push(await verifyMiniDemoFlow(app.url, publicBefore)); report.checks.miniTaskBeforeRestart = true;
    phase = 'actual process restart'; await app.close(); report.gracefulStops += 1; app = undefined;
    app = await launch(root, prepared.demoId, port); report.applicationStarts += 1;
    await page.reload(); await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
    await page.getByRole('button', { name: '内容协作', exact: true }).click(); await choose(page);
    await expect(page.getByLabel('草稿教育说明')).toHaveValue('独立演示草稿，仅验证编辑协作，不描述疗效或食用建议。');
    await expect(page.getByText('编辑审阅通过 · 未发布', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name: /食材资料/ }).click();
    await page.getByRole('textbox', { name: '搜索食材' }).fill(ingredient.name);
    await page.getByRole('button', { name: `查看${ingredient.name}`, exact: true }).click();
    await expect(page.getByLabel('编辑备注', { exact: true })).toHaveValue('独立演示备注，重启后应保留；不是专业意见。');
    report.checks.restartPersistence = true;
    phase = 'native task chain against same server after restart';
    report.miniFlows.push(await verifyMiniDemoFlow(app.url, publicBefore)); report.checks.miniTaskAfterRestart = true;
    phase = 'reviewer readonly narrow layout'; await reviewer.reload();
    await expect(reviewer.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
    await reviewer.getByRole('textbox', { name: '搜索食材' }).fill(ingredient.name);
    await reviewer.getByRole('button', { name: `查看${ingredient.name}`, exact: true }).click();
    await expect(reviewer.getByLabel('编辑备注', { exact: true })).toHaveAttribute('readonly', '');
    await expect(reviewer.getByRole('button', { name: '保存备注', exact: true })).toBeDisabled();
    report.checks.reviewerReadOnly = true;
    await reviewer.setViewportSize({ width: 390, height: 844 });
    assert.equal(await reviewer.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await reviewer.screenshot({ path: join(prepared.directory, 'narrow.png'), fullPage: true });
    report.checks.narrowViewport = true;
    report.checks.workingDatabaseUnchanged = workingBefore === (existsSync(workingFile) ? digest(workingFile) : null);
    assert.equal(report.checks.workingDatabaseUnchanged, true);
    assert(Object.values(report.checks).every((value) => value));
    if (compiled) assert.equal(digest(entry), entryDigest);
  } catch (error) { failure = error; if (error instanceof MiniDemoFlowError) report.miniFailurePhase = error.phase; }
  finally {
    try { if (browser) { await browser.close(); browser = undefined; } } catch (error) { failure ??= error; }
    try { if (app) { await app.close(); report.gracefulStops += 1; app = undefined; } } catch (error) { failure ??= error; }
    report.fixturesStopped = browser === undefined && app === undefined && report.applicationStarts === report.gracefulStops;
    report.compiledBackendVerified = compiled && !failure && report.fixturesStopped;
    report.failurePhase = failure ? phase : null;
    report.finishedAt = new Date().toISOString(); report.status = failure ? 'failed' : 'passed';
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(`Local demo verification report: ${reportFile}`);
  // Do not expose Playwright's fill arguments (random passwords) on failure.
  if (failure) assert.fail(`Local demo browser phase failed: ${phase}. Private arguments redacted; see the owned report and test source.`);
  assert.equal(report.fixturesStopped, true);
});
}
