import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compile } from 'sass';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), app = path.join(root, 'apps/miniprogram');
const { chromium, expect } = createRequire(path.join(root, 'zhongyi-platform/package.json'))('@playwright/test');
const parent = path.join(root, '.refactor/evidence/storage-recovery-runs'); fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
const report = { schemaVersion: 1, scope: 'actual_mini_pages_hooks_and_core_with_memory_fault_storage_and_test_lifecycle_modal',
  status: 'running', startedAt: new Date().toISOString(), wechatRuntimeVerified: false, deviceVerified: false,
  nativeStorageVerified: false, nativeModalVerified: false, realHealthDataUsed: false, cases: [], errors: [] };
report.browsePositionScope = 'Synthetic saved position; real browser layout/scroll restoration through the Taro test adapter, not native WeChat scrolling';
const favorites = 'zhongyi_favorites_v1', compare = 'zhongyi_compare_v1';
const initial = { [favorites]: ['shan-yao'], [compare]: ['bai-he', 'shan-yao'], 'unrelated-test-key': { keep: true } };
let browser;
try {
  await build({ entryPoints: [path.join(app, 'tests/visual/storage-entry.tsx')], bundle: true, outfile: path.join(output, 'fixture.js'),
    platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.jpg': 'dataurl', '.png': 'dataurl' }, define: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: 'null', 'process.env.NODE_ENV': '"production"' },
    alias: { '@tarojs/components': path.join(app, 'tests/visual/components.tsx'), '@tarojs/taro': path.join(app, 'tests/visual/storage-taro.ts'),
      '@food-education/catalog-core': path.join(root, 'packages/catalog-core/src/index.ts') } });
  const css = compile(path.join(app, 'src/app.scss')).css.replace(/(-?[\d.]+)rpx\b/g, (_, value) => `${Number(value) / 7.5}vw`)
    .replace(/(^|\})\s*page\s*\{/g, '$1 body {').replace(/\bview\b/g, 'div').replace(/\btext\b(?=\s*,)/g, 'span');
  const script = fs.readFileSync(path.join(output, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const cases = [
    ['catalog_direct_compare_add_remove_preserves_search_and_other_records', async h => {
      await h.control('模拟空对比记录'); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog');
      await catalog.locator('#catalog-search').fill('百合');
      await catalog.getByRole('button', { name: '加入百合对比', exact: true }).click();
      await expect(catalog.locator('#catalog-compare-summary')).toContainText('已选 1 / 4 项');
      await catalog.locator('#catalog-search').fill('山药');
      await catalog.getByRole('button', { name: '加入山药对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['bai-he', 'shan-yao']);
      await h.control('测试对比页');
      await expect(h.page.locator('#test-compare .compare-selected__item')).toHaveCount(2);
      await h.page.locator('#test-compare #compare-differences').check();
      await h.control('测试目录页');
      await expect(catalog.locator('#catalog-search')).toHaveValue('山药');
      await catalog.getByRole('button', { name: '移出山药对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['bai-he']);
      assert.deepEqual((await h.storage()).records[favorites], initial[favorites]);
      assert.deepEqual((await h.storage()).records['unrelated-test-key'], { keep: true });
      await catalog.screenshot({ path: path.join(output, 'catalog-direct-compare.png') });
    }],
    ['catalog_full_compare_counts_unavailable_ids_and_keeps_removal_enabled', async h => {
      await h.control('模拟旧对比记录'); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog');
      await catalog.locator('#catalog-search').fill('山药');
      await expect(catalog.getByRole('button', { name: '加入山药对比', exact: true })).toBeDisabled();
      await expect(catalog.locator('#catalog-compare-summary')).toContainText('已选 4 / 4 项');
      await catalog.locator('#catalog-search').fill('百合');
      await expect(catalog.getByRole('button', { name: '移出百合对比', exact: true })).toBeEnabled();
      await catalog.getByRole('button', { name: '移出百合对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['retired-one', 'retired-two', 'retired-three']);
      await catalog.locator('#catalog-search').fill('山药');
      await catalog.getByRole('button', { name: '加入山药对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['retired-one', 'retired-two', 'retired-three', 'shan-yao']);
    }],
    ...[['模拟对比写入拒绝', 'rejected'], ['模拟忽略对比写入', 'ignored']].map(([control, kind]) => [
      `catalog_${kind}_compare_write_never_reports_success`, async h => {
        await h.control('模拟空对比记录'); await h.control(control); await h.control('测试目录页');
        const catalog = h.page.locator('#test-catalog'); await catalog.locator('#catalog-search').fill('百合');
        await catalog.getByRole('button', { name: '加入百合对比', exact: true }).click();
        assert.deepEqual((await h.storage()).records[compare], []);
        assert.ok(!(await h.storage()).toasts.includes('已加入对比'));
        await expect(catalog.locator('#catalog-compare-summary')).toHaveCount(0);
        await h.control('恢复对比写入');
        await catalog.getByRole('button', { name: '加入百合对比', exact: true }).click();
        assert.deepEqual((await h.storage()).records[compare], ['bai-he']);
      }
    ]),
    ['catalog_failed_compare_read_is_not_an_empty_selection', async h => {
      await h.control('模拟对比读取失败'); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog'); await catalog.locator('#catalog-search').fill('百合');
      await expect(catalog.getByRole('button', { name: '加入百合对比', exact: true })).toBeDisabled();
      await expect(catalog.locator('#catalog-compare-summary')).toHaveCount(0); await h.noMutations();
      assert.deepEqual((await h.storage()).records[compare], initial[compare]);
      await h.control('恢复对比读取'); await catalog.getByRole('button', { name: '重新读取', exact: true }).click();
      await expect(catalog.getByRole('button', { name: '移出百合对比', exact: true })).toBeEnabled();
      await h.noMutations();
    }],
    ['catalog_uncertain_compare_write_requires_explicit_readback', async h => {
      await h.control('模拟空对比记录'); await h.control('模拟对比写后读取失败'); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog'); await catalog.locator('#catalog-search').fill('百合');
      await catalog.getByRole('button', { name: '加入百合对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['bai-he']);
      assert.ok(!(await h.storage()).toasts.includes('已加入对比'));
      await expect(catalog.getByRole('button', { name: '加入百合对比', exact: true })).toBeDisabled();
      await h.control('恢复对比读取'); await h.control('恢复对比写入');
      await catalog.getByRole('button', { name: '重新读取', exact: true }).click();
      await expect(catalog.getByRole('button', { name: '移出百合对比', exact: true })).toBeEnabled();
      assert.equal((await h.storage()).operations.filter(value => value.operation === 'write').length, 1);
    }],
    ['catalog_duplicate_and_hidden_compare_callbacks_do_not_write_twice', async h => {
      await h.control('模拟空对比记录'); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog'); await catalog.locator('#catalog-search').fill('百合');
      await catalog.getByRole('button', { name: '加入百合对比', exact: true }).evaluate(button => { window.__catalogCompare = button; button.click(); button.click(); });
      assert.deepEqual((await h.storage()).records[compare], ['bai-he']);
      assert.equal((await h.storage()).operations.filter(value => value.operation === 'write').length, 1);
      await h.control('测试对比页'); await h.page.evaluate(() => window.__catalogCompare.click());
      assert.deepEqual((await h.storage()).records[compare], ['bai-he']);
      assert.equal((await h.storage()).operations.filter(value => value.operation === 'write').length, 1);
    }],
    ['catalog_compare_controls_fit_320_with_extra_large_reading', async h => {
      await h.page.setViewportSize({ width: 320, height: 844 });
      await h.about(); await h.aboutPage.locator('#reading-size-extra-large').click(); await h.control('测试目录页');
      const catalog = h.page.locator('#test-catalog');
      assert.equal(await h.page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      const button = catalog.locator('.ingredient-card__compare').first();
      const box = await button.boundingBox(); assert.ok(box && box.height >= 44);
      await catalog.locator('#catalog-compare-summary').screenshot({ path: path.join(output, '320-extra-large-catalog-compare.png') });
      await h.noMutations();
    }],
    ['catalog_external_compare_change_cannot_overwrite_new_records', async h => {
      await h.control('测试目录页'); const catalog = h.page.locator('#test-catalog');
      await catalog.locator('#catalog-search').fill('百合');
      await h.control('模拟更新旧对比记录');
      await catalog.getByRole('button', { name: '移出百合对比', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['shan-yao', 'retired-one', 'retired-two']);
      await h.noMutations(); assert.ok((await h.storage()).toasts.includes('记录已更新，请再次操作'));
      await expect(catalog.getByRole('button', { name: '加入百合对比', exact: true })).toBeEnabled();
    }],
    ['unavailable_compare_record_can_release_a_slot_without_clearing_other_records', async h => {
      await h.control('模拟旧对比记录'); await h.control('测试对比页');
      const page = h.page.locator('#test-compare');
      await expect(page.locator('#compare-add')).toBeDisabled(); await h.noMutations();
      await page.getByRole('button', { name: '暂不可用的对比记录，已收起，点击展开', exact: true }).click();
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).click();
      await expect(page.locator('#compare-add')).toBeEnabled();
      const state = await h.storage(); assert.deepEqual(state.records[compare], ['bai-he', 'retired-two', 'retired-three']);
      assert.deepEqual(state.records[favorites], initial[favorites]); assert.deepEqual(state.records['unrelated-test-key'], { keep: true });
      assert.deepEqual(state.operations.filter(value => value.operation !== 'read'), [{ operation: 'write', key: compare }]);
      await page.screenshot({ path: path.join(output, 'unavailable-compare-slot.png') });
    }],
    ['all_unavailable_compare_records_remain_until_individual_removal', async h => {
      await h.control('模拟全旧对比记录'); await h.control('测试对比页');
      const page = h.page.locator('#test-compare');
      await expect(page.getByText('当前没有可展示的食材', { exact: true })).toBeVisible(); await h.noMutations();
      await page.getByRole('button', { name: '暂不可用的对比记录，已收起，点击展开', exact: true }).click();
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).click();
      assert.deepEqual((await h.storage()).records[compare], ['retired-two']);
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).click();
      await expect(page.getByText('把想了解的食材放在一起', { exact: true })).toBeVisible();
      assert.deepEqual((await h.storage()).records[compare], []);
      assert.deepEqual((await h.storage()).records[favorites], initial[favorites]);
    }],
    ['unavailable_favorite_removal_keeps_known_items_and_search', async h => {
      await h.control('模拟旧收藏记录'); await h.control('测试收藏页');
      const page = h.page.locator('#test-favorites'); await page.locator('#favorites-search').fill('山药');
      await h.noMutations();
      await page.getByRole('button', { name: '暂不可用的收藏，已收起，点击展开', exact: true }).click();
      await page.getByRole('button', { name: '移出暂不可用的收藏 1', exact: true }).click();
      await expect(page.locator('#favorites-search')).toHaveValue('山药');
      await expect(page.locator('.ingredient-card__name')).toHaveText('山药');
      assert.deepEqual((await h.storage()).records[favorites], ['shan-yao']);
      assert.deepEqual((await h.storage()).records[compare], initial[compare]);
    }],
    ['unavailable_favorites_are_bounded_and_readable_at_large_font_on_320', async h => {
      await h.page.setViewportSize({ width: 320, height: 844 });
      await h.about(); await h.aboutPage.locator('#reading-size-extra-large').click();
      await h.control('模拟多项旧收藏'); await h.control('测试收藏页');
      const page = h.page.locator('#test-favorites');
      await expect(page.getByText('当前没有可展示的收藏', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '暂不可用的收藏，已收起，点击展开', exact: true }).click();
      await expect(page.locator('.unavailable-selection')).toHaveCount(12);
      await page.getByRole('button', { name: '继续查看旧记录', exact: true }).click();
      await expect(page.locator('.unavailable-selection')).toHaveCount(24);
      await page.getByRole('button', { name: '继续查看旧记录', exact: true }).click();
      await expect(page.locator('.unavailable-selection')).toHaveCount(25);
      assert.equal((await page.textContent()).includes('retired-'), false, 'Private opaque IDs are not display names');
      assert.equal(await h.page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      assert.deepEqual((await h.storage()).records[favorites], Array.from({ length: 25 }, (_, index) => `retired-${index + 1}`));
      await h.noMutations(); await page.locator('.disclosure').screenshot({ path: path.join(output, '320-unavailable-extra-large.png') });
    }],
    ['hidden_unavailable_record_callback_cannot_write', async h => {
      await h.control('模拟旧对比记录'); await h.control('测试对比页');
      const page = h.page.locator('#test-compare');
      await page.getByRole('button', { name: '暂不可用的对比记录，已收起，点击展开', exact: true }).click();
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).evaluate(button => { window.__unavailableRemove = button; });
      await h.control('测试详情页'); await h.page.evaluate(() => window.__unavailableRemove.click());
      await h.noMutations(); assert.deepEqual((await h.storage()).records[compare], ['bai-he', 'retired-one', 'retired-two', 'retired-three']);
    }],
    ['changed_unavailable_record_snapshot_cannot_overwrite_new_list', async h => {
      await h.control('模拟旧对比记录'); await h.control('测试对比页');
      const page = h.page.locator('#test-compare');
      await page.getByRole('button', { name: '暂不可用的对比记录，已收起，点击展开', exact: true }).click();
      await h.control('模拟更新旧对比记录');
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).click();
      await h.noMutations(); assert.deepEqual((await h.storage()).records[compare], ['shan-yao', 'retired-one', 'retired-two']);
      assert.ok((await h.storage()).toasts.includes('记录已更新，请再次操作'));
    }],
    ['failed_unavailable_favorite_write_keeps_record_until_explicit_retry', async h => {
      await h.control('模拟旧收藏记录'); await h.control('测试收藏页');
      const page = h.page.locator('#test-favorites');
      await page.getByRole('button', { name: '暂不可用的收藏，已收起，点击展开', exact: true }).click();
      await h.control('模拟写入拒绝'); await page.getByRole('button', { name: '移出暂不可用的收藏 1', exact: true }).click();
      await expect(page.getByRole('button', { name: '移出暂不可用的收藏 1', exact: true })).toBeVisible();
      assert.deepEqual((await h.storage()).records[favorites], ['shan-yao', 'retired-one']); await h.noFalseSave();
      await h.control('恢复正常写入'); await page.getByRole('button', { name: '移出暂不可用的收藏 1', exact: true }).click();
      assert.deepEqual((await h.storage()).records[favorites], ['shan-yao']);
      assert.deepEqual((await h.storage()).records[compare], initial[compare]);
    }],
    ['duplicate_unavailable_remove_event_writes_once', async h => {
      await h.control('模拟旧对比记录'); await h.control('测试对比页');
      const page = h.page.locator('#test-compare');
      await page.getByRole('button', { name: '暂不可用的对比记录，已收起，点击展开', exact: true }).click();
      await page.getByRole('button', { name: '移出暂不可用的对比记录 1', exact: true }).evaluate(button => { button.click(); button.click(); });
      assert.deepEqual((await h.storage()).records[compare], ['bai-he', 'retired-two', 'retired-three']);
      assert.deepEqual((await h.storage()).operations.filter(value => value.operation !== 'read'), [{ operation: 'write', key: compare }]);
    }],
    ['retry_same_favorites_restores_browser_position_without_repaging', async h => {
      await h.pagedFavorites();
      await h.control('测试详情页'); await h.control('测试收藏页');
      await expect.poll(() => h.page.evaluate(() => window.scrollY)).toBe(650);
      await h.control('模拟读取失败'); await h.control('测试详情页'); await h.control('测试收藏页');
      await expect(h.page.locator('#test-favorites').getByText('本机记录暂时无法读取', { exact: true })).toBeVisible();
      await h.control('恢复读取');
      await h.page.locator('#test-favorites').getByRole('button', { name: '重新读取', exact: true }).click();
      await expect(h.page.locator('#test-favorites .ingredient-card')).toHaveCount(24);
      await expect.poll(() => h.page.evaluate(() => window.scrollY)).toBe(650);
      await h.noMutations();
    }],
    ['unchanged_favorites_return_keeps_paging_and_position', async h => {
      await h.pagedFavorites(); const before = await h.browse();
      await h.control('测试详情页'); await h.control('测试收藏页');
      assert.deepEqual(await h.browse(), before);
      await expect.poll(() => h.page.evaluate(() => window.scrollY)).toBe(650); await h.noMutations();
    }],
    ['favorite_removal_invalidates_old_list_layout', async h => {
      await h.pagedFavorites(); const before = await h.browse();
      await h.page.locator('#test-favorites .ingredient-card').first().getByRole('button', { name: '取消收藏', exact: true }).click();
      const after = await h.browse(); assert.equal(after.visible, 12); assert.equal(after.position, 0);
      assert.ok(after.viewportRevision > before.viewportRevision); assert.ok(after.boundary > before.boundary);
      assert.equal((await h.storage()).records[favorites].length, 29);
      await expect.poll(() => h.page.evaluate(() => window.scrollY)).toBe(0);
    }],
    ['hidden_favorites_update_after_detail_save', async h => {
      await h.pagedFavorites(); const before = await h.browse();
      await h.control('测试详情页'); await h.favorite.click(); await expect(h.favorite).toHaveText('取消收藏');
      await h.control('测试收藏页');
      const after = await h.browse(); assert.equal(after.visible, 12); assert.equal(after.position, 0);
      assert.ok(after.viewportRevision > before.viewportRevision);
      assert.equal((await h.storage()).records[favorites].length, 31);
    }],
    ['same_count_replacement_preserves_query_but_resets_layout', async h => {
      await h.control('测试收藏页'); await h.page.locator('#favorites-search').fill('山药');
      await h.control('设置列表测试位置'); const before = await h.browse();
      await h.control('测试详情页'); await h.control('模拟同数量变更'); await h.control('测试收藏页');
      const after = await h.browse(); assert.equal(after.query, '山药'); assert.equal(after.position, 0);
      assert.ok(after.viewportRevision > before.viewportRevision); await h.noMutations();
    }],
    ['unconfirmed_read_does_not_erase_list_context', async h => {
      await h.pagedFavorites(); const before = await h.browse();
      await h.control('测试详情页'); await h.control('模拟同数量变更'); await h.control('模拟读取失败');
      await h.control('测试收藏页'); assert.deepEqual(await h.browse(), before);
      await h.control('恢复读取'); await h.page.locator('#test-favorites').getByRole('button', { name: '重新读取', exact: true }).click();
      const after = await h.browse(); assert.equal(after.position, 0); assert.equal(after.visible, 12);
      assert.ok(after.viewportRevision > before.viewportRevision); await h.noMutations();
    }],
    ...[['模拟写入拒绝', false], ['模拟写后报错', true]].map(([control, persisted]) => [persisted ? 'uncertain_receipt_uses_confirmed_membership_for_layout' : 'rejected_write_preserves_list_context', async h => {
      await h.pagedFavorites(); const before = await h.browse();
      await h.control('测试详情页'); await h.control(control); await h.favorite.click();
      await h.control('测试收藏页'); const after = await h.browse();
      if (persisted) { assert.equal(after.visible, 12); assert.equal(after.position, 0); assert.ok(after.viewportRevision > before.viewportRevision); }
      else assert.deepEqual(after, before);
      await h.noFalseSave();
    }]),
    ['read_failure_preserves_lists_and_retry', async h => {
      await h.control('模拟读取失败'); await h.about(); await h.control('测试收藏页');
      await expect(h.page.locator('#test-favorites').getByText('本机记录暂时无法读取', { exact: true })).toBeVisible();
      await expect(h.page.getByText('先收藏一份感兴趣的资料', { exact: true })).toHaveCount(0);
      assert.deepEqual((await h.storage()).records, initial); await h.noMutations();
      await h.control('恢复读取'); await h.page.locator('#test-favorites').getByRole('button', { name: '重新读取', exact: true }).click();
      await expect(h.page.locator('#test-favorites .ingredient-card__name')).toHaveText('山药'); await h.noMutations();
    }],
    ['malformed_records_are_not_silently_repaired', async h => {
      await h.control('模拟格式异常'); await h.control('测试收藏页');
      await expect(h.page.locator('#test-favorites').getByText('本机记录暂时无法读取', { exact: true })).toBeVisible();
      await expect(h.page.getByText('先收藏一份感兴趣的资料', { exact: true })).toHaveCount(0);
      assert.deepEqual((await h.storage()).records[favorites], { invalidTestRecord: true }); await h.noMutations();
      await h.control('恢复原始记录'); await h.page.locator('#test-favorites').getByRole('button', { name: '重新读取', exact: true }).click();
      await expect(h.page.locator('#test-favorites .ingredient-card__name')).toHaveText('山药'); await h.noMutations();
    }],
    ...[['模拟写入拒绝', 'write_rejected'], ['模拟忽略写入', 'ignored_write']].map(([control, name]) => [name, async h => {
      await h.control(control); await h.favorite.click();
      assert.deepEqual((await h.storage()).records, initial); await expect(h.favorite).toHaveText('收藏'); await h.noFalseSave();
      await h.control('恢复正常写入'); await h.favorite.click();
      await expect(h.favorite).toHaveText('取消收藏'); assert.deepEqual((await h.storage()).records[favorites], ['shan-yao', 'bai-he']);
      await h.control('测试收藏页'); await expect(h.page.locator('#test-favorites .ingredient-card__name')).toHaveText(['山药', '百合']);
    }]),
    ['persisted_then_exception_never_invites_blind_retry', async h => {
      await h.control('模拟写后报错'); await h.favorite.click();
      assert.deepEqual((await h.storage()).records[favorites], ['shan-yao', 'bai-he']); await expect(h.favorite).toHaveText('取消收藏');
      await h.noFalseSave(); const notices = (await h.storage()).toasts;
      assert.ok(notices.some(value => /保存结果.*核对/.test(value)), 'Persisted data cannot be described as unsaved or encourage blind retry');
      assert.ok(notices.every(value => !/保存未完成|请重试/.test(value)));
    }],
    ['write_readback_failure_disables_until_manual_read', async h => {
      await h.control('模拟写后读取失败'); await h.favorite.click();
      await expect(h.favorite).toBeDisabled(); await expect(h.favorite).toHaveText('收藏待读取');
      assert.deepEqual((await h.storage()).records[favorites], ['shan-yao', 'bai-he']); await h.noFalseSave();
      const writes = (await h.storage()).operations.filter(value => value.operation === 'write').length; assert.equal(writes, 1);
      await h.control('恢复读取'); await h.control('恢复正常写入');
      await h.detail.getByRole('button', { name: '重新读取', exact: true }).click(); await expect(h.favorite).toHaveText('取消收藏');
      assert.equal((await h.storage()).operations.filter(value => value.operation === 'write').length, writes);
    }],
    ['deletion_read_failure_clears_only_memory_then_explicit_retry', async h => {
      await h.about(); await h.control('模拟读取失败'); await h.control('测试确认删除'); await h.delete.click();
      await expect.poll(async () => (await h.session()).clearEpoch).toBe(1);
      assert.deepEqual((await h.storage()).records, initial); await h.noMutations();
      assert.equal((await h.session()).checks, 0); await h.aboutValue('收藏', '待读取');
      assert.ok((await h.storage()).toasts.includes('安全信息已清除；列表待读取，未删除'));
      await h.control('恢复读取'); await h.aboutPage.getByRole('button', { name: '重新读取', exact: true }).click();
      await h.aboutValue('收藏', '1 项'); await h.aboutValue('对比', '2 项');
      await h.delete.click(); await h.cleared(2);
    }],
    ...[['模拟对比删除失败', 'partial_removal_rejected'], ['模拟忽略对比删除', 'ignored_removal'],
      ['模拟对比删除后报错', 'removal_persisted_then_exception']].map(([control, name]) => [name, async h => {
      await h.about(); await h.control(control); await h.control('测试确认删除'); await h.delete.click();
      await expect.poll(async () => (await h.session()).clearEpoch).toBe(1); assert.equal((await h.session()).checks, 0);
      const state = await h.storage(); assert.equal(state.records[favorites], undefined); assert.deepEqual(state.records['unrelated-test-key'], { keep: true });
      assert.deepEqual(state.records[compare], name === 'removal_persisted_then_exception' ? undefined : initial[compare]);
      assert.ok(state.toasts.includes('安全信息与收藏已清除；对比结果待确认')); assert.ok(!state.toasts.includes('本机记录与本次安全信息已清除'));
      await h.control('恢复正常删除'); assert.equal((await h.storage()).operations.filter(value => value.operation === 'remove').length, 2, 'No automatic retry');
      await h.delete.click(); await h.cleared(2);
    }]),
    ['cancel_and_modal_failure_do_not_delete', async h => {
      await h.about(); await h.control('测试取消删除'); await h.delete.click(); await h.settle();
      await h.noMutations(); assert.deepEqual((await h.storage()).records, initial); assert.equal((await h.session()).clearEpoch, 0);
      await h.control('测试确认异常'); await h.delete.click(); await h.settle();
      await h.noMutations(); assert.equal((await h.session()).checks, 1); assert.ok((await h.storage()).toasts.includes('暂时无法确认，请重试'));
      await h.control('测试确认删除'); await h.delete.click(); await h.cleared(1);
    }],
    ['hidden_page_and_duplicate_confirmation_cannot_delete', async h => {
      await h.about(); await h.control('等待确认'); await h.delete.click(); await h.delete.click();
      assert.equal((await h.storage()).modalCount, 1);
      await h.control('测试收藏页'); await h.control('返回删除确认'); await h.settle();
      await h.noMutations(); assert.deepEqual((await h.storage()).records, initial); assert.equal((await h.session()).clearEpoch, 0);
      await h.about(); await h.control('测试确认删除'); await h.delete.click(); await h.cleared(1);
    }],
    ...[['模拟同数量变更', 'changed_list_invalidates_confirmation'], ['模拟新安全信息', 'changed_session_invalidates_confirmation']].map(([control, name]) => [name, async h => {
      await h.about(); await h.control('等待确认'); await h.delete.click(); await h.control(control); await h.control('返回删除确认'); await h.settle();
      await h.noMutations(); assert.equal((await h.session()).clearEpoch, 0); assert.ok((await h.storage()).toasts.includes('记录已变化，请重新确认删除'));
      assert.deepEqual((await h.storage()).records[favorites], name === 'changed_list_invalidates_confirmation' ? ['lian-zi'] : initial[favorites]);
      await h.control('测试确认删除'); await h.delete.click(); await h.cleared(1);
    }]),
  ];
  const focusedCase = process.env.MINI_STORAGE_CASE;
  if (focusedCase && !cases.some(([name]) => name === focusedCase)) throw new Error('Unknown focused storage case');
  report.focusedCase = focusedCase ?? null;
  for (const [name, run] of cases) {
    if (focusedCase && name !== focusedCase) continue;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [], unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url === 'https://mini-storage.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>' });
      if (url === 'https://mini-storage.test/favicon.ico') return route.fulfill({ status: 204, body: '' });
      unexpectedRequests.push(url); return route.abort();
    });
    try {
      await page.goto('https://mini-storage.test/#/subpackages/catalog/detail/index?id=bai-he');
      await page.addStyleTag({ content: `${css}\nbody{margin:0} button,input{border:0} .test-navigation{display:flex;gap:4px;padding:4px;flex-wrap:wrap}.test-navigation button{font-size:11px;padding:4px;border:1px solid #ddd}pre{font-size:10px;white-space:pre-wrap;overflow-wrap:anywhere}` });
      await page.addScriptTag({ content: script });
      const detail = page.locator('#test-detail'), aboutPage = page.locator('#test-about');
      const storage = async () => JSON.parse(await page.locator('#test-storage-state').textContent());
      const session = async () => JSON.parse(await page.locator('#test-session-state').textContent());
      const browse = async () => JSON.parse(await page.locator('#test-browse-state').textContent());
      // Synthetic fault/navigation controls are not part of the product. Do
      // not let Playwright's auto-scroll overwrite the position under test.
      const control = label => page.getByRole('button', { name: label, exact: true }).evaluate(button => button.click());
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const h = { page, detail, aboutPage, storage, session, browse, control, settle, favorite: detail.locator('#detail-favorite'), delete: aboutPage.locator('#delete-local-records'),
        pagedFavorites: async () => {
          await control('模拟多项收藏'); await control('测试收藏页');
          await expect(page.locator('#test-favorites .ingredient-card')).toHaveCount(12);
          await page.locator('#test-favorites').getByRole('button', { name: '继续查看', exact: true }).click();
          await expect(page.locator('#test-favorites .ingredient-card')).toHaveCount(24);
          await control('设置列表测试位置'); assert.equal((await browse()).position, 650);
        },
        about: async () => { await control('测试关于页'); await expect(aboutPage).toBeVisible(); },
        aboutValue: (label, value) => expect(aboutPage.locator('.fact').filter({ has: page.getByText(label, { exact: true }) }).locator('.fact__value')).toHaveText(value),
        noMutations: async () => assert.deepEqual((await storage()).operations.filter(value => value.operation !== 'read'), []),
        noFalseSave: async () => assert.ok((await storage()).toasts.every(value => value !== '已收藏' && value !== '已取消收藏')),
        cleared: async epoch => { await expect.poll(async () => (await session()).clearEpoch).toBe(epoch);
          assert.deepEqual((await storage()).records, { 'unrelated-test-key': { keep: true } }); assert.equal((await session()).checks, 0);
          await h.aboutValue('收藏', '0 项'); await h.aboutValue('对比', '0 项'); } };
      await expect(h.favorite).toHaveText('收藏'); console.log(`Storage recovery case: ${name}`);
      await run(h); await settle(); assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, []);
      const final = await storage(); report.cases.push({ name, status: 'passed', writes: final.operations.filter(value => value.operation === 'write').length,
        removals: final.operations.filter(value => value.operation === 'remove').length, modalCount: final.modalCount });
      if (name === 'deletion_read_failure_clears_only_memory_then_explicit_retry') await page.screenshot({ path: path.join(output, 'confirmed-deletion-viewport.png') });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown storage-fixture error';
      report.cases.push({ name, status: 'failed', error: message }); report.errors.push({ name, message });
      try { await page.screenshot({ path: path.join(output, `${name}-failure.png`), timeout: 5000 }); } catch { /* Preserve the original failure. */ }
    } finally { await context.close(); }
  }
  report.status = report.errors.length ? 'failed' : 'passed';
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) {
  report.status = 'failed'; report.errors.push({ name: 'fixture_setup', message: error instanceof Error ? error.message : 'Unknown setup failure' }); process.exitCode = 1;
} finally {
  await browser?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, status: report.status, cases: report.cases.length, errors: report.errors }));
}
