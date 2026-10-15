import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { photoPath } from '../server/photo-files.js';

// Explicit local research acceptance only. Unknown-permission institutional
// references stay separate from the CC-limited photo registry/public assets.
test('Baihe domestic handoff keeps its pictures, pinned sources, scope and review questions readable offline', async () => {
  const root = photoPath(resolve('../zhongyi/content-private/research-refresh'), true);
  const directory = photoPath(join(root, 'baihe-domestic-references-20261014'), true);
  const edition = process.env.BAIHE_REVIEW_EDITION ?? 'domestic-20261014';
  assert(['domestic-20261014', 'domestic-scale-20261014', 'domestic-standard-20261014', 'domestic-drying-20261014', 'domestic-taxonomy-20261014', 'domestic-yixing-thumb-20261014'].includes(edition), 'Unknown local handoff edition');
  const withThumbnail = edition === 'domestic-yixing-thumb-20261014';
  const withTaxonomy = withThumbnail || edition === 'domestic-taxonomy-20261014';
  const withDrying = withTaxonomy || edition === 'domestic-drying-20261014';
  const withStandard = withDrying || edition === 'domestic-standard-20261014';
  const withScale = withStandard || edition === 'domestic-scale-20261014';
  const packFile = withThumbnail ? '2026-10-14-baihe-domestic-draft-pack-v6.json' : withTaxonomy ? '2026-10-14-baihe-domestic-draft-pack-v5.json' : withDrying ? '2026-10-14-baihe-domestic-draft-pack-v4.json' : withStandard ? '2026-10-14-baihe-domestic-draft-pack-v3.json' : withScale ? '2026-10-14-baihe-domestic-draft-pack-v2.json' : '2026-10-14-baihe-domestic-draft-pack.json';
  const htmlFile = withThumbnail ? 'start-v6.html' : withTaxonomy ? 'start-v5.html' : withDrying ? 'start-v4.html' : withStandard ? 'start-v3.html' : withScale ? 'start-v2.html' : 'start.html';
  const pack = readEditorialReviewPack(join(root, packFile));
  const expected = new Map([
    ['cas-zhongbai1-bulbs-reference.jpg', 'fb24c9029037944f4d8a4694b1cd5bc49f75c00e87998508bb6107c22b3c7f99'],
    ['yixing-agriculture-bulbs-reference.jpg', 'db731d424db5276e070ac2cbf908cec801aa4e8d8b286068fd2a199ac6fdcff6'],
    ['baihe-dried-scales-display.jpg', 'fa54db20e4d8abe978daf3f104bcfeecbd50c2e503c65fc29f0145d784643c6c'],
  ]);
  if (withScale) expected.set('baihe-reference-scale-repository-display.jpg', '79504dfffbfa8568924a460250350bbf744b8c454219b217756969022aeff72d');
  if (withDrying) expected.set('baihe-drying-rehydration-repository-display.jpg', '13f34dbd0fee1e60ad036db7822c2293e5c69240b4c88dc5a6413525c67131b2');
  if (withThumbnail) expected.set('../baihe-yixing-source-20261014/yixing-commons-official-thumbnail.jpg', '3c7142db561277d51c59c7ff0711fd3cd5d97006efe708c77d5eb07abc6e2fba');
  function verifyPictures() {
    for (const [name, hash] of expected) assert.equal(createHash('sha256').update(readFileSync(photoPath(join(directory, name), false))).digest('hex'), hash);
    if (withStandard) assert.equal(createHash('sha256').update(readFileSync(photoPath(join(root, 'baihe-current-standard-20261014/db62-t-412-2022-official.pdf'), false))).digest('hex'), 'd244e7a742c69aabc339fb6ea5f4bbba0f4ea575f42fa7641fb38e178263af26');
    if (withTaxonomy) assert.equal(createHash('sha256').update(readFileSync(photoPath(join(root, 'baihe-domestic-processing-20261014/hunan-longshan-processing-reference.jpg'), false))).digest('hex'), '17d12c9c8b669cc4110de12b204a9c8296c25a28ca95d88488ebe33cf2aac39d');
    if (withThumbnail) assert.equal(createHash('sha256').update(readFileSync(photoPath(join(root, 'photo-originals-batch6/baihe-yixing-bulbs-original.jpg'), false))).digest('hex'), '319d7c0ca9e0fde80fa5afe6efad1046782dba919759ccea7a2ccb814db9a9f0');
  }
  verifyPictures(); assert.equal(pack.sources.length, withDrying ? 10 : withStandard ? 9 : withScale ? 8 : 6); assert.equal(pack.drafts.length, 1);
  const parent = resolve('.local/baihe-domestic-evidence'); if (!existsSync(parent)) mkdirSync(parent);
  photoPath(parent, true); const output = join(parent, `run-${randomUUID()}`); mkdirSync(output);
  const report = { schemaVersion: 'baihe-domestic-handoff.1', packFile, htmlFile, standardPdfVerified: withStandard, status: 'running', sourceCount: pack.sources.length, pictures: expected.size,
    views: [] as { width: number; images: number }[], intakeViews: [] as number[], externalRequests: [] as string[], errors: [] as string[],
    sourceFilesUnchanged: false, browserStopped: false, permissionObtained: false, professionalReviewVerified: false,
    publicationEnabled: false, finishedAt: null as string | null };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    await context.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pathToFileURL(join(directory, htmlFile)).href);
      await expect(page.getByRole('heading', { name: '百合：整球、分离片与干片', exact: true })).toBeVisible();
      await expect(page.getByRole('img')).toHaveCount(expected.size);
      assert.equal(await page.locator('img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length), expected.size);
      for (const source of pack.sources) await expect(page.getByRole('heading', { name: source.input.title, exact: true })).toBeVisible();
      await expect(page.getByText(pack.drafts[0]!.content.educationText, { exact: true })).toBeVisible();
      await expect(page.getByText(pack.drafts[0]!.content.safetyText, { exact: true })).toBeVisible();
      await expect(page.getByText(/两张新国内来源照片尚未取得转载或商用许可/)).toBeVisible();
      if (withScale) {
        await expect(page.getByRole('heading', { name: '论文中的分离鳞片参考', exact: true })).toBeVisible();
        await expect(page.getByText(/不能标成“未经处理的食用鲜片”/)).toBeVisible();
        await expect(page.getByRole('heading', { name: '标准版本与排除的线索', exact: true })).toBeVisible();
      }
      if (withStandard) {
        await expect(page.getByRole('heading', { name: '2022标准原件中的形态分类', exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: '鲜散片百合', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: '本地阅读用原件 · 正文1', exact: true })).toHaveAttribute('href', '../baihe-current-standard-20261014/db62-t-412-2022-official.pdf#page=5');
      }
      if (withDrying) {
        await expect(page.getByRole('heading', { name: '干制鳞片与复水形态的研究实拍', exact: true })).toBeVisible();
        await expect(page.getByText(/复水片不等于未经干制的鲜片/)).toBeVisible();
        await expect(page.getByText(/Joao Laurindo为学术编辑，不列为作者/)).toBeVisible();
        const picture = page.getByRole('img', { name: /Foods 2023论文图1B/ });
        assert.deepEqual(await picture.evaluate(element => element instanceof HTMLImageElement ? [element.naturalWidth, element.naturalHeight] : []), [715, 496]);
      }
      if (withTaxonomy) {
        await expect(page.getByRole('heading', { name: '学名差异：两条名称链分开核对', exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: 'Lilium davidii var. unicolor (Hoog) Cotton', exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: 'Lilium brownii var. viridulum Baker', exact: true })).toBeVisible();
        assert.equal(pack.sources.length, 10); assert.equal(pack.drafts[0]!.content.latinName, '');
      }
      if (withThumbnail) {
        await expect(page.getByRole('heading', { name: '宜兴整球：官方独立缩略图', exact: true })).toBeVisible();
        await expect(page.getByText(/本轮没有裁掉尾部、转码替换原件或放宽校验/)).toBeVisible();
        await expect(page.getByRole('link', { name: 'CC BY-SA 4.0', exact: true })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
      }
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      assert.equal(await page.locator('script, form, iframe').count(), 0);
      await page.screenshot({ path: join(output, `baihe-domestic-${width}.png`), fullPage: true });
      await page.getByRole('heading', { name: '国内来源参考图', exact: true }).locator('..').screenshot({ path: join(output, `baihe-domestic-photos-${width}.png`) });
      if (withScale) await page.getByRole('heading', { name: '论文中的分离鳞片参考', exact: true }).locator('..').screenshot({ path: join(output, `baihe-reference-scale-${width}.png`) });
      if (withStandard) await page.getByRole('heading', { name: '2022标准原件中的形态分类', exact: true }).locator('..').screenshot({ path: join(output, `baihe-standard-forms-${width}.png`) });
      if (withDrying) await page.getByRole('heading', { name: '干制鳞片与复水形态的研究实拍', exact: true }).locator('..').screenshot({ path: join(output, `baihe-drying-forms-${width}.png`) });
      if (withTaxonomy) await page.getByRole('heading', { name: '学名差异：两条名称链分开核对', exact: true }).locator('..').screenshot({ path: join(output, `baihe-taxonomy-${width}.png`) });
      if (withThumbnail) await page.getByRole('heading', { name: '宜兴整球：官方独立缩略图', exact: true }).locator('..').screenshot({ path: join(output, `baihe-yixing-thumbnail-${width}.png`) });
      report.views.push({ width, images: expected.size });
      if (withTaxonomy) {
        await page.getByRole('link', { name: '查看现场候选、出处与待审问题（含人脸）', exact: true }).click();
        await expect(page.getByRole('heading', { name: '百合国内加工现场候选', exact: true })).toBeVisible();
        await expect(page.getByRole('img')).toHaveCount(1);
        assert.deepEqual(await page.getByRole('img').evaluate(element => element instanceof HTMLImageElement && element.complete ? [element.naturalWidth, element.naturalHeight] : []), [900, 604]);
        await expect(page.getByText(/转载许可与可辨人脸的隐私/)).toBeVisible();
        await expect(page.getByRole('link', { name: '原始报道、图注与署名', exact: true })).toHaveAttribute('href', 'https://www.hunan.gov.cn/hnszf/hnyw/jdt2/202010/t20201020_13888423.html');
        assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        assert.equal(await page.locator('script, form, iframe').count(), 0);
        await page.screenshot({ path: join(output, `baihe-processing-intake-${width}.png`), fullPage: true }); report.intakeViews.push(width);
      }
    }
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
    verifyPictures(); report.sourceFilesUnchanged = true; report.status = 'passed'; await context.close();
  } catch (error) { report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown handoff failure'); throw error; }
  finally {
    await browser.close(); report.browserStopped = true; report.finishedAt = new Date().toISOString();
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(`Private domestic Baihe handoff evidence: ${output}`);
  }
});
