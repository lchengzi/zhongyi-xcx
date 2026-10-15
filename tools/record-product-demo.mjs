import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';
import { compile } from 'sass';
import { launchCompiledDemo } from '../zhongyi-platform/tests/compiled-demo-process.ts';
import { prepareLocalDemo } from '../zhongyi-platform/build/server/local-demo.js';

// Local recorder, not an H5 product or a phone automation entrypoint. Backend
// uses the existing isolated demo, never a replacement API or a working store.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = path.join(root, 'zhongyi-platform'), appRoot = path.join(root, 'apps/miniprogram');
const { chromium, expect } = createRequire(path.join(platform, 'package.json'))('@playwright/test');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.length !== 2) throw new Error('This recorder accepts no paths, accounts or production flags');
const parent = path.join(root, '.refactor/evidence/product-demo-runs'); fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
const report = { schemaVersion: 1, scope: 'mini_react_browser_adapter_and_compiled_fullstack_local_demo', status: 'running',
  startedAt: new Date().toISOString(), finishedAt: null, phase: 'preflight', browser: 'msedge', clips: [], miniChecks: [], backendChecks: [],
  applicationStarts: 0, gracefulStops: 0, fixturesStopped: false, workingDatabaseUnchanged: false,
  privateAuthentication: [],
  miniWechatRuntimeVerified: false, mobileDevicesVerified: false, h5Delivery: false, professionalReviewVerified: false,
  realModelCalls: 0, actualFoodPhotosPublished: 0, deploymentVerified: false, passwordsRecorded: false, errors: [] };
const reportPath = path.join(output, 'report.json'); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const phase = value => { report.phase = value; save(); console.log(`Recording: ${value}`); };
const workingFile = path.join(platform, '.local/editorial.sqlite');
const before = fs.existsSync(workingFile) ? sha(fs.readFileSync(workingFile)) : null;
let browser, service, recordingContext, activePage, prepared;
const pause = page => page.waitForTimeout(1800); // Readable pacing, never a test timeout or performance measurement.
async function recordClosed(context, page, filename, scope) {
  const video = page.video(); assert(video); await context.close(); recordingContext = undefined;
  const target = path.join(output, filename); assert(!fs.existsSync(target)); await video.saveAs(target);
  const bytes = fs.readFileSync(target); assert(bytes.length > 1024);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  report.clips.push({ filename, scope, bytes: bytes.length, sha256: sha(bytes) }); save(); activePage = undefined;
}
function watch(page) { page.on('pageerror', error => report.errors.push(error.message)); activePage = page; }
try {
  // All source is public mini code and local decorations, no candidate library.
  phase('compile-current-user-pages');
  await build({ entryPoints: [path.join(appRoot, 'tests/visual/demo-entry.tsx')], outfile: path.join(output, 'mini-fixture.js'),
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl', '.jpg': 'dataurl' },
    define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: 'null', 'process.env.NODE_ENV': '"production"' },
    alias: { '@tarojs/components': path.join(appRoot, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(appRoot, 'tests/visual/taro.ts'),
      '@food-education/catalog-core': path.join(root, 'packages/catalog-core/src/index.ts') } });
  const css = compile(path.join(appRoot, 'src/app.scss')).css.replace(/(-?[\d.]+)rpx\b/g, (_, n) => `${Number(n) / 7.5}vw`)
    .replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  recordingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: path.join(output, 'capture'), size: { width: 390, height: 844 } } });
  const page = await recordingContext.newPage(); watch(page);
  let externalRequests = 0;
  await page.route('**/*', route => {
    if (route.request().url() === 'https://product-demo.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>食养图录 · 浏览器演示</title><div id="root"></div></html>' });
    externalRequests++; return route.abort();
  });
  await page.goto('https://product-demo.test/#/pages/catalog/index');
  await page.addStyleTag({ content: css + `\nbody{margin:0;padding:46px 0 64px}button,input{border:0}.demo-frame__header{position:fixed;top:0;left:0;right:0;height:46px;display:flex;align-items:center;justify-content:center;gap:10px;background:#f7f8f3;border-bottom:1px solid #e1e5db;z-index:20;font-size:15px;color:#264e39}.demo-frame__header small{font-size:10px;font-weight:400;color:#788472}.demo-frame__header button{position:absolute;left:14px;background:transparent;color:#264e39}.demo-frame__tabs{position:fixed;bottom:0;left:0;right:0;height:64px;display:flex;background:white;border-top:1px solid #e1e5db;z-index:20}.demo-frame__tabs button{flex:1;background:transparent;display:flex;flex-direction:column;gap:3px;align-items:center;justify-content:center;font-size:11px;color:#7d877b}.demo-frame__tabs button[aria-current=page]{color:#264e39}.demo-frame__tabs img{height:24px;width:24px}` });
  await page.addScriptTag({ path: path.join(output, 'mini-fixture.js') });
  await expect(page.locator('.ingredient-card')).toHaveCount(12); await pause(page);
  assert(await page.evaluate('([...document.images].filter(img=>!img.hidden)).every(img=>img.complete && img.naturalWidth>0)'));
  await page.screenshot({ path: path.join(output, 'user-home.png') }); report.miniChecks.push('current-public-pages-and-decorations');
  await page.locator('#demo-tab-compare').click(); await expect(page.getByText('把想了解的食材放在一起', { exact: true })).toBeVisible();
  report.miniChecks.push('no-preselected-comparison'); await page.locator('#demo-tab-catalog').click();
  phase('user-search-favorite-and-comparison');
  await page.locator('#catalog-search').fill('百合'); await expect(page.locator('.ingredient-card')).toHaveCount(1); await pause(page);
  await page.getByRole('button', { name: '查看百合详情', exact: true }).click(); await expect(page.locator('.detail-name')).toHaveText('百合'); await pause(page);
  await page.locator('#detail-favorite').click(); await expect(page.locator('#detail-favorite')).toHaveText('取消收藏');
  await page.locator('#detail-compare').click(); await expect(page.locator('#detail-compare')).toHaveText('移出对比'); await pause(page);
  await page.locator('#demo-back').click(); await expect(page.locator('#catalog-search')).toHaveValue('百合'); report.miniChecks.push('search-detail-favorite-return-query');
  await page.getByRole('button', { name: '清除', exact: true }).click(); await page.locator('#catalog-search').fill('山药');
  await page.getByRole('button', { name: '查看山药详情', exact: true }).click(); await expect(page.locator('.detail-name')).toHaveText('山药');
  await page.locator('#detail-compare').click(); await expect(page.locator('#detail-compare')).toHaveText('移出对比');
  await page.getByRole('button', { name: '查看已选对比', exact: true }).click(); await expect(page.locator('.compare-selected__item')).toHaveCount(2);
  await expect(page.locator('.compare-selected')).toContainText('百合'); await expect(page.locator('.compare-selected')).toContainText('山药');
  await pause(page); await page.screenshot({ path: path.join(output, 'user-compare.png') });
  await page.locator('#compare-differences').check(); await pause(page); report.miniChecks.push('two-actually-selected-items-and-difference-filter');
  await page.locator('#demo-tab-favorites').click(); await expect(page.locator('.ingredient-card')).toHaveCount(1);
  await expect(page.locator('.ingredient-card__name')).toHaveText('百合'); await pause(page); report.miniChecks.push('favorite-visible');
  await page.locator('#demo-tab-safety').click(); await expect(page.locator('#safety-allergies')).toHaveValue(''); await pause(page);
  await page.locator('#demo-tab-about').click(); await page.locator('#reading-size-large').click(); await expect(page.locator('.page--large')).toBeVisible(); await pause(page);
  report.miniChecks.push('safety-without-personal-input-and-reading-size');
  await page.locator('#demo-confirm-delete').evaluate(button => button.click());
  await page.locator('#delete-local-records').click(); await pause(page);
  await page.locator('#demo-tab-favorites').click(); await expect(page.locator('.ingredient-card')).toHaveCount(0);
  await page.locator('#demo-tab-compare').click(); await expect(page.getByText('把想了解的食材放在一起', { exact: true })).toBeVisible();
  await page.locator('#demo-tab-catalog').click(); await expect(page.locator('#catalog-search')).toHaveValue(''); await pause(page);
  assert.equal(externalRequests, 0); assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth+1'), false);
  report.miniChecks.push('fixture-only-privacy-delete-and-no-network');
  await recordClosed(recordingContext, page, 'user-flow.webm', 'current_mini_react_pages_browser_adapter_not_wechat');

  phase('prepare-isolated-compiled-backend');
  prepared = await prepareLocalDemo(platform);
  report.demoId = prepared.demoId; // No credential path or values in deliverables.
  const users = JSON.parse(fs.readFileSync(prepared.credentialsFile, 'utf8')).accounts;
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  service = await launchCompiledDemo(platform, prepared.demoId, port); report.applicationStarts++;
  const origin = service.url;
  const states = {};
  for (const role of ['editor', 'reviewer']) {
    phase('authenticate-isolated-' + role);
    const authentication = { role, statuses: [], loginStatus: null, loginResponseMs: null }; report.privateAuthentication.push(authentication);
    const privateContext = await browser.newContext();
    try {
      await privateContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const privatePage = await privateContext.newPage(), user = users.find(user => user.role === role); assert(user);
      privatePage.on('response', response => { const url = new URL(response.url());
        if (url.origin === origin && ['/api/v1/auth/config', '/api/v1/auth/session', '/api/v1/auth/login'].includes(url.pathname)) authentication.statuses.push({ path: url.pathname, status: response.status() }); });
      await privatePage.goto(origin); await privatePage.getByLabel('用户名', { exact: true }).fill(user.username);
      await privatePage.getByLabel('密码', { exact: true }).fill(user.password);
      const started = Date.now(), response = privatePage.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
      await privatePage.getByRole('button', { name: /登录工作台/ }).click();
      const result = await response; authentication.loginStatus = result.status(); authentication.loginResponseMs = Date.now() - started; save();
      assert.equal(result.status(), 200, 'Isolated demo login rejected; do not resend or record credentials');
      await expect(privatePage.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible(); states[role] = await privateContext.storageState();
    } finally { await privateContext.close(); }
  }
  recordingContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: states.editor,
    recordVideo: { dir: path.join(output, 'capture'), size: { width: 1280, height: 900 } } });
  await recordingContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const editor = await recordingContext.newPage(); watch(editor);
  const catalog = await (await recordingContext.request.get(origin + '/api/v1/public/catalog')).json();
  assert.equal(catalog.items.length, 106); report.releaseId = catalog.releaseId;
  const publicBefore = JSON.stringify(catalog);
  await editor.goto(origin); await expect(editor.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
  const scriptUrl = await editor.locator('script[type=module][src]').getAttribute('src'); assert(scriptUrl && /^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(scriptUrl));
  const served = await recordingContext.request.get(origin + scriptUrl); assert.equal(served.status(), 200);
  assert.equal(sha(await served.body()), sha(fs.readFileSync(path.join(platform, 'dist', scriptUrl.slice(1)))));
  report.backendChecks.push('actual-built-react-and-compiled-api');
  await pause(editor); phase('record-editor-source-and-draft');
  await editor.getByRole('textbox', { name: '搜索食材', exact: true }).fill('黄芪'); await editor.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await editor.getByLabel('编辑备注', { exact: true }).fill('演示备注：核对名称、来源与内容版本。');
  await editor.getByRole('button', { name: '保存备注', exact: true }).click(); await expect(editor.getByRole('status', { name: '备注保存结果' })).toContainText('已保存'); await pause(editor);
  await editor.getByRole('button', { name: '内容协作', exact: true }).click(); await editor.getByRole('button', { name: '来源登记', exact: true }).click();
  const sourceTitle = '项目演示来源（非正式依据）';
  await editor.getByLabel('来源标题', { exact: true }).fill(sourceTitle); await editor.getByLabel('来源发布机构').fill('演示占位');
  await editor.getByLabel('来源原始网址').fill('https://example.org/demo-only'); await editor.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(editor.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存'); await pause(editor);
  async function chooseDraft() {
    await editor.getByRole('button', { name: '内容修订', exact: true }).click(); await editor.getByLabel('搜索待编辑食材').fill('黄芪');
    await editor.getByRole('button', { name: '编辑黄芪内容', exact: true }).click(); await expect(editor.getByLabel('草稿教育说明')).toBeVisible();
  }
  await chooseDraft(); const draft = '演示：整理食材名称、部位、加工形态与来源，不作个体食用建议。';
  await editor.getByLabel('草稿教育说明').fill(draft); await editor.getByLabel('草稿安全边界').fill('演示草稿保持私有，不作诊断、处方或安全保证。');
  await editor.getByLabel('搜索可引用来源').fill(sourceTitle); await editor.getByRole('button', { name: '引用此来源', exact: true }).click();
  await editor.getByLabel(sourceTitle + '的原文定位').fill('仅演示固定引用流程');
  await editor.getByRole('button', { name: '保存内容草稿', exact: true }).click(); await expect(editor.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿'); await pause(editor);
  await editor.getByRole('button', { name: '提交编辑审阅', exact: true }).click(); await expect(editor.getByRole('status', { name: '内容草稿结果' })).toContainText('已提交编辑审阅'); await pause(editor);
  report.backendChecks.push('ui-source-fixed-reference-save-and-submit');
  phase('record-independent-editorial-review');
  await recordingContext.clearCookies(); await recordingContext.addCookies(states.reviewer.cookies); await editor.goto(origin);
  await editor.getByRole('button', { name: '内容协作', exact: true }).click(); await editor.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
  await editor.getByRole('button', { name: '审阅黄芪修订1', exact: true }).click();
  await editor.getByLabel('编辑审阅意见').fill('演示资料整理流程通过；不代表专业签审或允许公开。'); await pause(editor);
  await editor.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true }).click(); await expect(editor.getByRole('status', { name: '编辑审阅结果' })).toContainText('仍为私有待专业审校'); await pause(editor);
  report.backendChecks.push('separate-authenticated-reviewer-no-publication');
  await recordingContext.clearCookies(); await recordingContext.addCookies(states.editor.cookies); await editor.goto(origin);
  await editor.getByRole('button', { name: '内容协作', exact: true }).click(); await chooseDraft();
  await expect(editor.getByText('编辑审阅通过 · 未发布', { exact: true })).toBeVisible(); await pause(editor);
  await editor.screenshot({ path: path.join(output, 'editorial-flow.png') });
  phase('restart-same-isolated-database');
  await service.close(); report.gracefulStops++; service = undefined;
  service = await launchCompiledDemo(platform, prepared.demoId, port); report.applicationStarts++;
  await editor.reload(); await editor.getByRole('button', { name: '内容协作', exact: true }).click(); await chooseDraft();
  await expect(editor.getByLabel('草稿教育说明')).toHaveValue(draft); await expect(editor.getByText('编辑审阅通过 · 未发布', { exact: true })).toBeVisible(); await pause(editor);
  report.backendChecks.push('same-database-process-restart-keeps-draft-and-review');
  assert.equal(JSON.stringify(await (await recordingContext.request.get(origin + '/api/v1/public/catalog')).json()), publicBefore);
  assert.equal((await recordingContext.request.get(origin + '/api/v1/public/education/huang-qi')).status(), 503);
  const assistant = await (await recordingContext.request.get(origin + '/api/v1/editorial/assistant/config')).json(); assert.equal(assistant.enabled, false);
  report.backendChecks.push('private-draft-stays-private-and-real-ai-disabled');
  await recordClosed(recordingContext, editor, 'editorial-flow.webm', 'actual_compiled_react_express_sqlite_not_production');
  await service.close(); report.gracefulStops++; service = undefined;
  assert.deepEqual(report.errors, []); phase('verify-playback');
  const indexHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>食养图录 · 项目演示</title>
<style>body{margin:0;background:#f4f6ef;color:#294b39;font:16px/1.7 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:28px 20px}h1{font-size:30px;margin:0}h2{font-size:21px;margin-bottom:8px}p{color:#68765f}section{background:white;border:1px solid #e0e6d8;border-radius:20px;padding:22px;margin:24px 0}video{display:block;width:100%;background:#eef2e8;border-radius:12px}.user video{max-width:390px;max-height:844px;margin:auto}small{color:#68765f}a{color:#31593c}.note{padding:14px;background:#edf1e5;border-radius:10px}</style>
<main><h1>食养图录</h1><p>用户查阅与内容协作 · 本地工程演示</p>
<section class="user"><h2>查找、收藏与对比</h2><p>从空记录开始搜索百合、查看详情、收藏，再选择山药对比；演示字号设置与清理记录。</p>
<video controls preload="metadata" poster="user-home.png" src="user-flow.webm" aria-label="用户端浏览器流程录像"></video><p class="note">当前Taro/React页面使用浏览器适配录制，导航及存储为演示替身。这不是微信真机录屏，也不是H5交付。插画与部位示意不作为食材实拍。</p></section>
<section><h2>后台编辑与独立审阅</h2><p>真实React生产页面 → 编译Express API → 独立SQLite。保存备注、登记演示来源、固定引用、提交与独立编辑审阅，再重启同一服务核对保留结果。</p>
<video controls preload="metadata" poster="editorial-flow.png" src="editorial-flow.webm" aria-label="真实后台协作录像"></video><p class="note">录制在登录后开始，没有录入密码或真实健康信息。演示来源不是真实依据，编辑审阅不等于专业签审；新内容保持私有，真实AI和公开教育内容均关闭。</p></section>
<p><a href="report.json">运行证据</a> · 尚未证明公网部署、Docker运行、手机验收或本人独立掌握。不要分享演示数据库或凭据文件。</p></main></html>`;
  fs.writeFileSync(path.join(output, 'index.html'), indexHtml, { flag: 'wx' });
  const playbackContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  try {
    const allowedFiles = new Map([['/', { type: 'text/html', bytes: Buffer.from(indexHtml) }], ...['user-home.png', 'editorial-flow.png'].map(filename => ['/' + filename,
      { type: 'image/png', bytes: fs.readFileSync(path.join(output, filename)) }]), ...report.clips.map(clip => ['/' + clip.filename,
      { type: 'video/webm', bytes: fs.readFileSync(path.join(output, clip.filename)) }])]);
    await playbackContext.route('**/*', route => {
      const url = new URL(route.request().url()), file = url.origin === 'https://demo-playback.test' && allowedFiles.get(url.pathname);
      return file ? route.fulfill({ contentType: file.type, body: file.bytes }) : route.abort();
    });
    const playback = await playbackContext.newPage(); watch(playback); await playback.goto('https://demo-playback.test/');
    for (const [index, clip] of report.clips.entries()) {
      const video = playback.locator('video').nth(index); await video.scrollIntoViewIfNeeded();
      await video.evaluate(element => { element.preload = 'auto'; element.load(); });
      await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
      await video.evaluate(element => { element.currentTime = 2; });
      await expect.poll(() => video.evaluate(element => !element.seeking && element.readyState >= 2), { timeout: 10000 }).toBe(true);
      const info = await video.evaluate(async element => { await element.play(); await new Promise(resolve => setTimeout(resolve, 350)); element.pause();
        return { duration: element.duration, width: element.videoWidth, height: element.videoHeight, advanced: element.currentTime > 0, error: element.error?.code ?? null }; });
      assert(Number.isFinite(info.duration) && info.duration > 5 && info.advanced && info.error === null);
      assert.equal(info.width, index === 0 ? 390 : 1280); assert.equal(info.height, index === 0 ? 844 : 900);
      clip.playbackVerified = true; clip.durationSeconds = info.duration; clip.width = info.width; clip.height = info.height;
      await video.screenshot({ path: path.join(output, index === 0 ? 'user-video-frame.png' : 'editorial-video-frame.png') });
    }
    assert.deepEqual(report.errors, []); report.status = 'passed'; report.phase = 'complete';
  } finally { await playbackContext.close(); activePage = undefined; }
} catch (error) {
  report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Recording failed'); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) try { await activePage.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }); } catch { report.failureCaptureUnavailable = true; }
} finally {
  try { if (recordingContext) await recordingContext.close(); } catch { report.errors.push('Recording context cleanup failed'); report.status = 'failed'; process.exitCode = 1; }
  try { if (service) { await service.close(); report.gracefulStops++; service = undefined; } } catch { report.errors.push('Owned backend did not stop normally'); report.status = 'failed'; process.exitCode = 1; }
  let browserStopped = !browser;
  try { await browser?.close(); browserStopped = true; } catch { report.errors.push('Recording browser cleanup failed'); report.status = 'failed'; process.exitCode = 1; }
  report.fixturesStopped = !service && browserStopped;
  report.workingDatabaseUnchanged = (fs.existsSync(workingFile) ? sha(fs.readFileSync(workingFile)) : null) === before;
  if (!report.workingDatabaseUnchanged) { report.status = 'failed'; report.errors.push('Working database changed'); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ output, status: report.status, phase: report.phase, clips: report.clips.length, fixturesStopped: report.fixturesStopped }));
}
