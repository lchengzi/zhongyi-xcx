import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compile } from 'sass';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requirePlatform = createRequire(path.join(workspace, 'zhongyi-platform/package.json'));
const { chromium } = requirePlatform('@playwright/test');
const app = path.join(workspace, 'apps/miniprogram');
const outputParent = path.join(workspace, '.refactor/evidence/reading-layout-runs');
fs.mkdirSync(outputParent, { recursive: true });
const output = fs.mkdtempSync(path.join(outputParent, 'run-'));
const report = { schemaVersion: 1, scope: 'actual_mini_react_pages_with_test_only_dom_taro_adapters',
  wechatRuntimeVerified: false, deviceVerified: false, systemFontVerified: false, h5Delivery: false,
  status: 'running', startedAt: new Date().toISOString(), checks: [], errors: [] };
let browser, activePage;
try {
  await build({ entryPoints: [path.join(app, 'tests/visual/entry.tsx')], bundle: true,
    outfile: path.join(output, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.jpg': 'dataurl', '.png': 'dataurl' },
    define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: 'null', 'process.env.NODE_ENV': '"production"' },
    alias: { '@tarojs/components': path.join(app, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(app, 'tests/visual/taro.ts'),
      '@food-education/catalog-core': path.join(workspace, 'packages/catalog-core/src/index.ts') } });
  const css = compile(path.join(app, 'src/app.scss')).css
    // rpx is 1/750 of the viewport width. This is layout emulation, not a claim
    // about native input rendering or WeChat's pixel rounding and font setting.
    .replace(/(-?[\d.]+)rpx\b/g, (_, number) => `${Number(number) / 7.5}vw`)
    .replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
  fs.writeFileSync(path.join(output, 'fixture.css'), css, { flag: 'wx' });
  const script = fs.readFileSync(path.join(output, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [320, 360, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', error => { report.errors.push(error.message); });
    await page.route('https://mini-layout.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>' }));
    await page.goto('https://mini-layout.test/#/pages/about/index');
    await page.addStyleTag({ content: `${css}\nbody{margin:0} button,input{border:0} .test-navigation{display:flex;gap:8px;padding:8px;flex-wrap:wrap} .test-navigation button{font-size:14px;padding:8px;border:1px solid #ddd}` });
    await page.addScriptTag({ content: script });
    await page.locator('#reading-size-standard').waitFor();
    const sizes = ['standard', 'large', 'extra-large'];
    for (const size of sizes) {
      await page.locator('#reading-size-' + size).click();
      await page.locator('.page--' + size).waitFor();
      const padding = await page.locator('.page').evaluate(element => parseFloat(getComputedStyle(element).paddingLeft));
      assert.ok(Math.abs(padding - 28 * width / 750) < 0.05, 'fixture must retain the production .page spacing');
      await assertFits(page, `${width}/${size}/about`, report);
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-about-extra-large.png`), fullPage: true });
      await page.getByRole('button', { name: '收藏页', exact: true }).click();
      await page.getByText('先收藏一份感兴趣的资料', { exact: true }).waitFor();
      await page.locator('.page--' + size).waitFor();
      await assertFits(page, `${width}/${size}/favorites-empty`, report);
      await page.getByRole('button', { name: '安全页', exact: true }).click();
      await page.locator('#safety-allergies').waitFor();
      await page.locator('.page--' + size).waitFor();
      await page.locator('#safety-allergies').fill('仅浏览器布局测试，多项长文字用于检查输入换行，不应用安全信息');
      await assertFits(page, `${width}/${size}/safety-draft`, report);
      assert.equal(await page.locator('.urgent-notice').count(), 0);
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-safety-extra-large.png`), fullPage: true });
      await page.getByRole('button', { name: '对比', exact: true }).click();
      await page.locator('.compare-row__value').first().waitFor();
      await page.locator('.page--' + size).waitFor();
      const valueFont = await page.locator('.compare-row__value').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      const expected = 30 * width / 750 * ({ standard: 1, large: 1.25, 'extra-large': 1.6 }[size]);
      assert.ok(Math.abs(valueFont - expected) < 0.05, 'actual comparison reading font must scale');
      await assertFits(page, `${width}/${size}/compare`, report);
      if (width <= 360 || size !== 'standard') assert.equal(await page.locator('.compare-row__item').first().evaluate(element => getComputedStyle(element).flexDirection), 'column');
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-compare-extra-large.png`), fullPage: true });
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-compare-viewport.png`) });
      const visitDetail = async name => {
        await page.getByRole('button', { name: name + '详情', exact: true }).click();
        await page.locator('.detail-name').filter({ hasText: name }).waitFor();
      };
      for (const name of ['莲子', '薏苡仁']) {
        await visitDetail(name); await page.locator('#detail-compare').click();
        assert.equal(await page.locator('#detail-compare').innerText(), '移出对比');
      }
      await page.getByRole('button', { name: '对比', exact: true }).click();
      await page.locator('.compare-selected__item').nth(3).waitFor();
      assert.equal(await page.locator('#compare-add').isDisabled(), true, 'full comparison cannot offer another addition');
      const readRows = () => page.locator('.compare-row').evaluateAll(elements => elements.map(element => ({
        title: element.querySelector('.compare-row__title')?.textContent,
        different: Boolean(element.querySelector('.compare-row__title .tag')),
        names: Array.from(element.querySelectorAll('.compare-row__name'), value => value.textContent),
        values: Array.from(element.querySelectorAll('.compare-row__value'), value => value.textContent),
      })));
      const fullRows = await readRows();
      assert.ok(fullRows.length > 0);
      assert.ok(fullRows.every(row => row.values.length === 4 && JSON.stringify(row.names) === JSON.stringify(['百合', '山药', '莲子', '薏苡仁'])),
        'every field must retain the four ingredient identities and values');
      await assertFits(page, `${width}/${size}/compare-four`, report);
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-compare-four-viewport.png`) });
      const difference = page.locator('#compare-differences');
      await difference.check(); assert.equal(await difference.isChecked(), true);
      const differentRows = fullRows.filter(row => row.different);
      assert.ok(differentRows.length > 0 && differentRows.length < fullRows.length, 'fixture must exercise differing and shared fields');
      assert.deepEqual(await readRows(), differentRows, 'difference mode may filter rows, not identities or values');
      await assertFits(page, `${width}/${size}/compare-four-differences`, report);
      await difference.uncheck(); assert.deepEqual(await readRows(), fullRows);
      for (const [name, count] of [['薏苡仁', 3], ['莲子', 2], ['山药', 1]]) {
        await page.getByRole('button', { name: '移出' + name, exact: true }).click();
        assert.equal(await page.locator('.compare-selected__item').count(), count);
        assert.equal(await page.locator('#compare-add').isEnabled(), true, 'removal immediately reopens selection');
        assert.ok((await readRows()).every(row => row.values.length === count));
        await assertFits(page, `${width}/${size}/compare-${count}-after-removal`, report);
      }
      assert.equal(await difference.isDisabled(), true); assert.equal(await difference.isChecked(), false);
      await page.getByRole('button', { name: '移出百合', exact: true }).click();
      await page.getByText('把想了解的食材放在一起', { exact: true }).waitFor();
      assert.equal(await page.locator('.compare-row').count(), 0);
      await assertFits(page, `${width}/${size}/compare-empty-after-removal`, report);
      // Restore the two owned fixture records through real detail controls.
      for (const name of ['百合', '山药']) {
        await visitDetail(name); await page.locator('#detail-compare').click();
        assert.equal(await page.locator('#detail-compare').innerText(), '移出对比');
      }
      await page.getByRole('button', { name: '目录', exact: true }).click();
      await page.locator('#catalog-search').waitFor();
      if (await page.locator('#catalog-search').inputValue()) await page.getByRole('button', { name: '清除', exact: true }).click();
      await page.locator('.ingredient-card').nth(11).waitFor();
      await page.locator('.catalog-cover__image').evaluate(async element => { await element.decode(); });
      await page.locator('.ingredient-visual__image').evaluateAll(async elements => { await Promise.all(elements.map(element => element.decode())); });
      const columns = await page.locator('.ingredient-list--grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(columns, size === 'standard' ? 2 : 1, 'large reading modes switch illustrated cards to one column');
      assert.equal(await page.locator('.ingredient-card__monogram').count(), 0, 'default cards use rendered graphics, not first-character placeholders');
      assert.ok(await page.locator('.ingredient-visual__caption').count() >= 12, 'decorative symbols stay identified rather than posing as photos');
      await assertFits(page, `${width}/${size}/catalog-illustrated`, report);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `${width}-catalog-${size}-viewport.png`) });
      if (size === 'standard') {
        const firstImage = page.locator('.ingredient-visual__image').first();
        await firstImage.evaluate(element => element.dispatchEvent(new Event('error')));
        await page.locator('.ingredient-visual__fallback').first().waitFor();
        await assertFits(page, `${width}/${size}/card-image-fallback`, report);
        await page.locator('.catalog-cover__image').evaluate(element => element.dispatchEvent(new Event('error')));
        await page.locator('.catalog-cover__scene--fallback').waitFor();
        assert.equal(await page.locator('#catalog-search').isEnabled(), true, 'cover error does not disable browsing');
        await assertFits(page, `${width}/${size}/cover-image-fallback`, report);
        // Remount only the DOM fixture page; never clear the safety or storage state.
        await page.getByRole('button', { name: '关于', exact: true }).click();
        await page.getByRole('button', { name: '目录', exact: true }).click();
        await page.locator('.catalog-cover__image').waitFor();
      }
      await page.locator('#catalog-search').fill('百合');
      await page.locator('.ingredient-card__name').getByText('百合', { exact: true }).waitFor();
      await assertFits(page, `${width}/${size}/catalog-search`, report);
      const input = await page.locator('#catalog-search').evaluate(element => {
        const style = getComputedStyle(element); return { height: element.getBoundingClientRect().height, font: parseFloat(style.fontSize) };
      });
      assert.ok(input.height > input.font * 1.4, 'search input must leave room for enlarged text');
      await page.getByRole('button', { name: '百合详情', exact: true }).click();
      await page.locator('.detail-name').waitFor();
      await assertFits(page, `${width}/${size}/detail`, report);
      await page.getByRole('button', { name: /来源与记录，已收起/ }).click();
      await page.locator('.source__title').first().waitFor();
      await assertFits(page, `${width}/${size}/detail-sources`, report);
      const actions = await page.locator('.detail-actions .button').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, height: box.height, scroll: element.scrollWidth, width: element.clientWidth };
      }));
      assert.equal(actions.length, 2);
      assert.ok(actions.every(box => box.left >= 0 && box.right <= width && box.height >= 40 && box.scroll <= box.width + 1), 'fixed actions must fit the viewport');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const sourcesDisclosure = page.locator('.detail-page > .disclosure').last();
      const bottom = await sourcesDisclosure.evaluate(element => element.getBoundingClientRect().bottom);
      const actionTop = await page.locator('.detail-actions').evaluate(element => element.getBoundingClientRect().top);
      assert.ok(bottom <= actionTop, 'last expanded content must be scrollable above fixed actions');
      if (size === 'extra-large') await page.screenshot({ path: path.join(output, `${width}-detail-extra-large.png`), fullPage: true });
      if (size === 'extra-large') {
        await page.evaluate(async () => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const finalContentBottom = await sourcesDisclosure.evaluate(element => element.getBoundingClientRect().bottom);
        assert.ok(finalContentBottom <= actionTop, 'viewport screenshot must also show unobscured last content');
        await page.screenshot({ path: path.join(output, `${width}-detail-bottom-viewport.png`) });
      }
      await page.locator('#detail-favorite').click();
      await page.getByRole('button', { name: '收藏页', exact: true }).click();
      await page.locator('#favorites-search').waitFor();
      await assertFits(page, `${width}/${size}/favorites-populated`, report);
      await page.locator('#favorites-search').fill('不存在的布局测试食材');
      await page.getByText('收藏中没有匹配的条目', { exact: true }).waitFor();
      assert.equal(await page.locator('#favorites-search').inputValue(), '不存在的布局测试食材', 'long search words must remain intact');
      await page.locator('#favorites-search').press('End');
      const field = await page.locator('#favorites-search').evaluate(element => {
        const box = element.getBoundingClientRect(), parent = element.parentElement?.getBoundingClientRect();
        return { left: box.left, right: box.right, parentLeft: parent?.left, parentRight: parent?.right,
          width: element.clientWidth, contentWidth: element.scrollWidth, scrollLeft: element.scrollLeft };
      });
      assert.ok(field.parentLeft !== undefined && field.parentRight !== undefined && field.left >= field.parentLeft && field.right <= field.parentRight,
        'a long single-line input must remain inside its search container');
      await assertFits(page, `${width}/${size}/favorites-no-match`, report);
      await page.getByRole('button', { name: '清除', exact: true }).click();
      await page.getByRole('button', { name: '取消收藏', exact: true }).click();
      await page.getByText('先收藏一份感兴趣的资料', { exact: true }).waitFor();
      await page.getByRole('button', { name: '关于', exact: true }).click();
      await page.locator('#reading-size-' + size).waitFor();
    }
    await page.locator('#reading-size-standard').click();
    await page.locator('.page--standard').waitFor();
    await context.close();
    activePage = undefined;
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown fixture error');
  if (activePage && !activePage.isClosed()) {
    try {
      report.failurePage = await activePage.evaluate(() => ({ url: location.href, viewport: innerWidth,
        pageClass: document.querySelector('.page')?.className, width: document.documentElement.scrollWidth,
        choice: document.querySelector('#reading-size-standard')?.getBoundingClientRect().toJSON() }));
      await activePage.screenshot({ path: path.join(output, 'failure-viewport.png'), timeout: 5000 });
    } catch { report.failureCaptureUnavailable = true; }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, status: report.status, checks: report.checks.length, errors: report.errors }));
}
async function assertFits(page, label, target) {
  const documentWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(documentWidth.content <= documentWidth.viewport + 1, `${label}: page must not scroll horizontally`);
  const overflowing = await page.locator('.page, .page *').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    // A single-line native input scrolls its text internally. That is distinct
    // from either its border box or the page escaping the viewport. Text blocks
    // retain the internal-overflow check; do not hide overflow to make it pass.
    const contentOverflow = !(element instanceof HTMLInputElement) && element.scrollWidth > element.clientWidth + 2;
    if (box.width && (box.left < -1 || box.right > innerWidth + 1 || contentOverflow)) {
      return [{ tag: element.tagName, class: element.className, left: box.left, right: box.right, width: element.clientWidth, scroll: element.scrollWidth }];
    }
    return [];
  }));
  assert.deepEqual(overflowing, [], `${label}: overflowing elements`);
  target.checks.push({ label, status: 'passed' });
}
