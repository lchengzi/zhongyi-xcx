import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { prepareResearchPacket } from '../photo-processing/research-packet.js';
import { readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { EditorialReferenceRegistry } from '../server/editorial-references.js';
import { inspectDerivativeJpeg } from '../server/photo-derivative-jpeg.js';
import { object } from '../shared/workflow-response.js';
import { parseEditorialReference } from '../shared/editorial-references.js';

// Opt-in real local research assets; no private images enter default/remote CI.
test('selected food-part supplement binds domestic page photographs, sources and pending questions offline', async () => {
  const root = resolve('../zhongyi/content-private/research-refresh');
  const edition = process.env.BAIHE_REVIEW_EDITION ?? 'food-part-supplement-20261014';
  assert(['food-part-supplement-20261014', 'fresh-form-supplement-20261015'].includes(edition));
  const fresh = edition === 'fresh-form-supplement-20261015', imageCount = fresh ? 1 : 2, sourceCount = fresh ? 4 : 5;
  const packPath = join(root, fresh ? '2026-10-15-baihe-fresh-form-supplement.json' : '2026-10-14-baihe-food-part-supplement.json');
  const manifest = join(root, fresh ? 'baihe-shangjie-food-20261015/references.json' : 'baihe-xinhua-food-20261014/references.json');
  const pack = readEditorialReviewPack(packPath), registry = new EditorialReferenceRegistry(manifest);
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const bound = new Map(fresh ? [
    ['baihe-shangjie-food-20261015/source-page.html', '5f05664cdf20a6bb15f9d34a4603cd3fddabd1768ba44c9220cf4299e2248e42'],
    ['baihe-shangjie-food-20261015/source-image-666.jpg', '7fe874fc6daae582a505f269a3b0df49995b2a29b04bf6b98f621f23c55f1a65'],
    ['baihe-shangjie-food-20261015/source-image-670.jpg', '9ec29fe32f1107c87276ed3592b3707280125f80cc3c9f7422b7f6dbde1aeb49'],
  ] : [
    ['baihe-xinhua-food-20261014/source-page.html', 'cbf0990ea131fbba9d0450830c2f2cdad0bdaaae8d73c0c289cdc5a3fcf0e618'],
    ['baihe-xinhua-food-20261014/cdc-edible-part-source-page.html', '1020b4bd06b2491d7fd916aa2002d00abc8d358f57a85ef3e069bd1f46278450'],
    ['baihe-xinhua-food-20261014/source-image-1.jpeg', '40535d1983ca417ad3cca4e1dd0623a0bd5b8a6280bf3935dbadebdd34fac338'],
    ['baihe-xinhua-food-20261014/source-image-2.jpeg', 'ae6a7484b290eb1c114e4489029183b6db5ad2871b6fe47be6dd56a2991fe181'],
    ['baihe-longshan-news-20261014/source-page.html', 'e474206f6547d2aff06ccd9ee965582b52280e0ae79531dcba0091e9741a37ee'],
    ['baihe-longshan-news-20261014/source-harvest.jpg', '586327d0953dc1ecb5a1f4e8df4fff2e66fbcebcdf28b493c35e7eecaf3b5d78'],
    ['baihe-longshan-news-20261014/source-dried-products.jpg', 'e18bffdfdc31a44fccbb066e6477a98153b29cf61bb8ad27c9f1192b73e3815b'],
  ]);
  const checkSources = () => { for (const [file, digest] of bound) assert.equal(sha(join(root, file)), digest); };
  checkSources();
  const cdc = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(root, 'baihe-xinhua-food-20261014/cdc-edible-part-source-page.html')));
  assert(cdc.includes('肉质鳞片') && cdc.includes('图片由AI生成') && cdc.includes('广州市疾病预防控制中心'));
  if (fresh) {
    const article = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(root, 'baihe-shangjie-food-20261015/source-page.html')));
    assert(article.includes('戴熙春') && article.includes('锐公司') && article.includes('由数十瓣鳞片叠抱'));
    assert(pack.sources.find(item => item.key === 'lanzhou-evening-fresh-slices-permission-lead-2026')?.evidenceNote.includes('没有下载图片'));
    assert.equal(registry.list().items[0].author, '文章作者戴熙春；原页未单列图片摄影者');
  }
  assert.equal(pack.sources.length, sourceCount); assert.equal(registry.list().items.length, imageCount);
  assert.equal(pack.drafts[0].content.latinName, ''); assert.equal(pack.publicationEnabled, false);
  assert(pack.drafts[0].content.educationText.includes('同一颗'));
  const working = resolve('.local/editorial.sqlite'), before = existsSync(working) ? sha(working) : null;
  const result = await prepareResearchPacket({ pack: packPath, references: manifest, browser: 'edge' });
  const basis = object(JSON.parse(readFileSync(join(result.directory, 'basis.json'), 'utf8')) as unknown,
    'schemaVersion preparedAt packDigest manifestDigest encoderVersion pipeline maxEdge quality crop generativeEdit sourceFilesIncluded workflowRecordsRead publicationEligible professionalReview items');
  assert.equal(basis.publicationEligible, false); assert.equal(basis.professionalReview, 'pending');
  assert.equal(basis.sourceFilesIncluded, false); assert.equal(basis.crop, 'none'); assert.equal(basis.generativeEdit, false);
  assert(Array.isArray(basis.items)); assert.equal(basis.items.length, imageCount);
  const displays = basis.items.map(raw => {
    const item = object(raw, 'reference filename sha256 bytes width height decodedWidth decodedHeight metadataPolicy');
    const reference = parseEditorialReference(item.reference);
    assert(typeof item.filename === 'string' && typeof item.sha256 === 'string');
    assert.match(item.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(item.filename, `${reference.id}-${item.sha256.slice(7)}.jpg`);
    assert(typeof item.width === 'number' && typeof item.height === 'number' && typeof item.decodedWidth === 'number' && typeof item.decodedHeight === 'number');
    return { reference, filename: item.filename, sha256: item.sha256,
      width: item.width, height: item.height, decodedWidth: item.decodedWidth, decodedHeight: item.decodedHeight };
  });
  const expected = ['start.html', 'pack.json', 'review-notes.txt', 'basis.json'];
  for (const reference of registry.list().items) {
    const display = displays.find(item => item.reference.id === reference.id);
    assert(display); assert.equal(display.reference.publicationEligible, false);
    assert.equal(display.reference.declaredLicense, 'not-established');
    assert.equal(display.width, reference.width); assert.equal(display.height, reference.height);
    assert.equal(display.decodedWidth, reference.width); assert.equal(display.decodedHeight, reference.height);
    const info = inspectDerivativeJpeg(readFileSync(join(result.directory, display.filename)));
    assert.equal(info.metadataPolicy, 'jfif-only-no-thumbnail');
    assert.equal(`sha256:${sha(join(result.directory, display.filename))}`, display.sha256);
    expected.push(display.filename);
  }
  assert.deepEqual(readdirSync(result.directory).sort(), expected.sort());
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), external: string[] = [], errors: string[] = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pathToFileURL(join(result.directory, 'start.html')).href);
      await expect(page.getByRole('img')).toHaveCount(imageCount);
      assert.equal(await page.getByRole('img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length), imageCount);
      await expect(page.getByText(pack.drafts[0].content.ediblePart, { exact: true })).toBeVisible();
      await expect(page.getByText(pack.drafts[0].content.safetyText, { exact: true })).toBeVisible();
      for (const source of pack.sources) await expect(page.getByRole('heading', { name: source.input.title, exact: true })).toBeVisible();
      for (const reference of registry.list().items) {
        const card = page.getByRole('heading', { name: reference.name, exact: true }).locator('..');
        await expect(card.getByRole('link', { name: '图片出处', exact: true })).toHaveAttribute('href', reference.sourceUrl);
        for (const concern of reference.concerns) await expect(card.getByText(concern, { exact: true })).toBeVisible();
        await card.screenshot({ path: join(result.directory, '..', `qa-${result.directory.split(/[\\/]/).at(-1)}-${reference.id}-${width}.png`) });
      }
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      assert.equal(await page.locator('script,iframe,form,video').count(), 0);
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  checkSources(); assert.equal(before, existsSync(working) ? sha(working) : null);
  const report = { ...result, status: 'passed', edition, sources: sourceCount, selectedPagePhotographs: imageCount, photographerOriginalsObtained: 0,
    excludedNonFoodOrFaceImages: fresh ? 1 : 2, aiImagesAcquired: 0, views: [1200, 390], originalSnapshotsUnchanged: true,
    originalPhotosIncluded: false, professionalReviewVerified: false, browserStopped: true, workingDatabaseUnchanged: true,
    externalRequests: external, errors, finishedAt: new Date().toISOString() };
  writeFileSync(join(result.directory, '..', `qa-${result.directory.split(/[\\/]/).at(-1)}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
});
