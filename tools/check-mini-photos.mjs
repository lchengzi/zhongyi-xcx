import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'sass';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'zhongyi-platform/package.json'));
const { chromium, expect } = require('@playwright/test');
const parent = path.join(root, '.refactor/evidence/photo-ui-runs'); fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
const app = path.join(root, 'apps/miniprogram');
await build({ entryPoints: [path.join(app, 'tests/visual/photo-entry.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl' }, define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: 'null', 'process.env.NODE_ENV': '"production"' },
  alias: { '@tarojs/components': path.join(app, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(app, 'tests/visual/taro.ts'), '@food-education/catalog-core': path.join(root, 'packages/catalog-core/src/index.ts') } });
const css = compile(path.join(app, 'src/app.scss')).css.replace(/(-?[\d.]+)rpx\b/g, (_, n) => `${Number(n) / 7.5}vw`).replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
let checks = 0; const errors = [];
try {
  for (const width of [320, 390]) {
   for (const size of ['standard', 'large', 'extra-large']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    let failSecond = true;
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url === 'https://photo-ui.test/') return route.fulfill({ contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div></html>' });
      if (url.startsWith('https://photos.example.test/api/v1/public/photos/')) {
        if (url.endsWith('a'.repeat(64) + '.jpg')) await firstGate;
        if (url.endsWith('b'.repeat(64) + '.jpg') && failSecond) return route.fulfill({ status: 410, body: '' });
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="48" height="48" fill="#a6c6a8"/><rect x="48" width="48" height="48" fill="#e5bd86"/></svg>' });
      }
      return route.abort();
    });
    await page.goto('https://photo-ui.test/');
    await page.addStyleTag({ content: css + '\nbody{margin:0}button{border:0}' });
    await page.addScriptTag({ path: path.join(output, 'fixture.js') });
    await page.locator('.page').evaluate((element, size) => { element.classList.add('page--' + size); }, size);
    await expect(page.locator('.ingredient-photos__loading')).toHaveText('照片加载中…'); checks++;
    const loadingFont = await page.locator('.ingredient-photos__loading').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    assert(Math.abs(loadingFont - 26 * width / 750 * ({ standard: 1, large: 1.25, 'extra-large': 1.6 }[size])) < .1); checks++;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
    await expect(page.locator('.ingredient-photos__error')).toHaveCount(0); checks++;
    if (width === 390 && size === 'standard') await page.screenshot({ path: path.join(output, '390-standard-loading.png'), fullPage: true });
    releaseFirst();
    await page.locator('.ingredient-photos__image').evaluate(image => image.decode()); checks++;
    await expect(page.locator('.ingredient-photos__loading')).toHaveCount(0); checks++;
    await page.getByRole('button', { name: '查看照片 2：工程测试图 2（非食材照片）', exact: true }).click();
    await page.getByText('照片暂时无法加载', { exact: true }).waitFor(); checks++;
    failSecond = false; await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.locator('.ingredient-photos__image').evaluate(image => image.decode()); checks++;
    await page.locator('.disclosure__toggle').click(); await page.getByRole('button', { name: '复制照片来源 ↗', exact: true }).waitFor(); checks++;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
    const font = await page.locator('.ingredient-photos__caption').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    assert(Math.abs(font - 30 * width / 750 * ({ standard: 1, large: 1.25, 'extra-large': 1.6 }[size])) < .1); checks++;
    await page.screenshot({ path: path.join(output, `${width}-${size}-gallery.png`), fullPage: true });
    await page.locator('#withdraw').click(); await page.locator('.ingredient-visual').waitFor();
    assert.equal(await page.locator('.ingredient-photos').count(), 0); checks++;
    await page.close();
   }
  }
  // A held image response models a connection that neither loads nor errors.
  // Clock advancement proves the UI deadline without sleeping 15 seconds.
  for (const scenario of ['timeout_and_guarded_retry', 'switch_while_loading', 'withdraw_while_loading']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    const clockStart = new Date();
    await page.clock.install({ time: clockStart });
    // install alone still advances with wall time. Freeze before rendering so
    // 14999 + 1 tests the exact deadline rather than browser setup overhead.
    await page.clock.pauseAt(new Date(clockStart.getTime() + 5000));
    let hold = true, release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url === 'https://photo-ui.test/') return route.fulfill({ contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div></html>' });
      if (url.startsWith('https://photos.example.test/api/v1/public/photos/')) {
        if (hold && url.endsWith('a'.repeat(64) + '.jpg')) await gate;
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="#a6c6a8"/></svg>' });
      }
      return route.abort();
    });
    await page.goto('https://photo-ui.test/');
    await page.addStyleTag({ content: css + '\nbody{margin:0}button{border:0}' });
    await page.addScriptTag({ path: path.join(output, 'fixture.js') });
    await expect(page.locator('.ingredient-photos__loading')).toBeVisible(); checks++;
    if (scenario === 'timeout_and_guarded_retry') {
      await page.clock.runFor(14999);
      await expect(page.locator('.ingredient-photos__loading')).toBeVisible(); checks++;
      await page.clock.runFor(1);
      await expect(page.getByText('照片暂时无法加载', { exact: true })).toBeVisible(); checks++;
      await expect(page.locator('.ingredient-photos__image')).toHaveCount(0); checks++;
      await page.screenshot({ path: path.join(output, '390-timeout-error.png'), fullPage: true });
      await page.locator('#block-interaction').click();
      await page.getByRole('button', { name: '重新加载', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect(page.locator('.ingredient-photos__loading')).toHaveCount(0); checks++;
      await expect(page.getByText('照片暂时无法加载', { exact: true })).toBeVisible(); checks++;
      hold = false; release();
      await page.locator('#resume-interaction').click();
      await page.getByRole('button', { name: '重新加载', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.locator('.ingredient-photos__image').evaluate(image => image.decode()); checks++;
      await expect(page.locator('.ingredient-photos__loading')).toHaveCount(0); checks++;
      await page.clock.runFor(15000);
      await expect(page.locator('.ingredient-photos__error')).toHaveCount(0); checks++;
      await page.screenshot({ path: path.join(output, '390-timeout-retry.png'), fullPage: true });
    } else if (scenario === 'switch_while_loading') {
      await page.getByRole('button', { name: '查看照片 2：工程测试图 2（非食材照片）', exact: true }).click();
      await page.locator('.ingredient-photos__image').evaluate(image => image.decode()); checks++;
      await page.clock.runFor(15000);
      await expect(page.locator('.ingredient-photos__error')).toHaveCount(0); checks++;
      await expect(page.locator('.ingredient-photos__caption')).toHaveText('工程测试图 2（非食材照片）'); checks++;
      release();
    } else {
      await page.locator('#withdraw').click();
      await page.clock.runFor(15000); release();
      await expect(page.locator('.ingredient-photos')).toHaveCount(0); checks++;
      await expect(page.locator('.ingredient-visual')).toBeVisible(); checks++;
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  const report = { status: 'passed', checks, errors, imageLoadingDeadlineMs: 15000,
    newScenarios: ['loading_then_success_font_matrix', 'timeout_and_guarded_retry', 'switch_while_loading', 'withdraw_while_loading'],
    nativeImageEventsVerified: false, actualPhotosPublished: 0, deviceVerified: false, finishedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ output, ...report }));
} catch (error) {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors,
    error: error instanceof Error ? error.message : String(error), actualPhotosPublished: 0, deviceVerified: false,
    finishedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  console.error(JSON.stringify({ status: 'failed', output })); throw error;
} finally { await browser.close(); }
