import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'sass';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), app = path.join(root, 'apps/miniprogram');
const { chromium, expect } = createRequire(path.join(root, 'zhongyi-platform/package.json'))('@playwright/test');
const origin = 'https://photos.food-education.test', api = origin + '/api/v1/public/photos/';
const catalog = JSON.parse(fs.readFileSync(path.join(app, 'src/data/catalog.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(app, 'src/data/catalog-release.json'), 'utf8'));
const parent = path.join(root, '.refactor/evidence/catalog-photo-runs'); fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
const focus = process.env.MINI_CATALOG_PHOTO_CASE;
const report = { status: 'running', focus: focus ?? null, cases: [], errors: [], actualFoodPhotosPublished: 0, deviceVerified: false };
let browser, activePage;
try {
  await build({ entryPoints: [path.join(app, 'tests/visual/catalog-photo-entry.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.png': 'dataurl', '.jpg': 'dataurl' }, define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: JSON.stringify(origin), 'process.env.NODE_ENV': '"production"' },
    alias: { '@tarojs/components': path.join(app, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(app, 'tests/visual/taro.ts'), '@food-education/catalog-core': path.join(root, 'packages/catalog-core/src/index.ts') } });
  const css = compile(path.join(app, 'src/app.scss')).css.replace(/(-?[\d.]+)rpx\b/g, (_, value) => `${Number(value) / 7.5}vw`).replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  const encoder = await browser.newPage();
  const jpeg = Buffer.from(await encoder.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#adc7a3'; ctx.fillRect(0, 0, 48, 48); ctx.fillStyle = '#ddba83'; ctx.fillRect(48, 0, 48, 48); return canvas.toDataURL('image/jpeg', .84).split(',')[1]; }), 'base64');
  await encoder.close(); const hash = createHash('sha256').update(jpeg).digest('hex');
  const cases = [
    ['catalog_direct_selection_actual_navigation_and_return', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      for (const name of ['百合', '山药']) {
        await h.catalog.locator('#catalog-search').fill(name);
        await h.catalog.getByRole('button', { name: `加入${name}对比`, exact: true }).click();
      }
      await expect(h.catalog.locator('#catalog-compare-summary')).toContainText('已选 2 / 4 项');
      await h.catalog.locator('#catalog-open-compare').click();
      const comparison = h.page.locator('#compare-fixture');
      await expect(comparison.locator('.compare-selected__name')).toHaveText(['百合', '山药']);
      await comparison.locator('#compare-differences').check();
      assert(await comparison.locator('.compare-row').count() > 0);
      await comparison.locator('#compare-add').click();
      await expect(h.catalog.locator('#catalog-search')).toHaveValue('山药');
      await h.catalog.getByRole('button', { name: '移出山药对比', exact: true }).click();
      await expect(h.catalog.locator('#catalog-compare-summary')).toContainText('已选 1 / 4 项');
      await h.catalog.locator('#catalog-open-compare').click();
      await expect(comparison.locator('.compare-selected__name')).toHaveText(['百合']);
      await expect(comparison.locator('#compare-differences')).toBeDisabled();
      await expect(comparison.locator('#compare-differences')).not.toBeChecked();
    }],
    ['catalog_direct_selection_stops_on_red_flags', async h => {
      await h.catalog.locator('#catalog-search').fill('百合');
      await h.catalog.getByRole('button', { name: '加入百合对比', exact: true }).evaluate(button => {
        document.querySelector('nav button:last-child').click(); button.click();
      });
      await expect(h.catalog.locator('.urgent-notice')).toBeVisible();
      await expect(h.catalog.locator('.ingredient-card__compare')).toHaveCount(0);
      await h.page.getByRole('button', { name: '清除测试会话', exact: true }).click();
      await expect(h.catalog.locator('#catalog-compare-summary')).toHaveCount(0);
      await h.page.getByRole('button', { name: '测试对比', exact: true }).click();
      await expect(h.page.locator('#compare-fixture .compare-selected__item')).toHaveCount(0);
    }],
    ['batch_load_more_and_font_matrix', async h => {
      // Existing browse-session defaults to 12, retained unchanged by photos.
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); assert.equal(h.requests.length, 1);
      for (const count of [24, 36, 48]) { await h.catalog.locator('#catalog-load-more').click(); await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(count); }
      assert.equal(h.requests.length, 4);
      for (const width of [320, 390]) for (const size of ['standard', 'large', 'extra-large']) {
        await h.page.setViewportSize({ width, height: 844 });
        await h.catalog.locator('.page').evaluate((element, size) => { element.className = 'page catalog-page page--' + size; }, size);
        await h.catalog.locator('.ingredient-card-photo__image').first().evaluate(image => image.decode());
        assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        const font = await h.catalog.locator('.ingredient-card-photo__credit').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
        assert(Math.abs(font - 18 * width / 750 * ({ standard: 1, large: 1.25, 'extra-large': 1.6 }[size])) < .1);
        await h.catalog.locator('.ingredient-card').first().screenshot({ path: path.join(output, `${width}-${size}-card.png`) });
      }
      assert.equal(h.requests.length, 4, 'layout changes cannot re-read photos');
    }],
    ['actual_search_detail_favorite_and_remove', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await h.catalog.getByRole('textbox', { name: '搜索食材', exact: true }).fill('百合');
      await expect(h.catalog.locator('.ingredient-card')).toHaveCount(1);
      await h.catalog.getByRole('button', { name: '查看百合详情', exact: true }).click();
      await expect(h.page.locator('#detail-fixture .ingredient-photos__image')).toBeVisible();
      await h.page.locator('#detail-favorite').click(); await expect(h.page.locator('#detail-favorite')).toHaveText('取消收藏');
      await h.page.getByRole('button', { name: '测试收藏', exact: true }).click();
      await expect(h.page.locator('#favorites-fixture .ingredient-card-photo__image')).toHaveCount(1);
      await h.page.locator('#favorites-fixture').getByRole('button', { name: '取消收藏', exact: true }).click();
      await expect(h.page.locator('#favorites-fixture .ingredient-card')).toHaveCount(0);
      await h.page.getByRole('button', { name: '测试目录', exact: true }).click();
      await expect(h.catalog.getByRole('textbox', { name: '搜索食材', exact: true })).toHaveValue('百合');
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(1);
    }],
    ['actual_two_item_graphical_comparison_and_return_keeps_search', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await chooseIngredient(h, '百合');
      await h.page.locator('#detail-favorite').click(); await expect(h.page.locator('#detail-favorite')).toHaveText('取消收藏');
      await h.page.locator('#detail-compare').click(); await expect(h.page.locator('#detail-compare')).toHaveText('移出对比');
      await h.page.getByRole('button', { name: '查看已选对比', exact: true }).click();
      const comparison = h.page.locator('#compare-fixture');
      await expect(comparison.locator('.compare-selected__item')).toHaveCount(1);
      await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(1);
      await comparison.locator('#compare-add').click();
      await expect(h.catalog.locator('#catalog-search')).toHaveValue('百合');
      await chooseIngredient(h, '山药'); await h.page.locator('#detail-compare').click();
      await h.page.getByRole('button', { name: '查看已选对比', exact: true }).click();
      await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(2);
      await expect(comparison.locator('.compare-selection-heading')).toContainText('已选 2 / 4 项');
      const names = await comparison.locator('.compare-row').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('.compare-row__name')].map(node => node.textContent)));
      assert(names.length > 0 && names.every(row => JSON.stringify(row) === JSON.stringify(['百合', '山药'])));
      await comparison.getByRole('button', { name: '查看百合详情', exact: true }).click();
      await expect(h.page.locator('#detail-favorite')).toHaveText('取消收藏');
      await expect(h.page.locator('#detail-compare')).toHaveText('移出对比');
      await h.page.getByRole('button', { name: '查看已选对比', exact: true }).click();
      await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(2);
      for (const [width, size] of [[390, 'standard'], [320, 'extra-large']]) {
        await h.page.setViewportSize({ width, height: 844 });
        await comparison.locator('.page').evaluate((element, value) => { element.className = 'page page--' + value; }, size);
        assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await comparison.locator('.ingredient-card-photo__image').evaluateAll(async images => { await Promise.all(images.map(image => image.decode())); });
        const columns = await comparison.locator('.compare-selected').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
        assert.equal(columns, size === 'standard' ? 2 : 1);
        await comparison.locator('.compare-selected').screenshot({ path: path.join(output, `${width}-${size}-compare.png`) });
      }
      await comparison.locator('#compare-differences').check();
      assert(await comparison.locator('.compare-row').count() > 0);
      await comparison.getByRole('button', { name: '移出百合', exact: true }).click();
      await expect(comparison.locator('.compare-selected__item')).toHaveCount(1);
      await expect(comparison.locator('#compare-differences')).toBeDisabled();
      await expect(comparison.locator('#compare-differences')).not.toBeChecked();
      const before = h.requests.length;
      await comparison.locator('.ingredient-card-photo__image').evaluate(image => image.dispatchEvent(new Event('error')));
      await expect(comparison.locator('.ingredient-visual')).toHaveCount(1); await h.settle(); assert.equal(h.requests.length, before);
      await comparison.getByRole('button', { name: '移出山药', exact: true }).click();
      await expect(comparison.getByText('把想了解的食材放在一起', { exact: true })).toBeVisible();
      await expect(comparison.locator('.compare-row')).toHaveCount(0);
    }],
    ['compact_pending_detail_keeps_risks_and_all_original_review_messages', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); h.status(410);
      await chooseIngredient(h, '百合');
      const detail = h.page.locator('#detail-fixture');
      await expect(detail.locator('.detail-hero--symbol')).toBeVisible();
      await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      await assertDetailWarnings(h, false);
      await h.page.screenshot({ path: path.join(output, '390-detail-compact.png'), fullPage: true });
      const processing = detail.getByRole('button', { name: /部位与加工记录，已收起/ }); await processing.click();
      await expect(detail.getByText('待发布前复核', { exact: true })).toBeVisible();
      await expect(detail.getByText(catalog.ingredients.find(item => item.id === 'bai-he').processingNote, { exact: true })).toBeVisible();
      await detail.getByRole('button', { name: /资料核对进度，已收起/ }).click(); await assertDetailWarnings(h, true);
      await detail.getByRole('button', { name: /资料使用范围，已收起/ }).click();
      await expect(detail.getByText(catalog.boundaryNotice, { exact: true })).toBeVisible();
      // Synthetic health input in the owned browser only. No personal answers.
      await h.page.locator('#detail-favorite').click();
      await h.page.getByRole('button', { name: '测试安全', exact: true }).click();
      const safety = h.page.locator('#safety-fixture');
      await safety.getByRole('button', { name: '年龄阶段：成年人', exact: true }).click();
      await safety.getByRole('button', { name: '是否处于孕期：是', exact: true }).click();
      await safety.getByRole('button', { name: '是否正在用药：是', exact: true }).click();
      await safety.locator('#safety-allergies').fill('百合'); await safety.locator('#safety-conditions').fill('工程验证情况');
      await safety.locator('#apply-safety-profile').click();
      await h.page.getByRole('button', { name: '测试收藏', exact: true }).click();
      await h.page.locator('#favorites-fixture').getByRole('button', { name: '查看百合详情', exact: true }).click();
      await expect(detail.getByText('请先确认这些安全问题', { exact: true })).toBeVisible();
      await expect(detail.locator('#detail-compare')).toBeDisabled();
      await expect(detail.locator('#detail-favorite')).toBeEnabled();
      // A newly blocked notice moves ahead of the facts and remounts closed;
      // no clinical warning may depend on expanding its progress disclosure.
      await assertDetailWarnings(h, false);
      await detail.getByRole('button', { name: /资料核对进度，已收起/ }).click(); await assertDetailWarnings(h, true);
      const assessment = JSON.parse(await h.page.locator('#test-detail-assessment').textContent()).assessment;
      for (const code of ['pregnancy_unknown', 'interaction_data_pending', 'medication_details_required', 'condition_data_pending', 'profile_incomplete']) assert(assessment.warningCodes.includes(code));
      assert(assessment.reasonCodes.includes('allergy_match'));
      await h.page.screenshot({ path: path.join(output, '390-detail-conflict.png'), fullPage: true });
    }],
    ['comparison_hidden_privacy_reset_rejects_late_batch', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await chooseIngredient(h, '百合'); await h.page.locator('#detail-compare').click();
      await h.page.getByRole('button', { name: '查看已选对比', exact: true }).click();
      const comparison = h.page.locator('#compare-fixture');
      await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(1);
      await h.offline(); h.hold(true); const before = h.requests.length; await h.online();
      await expect.poll(() => h.requests.length).toBe(before + 1);
      await h.page.getByRole('button', { name: '测试关于', exact: true }).click();
      await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(0);
      await h.page.getByRole('button', { name: '允许下一次测试确认', exact: true }).click(); await h.page.locator('#delete-local-records').click();
      await h.release(); await expect(comparison.locator('.ingredient-card-photo__image')).toHaveCount(0);
      h.hold(false); await h.page.getByRole('button', { name: '测试对比', exact: true }).click();
      await expect(comparison.getByText('把想了解的食材放在一起', { exact: true })).toBeVisible();
      await expect(comparison.locator('.compare-selected__item')).toHaveCount(0);
    }],
    ['expiry_verifies_withdrawal_and_network_errors_do_not_loop', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); h.withdraw(true);
      await h.page.clock.fastForward(61000); await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(0);
      await expect.poll(() => h.requests.length).toBe(2);
      h.withdraw(false); h.status(503); await h.offline(); await h.online();
      await expect.poll(() => h.requests.length).toBe(3); await h.settle(); assert.equal(h.requests.length, 3);
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(0);
    }],
    ['hidden_page_privacy_reset_and_red_flags_reject_late_batches', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await h.offline(); h.hold(true); await h.online(); await expect.poll(() => h.requests.length).toBe(2);
      await h.page.getByRole('button', { name: '测试关于', exact: true }).click(); await h.offline(); await h.online(); await h.settle(); assert.equal(h.requests.length, 2);
      await h.page.getByRole('button', { name: '允许下一次测试确认', exact: true }).click(); await h.page.locator('#delete-local-records').click();
      await h.release(); await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(0);
      h.hold(false); await h.page.getByRole('button', { name: '测试目录', exact: true }).click(); await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      const before = h.requests.length; await h.page.getByRole('button', { name: '添加测试红旗', exact: true }).click();
      await expect(h.catalog.locator('.urgent-notice')).toBeVisible(); await h.offline(); await h.online(); await h.settle(); assert.equal(h.requests.length, before);
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(0);
    }],
    ['photo_failure_falls_back_and_same_version_is_not_retried_per_card', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      const card = h.catalog.locator('.ingredient-card').first();
      await card.locator('img').evaluate(image => image.dispatchEvent(new Event('error'))); await expect(card.locator('.ingredient-visual')).toHaveCount(1);
      assert.equal(h.requests.length, 1); await expect(card.locator('.ingredient-card-photo__credit')).toHaveCount(0);
      await h.catalog.getByRole('textbox', { name: '搜索食材', exact: true }).fill(catalog.ingredients[0].name); await expect(h.catalog.locator('.ingredient-card')).toHaveCount(1);
      assert.equal(h.requests.length, 1, 'verified cache serves the narrowed search');
    }],
    ['detail_expiry_rechecks_and_observes_withdrawal', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await chooseIngredient(h, '百合');
      const detail = h.page.locator('#detail-fixture');
      await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
      const before = h.requests.length; h.withdraw(true);
      await h.page.clock.fastForward(61000);
      await expect.poll(() => h.requests.length).toBe(before + 1);
      await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      await expect(detail.locator('#detail-photos-retry')).toHaveCount(0);
      await h.settle(); assert.equal(h.requests.length, before + 1);
    }],
    ['detail_metadata_failure_has_explicit_retry_without_automatic_error_loop', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); h.status(503);
      await chooseIngredient(h, '百合');
      const detail = h.page.locator('#detail-fixture');
      await expect(detail.locator('#detail-photos-retry')).toBeEnabled();
      await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      await detail.locator('#detail-photos-retry').scrollIntoViewIfNeeded();
      await h.page.screenshot({ path: path.join(output, '390-detail-photo-retry.png') });
      const before = h.requests.length;
      await h.page.clock.fastForward(61000); await h.settle(); assert.equal(h.requests.length, before, 'metadata failures must not retry themselves');
      h.status(200); h.hold(true); await detail.locator('#detail-photos-retry').click();
      await expect.poll(() => h.requests.length).toBe(before + 1);
      await expect(detail.locator('#detail-photos-retry')).toHaveCount(0);
      await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      h.hold(false); await h.release(); await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
      await detail.locator('.detail-hero').scrollIntoViewIfNeeded();
      await h.page.screenshot({ path: path.join(output, '390-detail-photo-renewed.png') });
      assert.equal(h.requests.length, before + 1);
    }],
    ['detail_expiry_read_hidden_then_privacy_reset_rejects_late_success', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); await chooseIngredient(h, '百合');
      const detail = h.page.locator('#detail-fixture'); await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
      const before = h.requests.length; h.hold(true); await h.page.clock.fastForward(61000);
      await expect.poll(() => h.requests.length).toBe(before + 1);
      await h.page.getByRole('button', { name: '测试关于', exact: true }).click();
      await h.page.getByRole('button', { name: '允许下一次测试确认', exact: true }).click(); await h.page.locator('#delete-local-records').click();
      h.hold(false); await h.release(); await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      await h.offline(); await h.online(); await h.page.clock.fastForward(61000); await h.settle();
      assert.equal(h.requests.length, before + 1, 'hidden/reset page cannot renew or resurrect photos');
    }],
    ['detail_short_lifetimes_rate_limit_renewal_and_stop_after_failure', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await h.page.clock.pauseAt(new Date(await h.page.evaluate(() => Date.now() + 1000)));
      try {
        h.lifetime(100); await chooseIngredient(h, '百合');
        const detail = h.page.locator('#detail-fixture'); await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
        const before = h.requests.length;
        await h.page.clock.runFor(200); await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
        assert.equal(h.requests.length, before, 'short expiry must not immediately request again');
        await h.page.clock.runFor(900); await expect.poll(() => h.requests.length).toBe(before + 1);
        await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
        h.status(503); await h.page.clock.runFor(1100);
        await expect(detail.locator('#detail-photos-retry')).toBeEnabled();
        assert.equal(h.requests.length, before + 2);
        await h.page.clock.runFor(10000); assert.equal(h.requests.length, before + 2);
      } finally { await h.page.clock.resume(); }
    }],
    ['detail_expiry_read_red_flags_retire_pending_result', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12); await chooseIngredient(h, '百合');
      const detail = h.page.locator('#detail-fixture'); await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
      const before = h.requests.length; h.hold(true); await h.page.clock.fastForward(61000);
      await expect.poll(() => h.requests.length).toBe(before + 1);
      await h.page.getByRole('button', { name: '添加测试红旗', exact: true }).click();
      await expect(detail.locator('.urgent-notice')).toBeVisible(); h.hold(false); await h.release();
      await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0); await h.offline(); await h.online();
      await h.page.clock.fastForward(61000); await h.settle(); assert.equal(h.requests.length, before + 1);
    }],
    ['detail_scheduled_short_lifetime_renewal_cancels_before_hidden_privacy_reset', async h => {
      await expect(h.catalog.locator('.ingredient-card-photo__image')).toHaveCount(12);
      await h.page.clock.pauseAt(new Date(await h.page.evaluate(() => Date.now() + 1000)));
      try {
        h.lifetime(100); await chooseIngredient(h, '百合');
        const detail = h.page.locator('#detail-fixture'); await expect(detail.locator('.ingredient-photos__image')).toBeVisible();
        const before = h.requests.length; await h.page.clock.runFor(200);
        await expect(detail.locator('#detail-photos-retry')).toBeEnabled(); assert.equal(h.requests.length, before);
        await h.page.getByRole('button', { name: '测试关于', exact: true }).click();
        await h.page.getByRole('button', { name: '允许下一次测试确认', exact: true }).click(); await h.page.locator('#delete-local-records').click();
        await h.page.clock.runFor(10000);
        assert.equal(h.requests.length, before, 'retired renewal timer cannot start a request');
        await expect(detail.locator('.ingredient-photos__image')).toHaveCount(0);
      } finally { await h.page.clock.resume(); }
    }]
  ];
  const selectedCases = focus === undefined ? cases : cases.filter(([name]) => name === focus);
  assert(selectedCases.length > 0 && (focus === undefined || selectedCases.length === 1), 'Unknown focused catalog photo case');
  for (const [name, run] of selectedCases) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(); activePage = page;
    const now = Date.now(), requests = [], holds = []; let withdrawn = false, status = 200, holding = false, galleryLifetime = 3600000;
    await page.clock.install({ time: now }); page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = request.url();
      if (url === 'https://catalog-photo.test/') return route.fulfill({ contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' });
      if (url.startsWith(origin + '/api/v1/public/education/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      if (!url.startsWith(api)) return route.abort();
      if (url.endsWith('.jpg')) return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
      assert.equal(request.method(), 'GET'); assert.equal(request.postData(), null); assert.equal(request.headers().authorization, undefined); assert.equal(request.headers().cookie, undefined);
      const suffix = url.slice(api.length), ids = suffix.startsWith('batch/') ? suffix.slice(6).split(',') : [suffix];
      assert(ids.length <= 12 && ids.every(id => /^[a-z0-9-]+$/.test(id))); requests.push(ids);
      const responseTime = await page.evaluate(() => Date.now());
      const galleries = withdrawn ? [] : ids.map(id => payload(id, responseTime, hash, jpeg.length, galleryLifetime));
      const response = { status: withdrawn && !suffix.startsWith('batch/') && status === 200 ? 410 : status, contentType: 'application/json', body: JSON.stringify(suffix.startsWith('batch/') ? {
        schemaVersion: 'public-photo-batch.1', baseReleaseId: release.releaseId, requestedIds: ids, galleries
      } : galleries[0] ?? {}) };
      if (holding) await new Promise(resolve => holds.push(resolve));
      try { await route.fulfill(response); } catch { /* A deliberately aborted old read may already be closed. */ }
    });
    await page.goto('https://catalog-photo.test/'); await page.addStyleTag({ content: css + '\nbody{margin:0}button{border:0}.test-navigation{padding:12px;font-size:12px}' });
    await page.addScriptTag({ path: path.join(output, 'fixture.js') });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const releaseHeld = async () => { for (const resolve of holds.splice(0)) resolve(); await settle(); };
    const h = { page, catalog: page.locator('#catalog-fixture'), requests, settle, release: releaseHeld,
      withdraw(value) { withdrawn = value; }, status(value) { status = value; }, hold(value) { holding = value; },
      lifetime(milliseconds) { assert(Number.isSafeInteger(milliseconds) && milliseconds > 0); galleryLifetime = milliseconds; },
      offline: () => page.getByRole('button', { name: '测试断网', exact: true }).click(), online: () => page.getByRole('button', { name: '测试重连', exact: true }).click() };
    console.log(`Catalog photos: ${name}`); await run(h); await releaseHeld(); assert.deepEqual(report.errors, []);
    report.cases.push({ name, status: 'passed', anonymousMetadataRequests: requests.length }); await context.close(); activePage = undefined;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown catalog-photo failure'); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) try { await activePage.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }); } catch { report.failureCaptureUnavailable = true; }
} finally { await browser?.close(); report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ output, ...report })); }

function payload(id, now, hash, bytes, lifetime) {
  const ingredient = catalog.ingredients.find(item => item.id === id); assert(ingredient);
  return { schemaVersion: 'public-photo-gallery.1', ingredientId: id, name: ingredient.name, baseReleaseId: release.releaseId, version: 1,
    publishedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + lifetime).toISOString(), photos: [{ sha256: 'sha256:' + hash, width: 96, height: 48, bytes,
      caption: '工程测试色块，不是食材照片', part: '工程部位', processing: '工程形态', author: '工程测试作者与长署名验证'.repeat(12), sourceUrl: 'https://example.test/engineering-source',
      license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', modification: '仅工程验证，不作食材鉴定或实际专业批准' }] };
}

async function chooseIngredient(h, name) {
  await h.catalog.locator('#catalog-search').fill(name);
  await expect(h.catalog.locator('.ingredient-card')).toHaveCount(1);
  await h.catalog.getByRole('button', { name: `查看${name}详情`, exact: true }).click();
  await expect(h.page.locator('#detail-fixture .detail-name')).toHaveText(name);
}

async function assertDetailWarnings(h, expanded) {
  const { assessment, riskNotes } = JSON.parse(await h.page.locator('#test-detail-assessment').textContent());
  const detail = h.page.locator('#detail-fixture'), progress = new Set(['preparation_data_pending', 'food_use_mapping_pending', 'catalog_refresh_pending', 'professional_review_pending']);
  for (const message of [...assessment.reasons, ...riskNotes]) await expect(detail.getByText(message, { exact: true })).toBeVisible();
  for (const [index, message] of assessment.warnings.entries()) {
    const locator = detail.getByText(message, { exact: true });
    if (expanded || !progress.has(assessment.warningCodes[index])) await expect(locator).toBeVisible(); else await expect(locator).toHaveCount(0);
  }
}
