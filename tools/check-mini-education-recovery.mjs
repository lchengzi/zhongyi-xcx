import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compile } from 'sass';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/miniprogram');
const { chromium, expect } = createRequire(path.join(root, 'zhongyi-platform/package.json'))('@playwright/test');
const origin = 'https://content.food-education.test', api = origin + '/api/v1/public/education/';
const release = JSON.parse(fs.readFileSync(path.join(app, 'src/data/catalog-release.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(app, 'src/data/catalog.json'), 'utf8'));
const parent = path.join(root, '.refactor/evidence/education-recovery-runs');
fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
const report = { schemaVersion: 1, scope: 'actual_detail_hook_client_and_page_with_test_only_network_and_lifecycle_adapters',
  wechatRuntimeVerified: false, deviceVerified: false, realBackendVerified: false, nativeModalVerified: false,
  realProfessionalApproval: false, status: 'running', startedAt: new Date().toISOString(), cases: [], errors: [] };
let browser, activePage;
try {
  await build({ entryPoints: [path.join(app, 'tests/visual/education-entry.tsx')], bundle: true,
    outfile: path.join(output, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.jpg': 'dataurl', '.png': 'dataurl' },
    define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: JSON.stringify(origin), 'process.env.NODE_ENV': '"production"' },
    alias: { '@tarojs/components': path.join(app, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(app, 'tests/visual/taro.ts'),
      '@food-education/catalog-core': path.join(root, 'packages/catalog-core/src/index.ts') } });
  const css = compile(path.join(app, 'src/app.scss')).css.replace(/(-?[\d.]+)rpx\b/g, (_, number) => `${Number(number) / 7.5}vw`)
    .replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
  fs.writeFileSync(path.join(output, 'fixture.css'), css, { flag: 'wx' });
  const script = fs.readFileSync(path.join(output, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const cases = [
    ['cancel_recheck_and_reconnect', async h => {
      await h.ready(1); h.holdNext(); await h.refresh(); await h.requestCount(2);
      await h.offline(); await expect(h.detail.getByText(/连接暂时中断，以下为刚才核对的资料/)).toBeVisible();
      await h.ready(1); h.version(2); await h.online(); await h.ready(2); await h.requestCount(3);
      await h.release(); await h.ready(2); await expect(h.text(1)).toHaveCount(0);
      await h.online(); await h.settle(); assert.equal(h.requests.length, 3, 'duplicate connected events cannot re-read');
      await h.page.screenshot({ path: path.join(output, 'reconnected-viewport.png') });
    }],
    ['offline_expiry_then_withdrawal', async h => {
      await h.ready(1); await h.offline(); await h.ready(1);
      await h.page.clock.fastForward(61_000); await expect(h.text(1)).toHaveCount(0);
      await expect(h.detail.getByText(/补充资料暂时无法读取/)).toBeVisible();
      await h.page.screenshot({ path: path.join(output, 'offline-expired-viewport.png') });
      assert.equal(h.requests.length, 1, 'expiry must not poll or request while offline');
      h.version(2); await h.online(); await h.ready(2);
      h.status(404); await h.offline(); await h.online();
      await expect(h.detail.getByText(/目前没有可用的补充资料/)).toBeVisible(); await expect(h.text(2)).toHaveCount(0);
      await h.requestCount(3);
    }],
    ['hidden_detail_and_confirmed_deletion', async h => {
      await h.ready(1); h.holdNext(); await h.refresh(); await h.requestCount(2);
      await h.page.getByRole('button', { name: '测试关于页', exact: true }).click(); await expect(h.detail).toBeHidden();
      await h.offline(); await h.online(); await h.settle(); assert.equal(h.requests.length, 2);
      await h.page.getByRole('button', { name: '允许下一次测试确认', exact: true }).click();
      await h.page.locator('#delete-local-records').click();
      await expect(h.page.locator('#test-about').getByText('0 项', { exact: true })).toHaveCount(2);
      await h.release(); await h.settle(); assert.equal(h.requests.length, 2); await expect(h.text(1)).toHaveCount(0);
      h.version(2); await h.page.getByRole('button', { name: '测试百合页', exact: true }).click(); await h.ready(2); await h.requestCount(3);
    }],
    ['privacy_epoch_requires_new_reading_action', async h => {
      await h.ready(1); await h.page.getByRole('button', { name: '清除测试会话', exact: true }).click();
      await expect(h.text(1)).toHaveCount(0); h.version(2);
      await h.offline(); await h.online(); await h.settle(); assert.equal(h.requests.length, 1);
      await h.refresh(); await h.ready(2); await h.requestCount(2);
    }],
    ['red_flag_cancels_before_late_result', async h => {
      await h.ready(1); h.holdNext(); await h.refresh(); await h.requestCount(2);
      await h.page.getByRole('button', { name: '添加测试红旗', exact: true }).click();
      await expect(h.detail.locator('.urgent-notice')).toBeVisible(); await expect(h.text(1)).toHaveCount(0);
      await h.offline(); await h.online(); await h.release(); await h.settle();
      assert.equal(h.requests.length, 2); await expect(h.detail.locator('.urgent-notice')).toBeVisible();
    }],
    ['ingredient_A_B_A_rejects_old_request', async h => {
      await h.ready(1); h.holdNext(); await h.refresh(); await h.requestCount(2);
      h.version(5); await h.page.getByRole('button', { name: '测试山药页', exact: true }).click();
      await h.ready(5, '山药'); await expect(h.detail.locator('.detail-name')).toHaveText('山药');
      h.version(2); await h.page.getByRole('button', { name: '测试百合页', exact: true }).click(); await h.ready(2);
      await h.release(); await h.settle(); await h.ready(2); await expect(h.text(1)).toHaveCount(0); await h.requestCount(4);
    }],
  ];
  for (const [name, run] of cases) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); activePage = page;
    const requests = [], routeErrors = [], holds = [];
    let version = 1, status = 200, holdNext = false;
    const now = Date.now();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.clock.install({ time: now });
    await page.route('https://mini-layout.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>' }));
    await page.route(api + '**', async route => {
      try {
        const request = route.request();
        assert.equal(request.method(), 'GET'); assert.equal(request.postData(), null);
        assert.equal(request.headers().accept, 'application/json'); assert.equal(request.headers().authorization, undefined); assert.equal(request.headers().cookie, undefined);
        const id = request.url().slice(api.length); assert.ok(/^[a-z-]+$/.test(id));
        requests.push({ id, method: request.method() });
        const body = payload(id, version, now), responseStatus = status;
        if (holdNext) { holdNext = false; await new Promise(resolve => holds.push(resolve)); }
        try { await route.fulfill({ status: responseStatus, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(responseStatus === 200 ? body : {}) }); }
        catch (error) { if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? '')) throw error; }
      } catch (error) { routeErrors.push(error instanceof Error ? error.message : 'Unknown route failure'); await route.abort().catch(() => {}); }
    });
    await page.goto('https://mini-layout.test/#/subpackages/catalog/detail/index?id=bai-he');
    await page.addStyleTag({ content: `${css}\nbody{margin:0} button,input{border:0} .test-navigation{display:flex;gap:8px;padding:8px;flex-wrap:wrap} .test-navigation button{font-size:14px;padding:8px;border:1px solid #ddd}` });
    await page.addScriptTag({ content: script });
    const detail = page.locator('#test-detail');
    const text = (v, label = '百合') => detail.getByText(`教育工程测试资料 v${v} · ${label}`, { exact: true });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const release = async () => { for (const resolve of holds.splice(0)) resolve(); await settle(); };
    const h = { page, detail, requests, text, settle, release,
      ready: (v, label) => expect(text(v, label)).toBeVisible(),
      requestCount: count => expect.poll(() => requests.length).toBe(count),
      refresh: () => detail.getByRole('button', { name: '重新核对更新', exact: true }).click(),
      offline: () => page.getByRole('button', { name: '测试断网', exact: true }).click(),
      online: () => page.getByRole('button', { name: '测试重连', exact: true }).click(),
      version(value) { version = value; }, status(value) { status = value; }, holdNext() { holdNext = true; } };
    console.log(`Education recovery case: ${name}`);
    await run(h); await release(); await settle(); assert.deepEqual(routeErrors, []); assert.deepEqual(report.errors, []);
    report.cases.push({ name, status: 'passed', anonymousRequests: requests.length });
    await context.close(); activePage = undefined;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown recovery-fixture error'); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) {
    try { await activePage.screenshot({ path: path.join(output, 'failure-viewport.png'), timeout: 5000 }); }
    catch { report.failureCaptureUnavailable = true; }
  }
} finally {
  await browser?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, status: report.status, cases: report.cases.length, errors: report.errors }));
}
function payload(id, version, now) {
  const item = catalog.ingredients.find(value => value.id === id); assert.ok(item, 'Unknown owned fixture ingredient');
  return { ingredientId: id, name: item.name, baseReleaseId: release.releaseId, scope: 'ingredient_education',
    snapshotId: `browser-test-${id}-${version}`, snapshotVersion: version, contentRevision: version,
    publishedAt: new Date(now - 60_000).toISOString(), ediblePart: '隔离页面测试，不用于实际食用', latinName: '',
    educationText: `教育工程测试资料 v${version} · ${item.name}`, safetyText: '仅工程测试；不代表真实专业审校或食用建议。',
    boundary: '非医疗食养教育，不用于诊断、治疗、个体化开方或用药指导。',
    sources: [{ title: '页面测试固定来源', publisher: 'Fixture', url: 'https://example.org/fixture', locator: '测试定位',
      checkedAt: new Date(now - 120_000).toISOString(), validUntil: new Date(now + 3_600_000).toISOString() }] };
}
