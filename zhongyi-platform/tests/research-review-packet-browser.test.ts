import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { prepareResearchPacket } from '../photo-processing/research-packet.js';
import { inspectDerivativeJpeg } from '../server/photo-derivative-jpeg.js';
import { readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { photoPath } from '../server/photo-files.js';
import { researchPacketHtml } from '../photo-processing/research-packet.js';

// Explicit local acceptance uses private materials; not included in default CI.
test('actual Baihe portable packet contains the selected cleaned displays and exact source/draft snapshot only', async () => {
  const edition = process.env.BAIHE_REVIEW_EDITION ?? 'domestic-yixing-thumb-20261014';
  assert(['domestic-yixing-thumb-20261014', 'domestic-food-forms-20261014', 'domestic-gansu-dry-20261014', 'domestic-edible-part-20261014'].includes(edition), 'Unknown research packet edition');
  const withEdiblePart = edition === 'domestic-edible-part-20261014';
  const withGansuDry = withEdiblePart || edition === 'domestic-gansu-dry-20261014', referenceCount = withGansuDry ? 7 : 6;
  const packPath = resolve(`../zhongyi/content-private/research-refresh/2026-10-14-baihe-domestic-draft-pack-${withEdiblePart ? 'v9' : withGansuDry ? 'v8' : edition === 'domestic-food-forms-20261014' ? 'v7' : 'v6'}.json`);
  const referencePath = resolve(`../zhongyi/content-private/research-refresh/2026-10-14-baihe-editorial-references-${withGansuDry ? 'v3' : 'v2'}.json`);
  const original = withGansuDry ? resolve('../zhongyi/content-private/research-refresh/baihe-gansu-dry-20261014/gansu-dried-lily-original.jpg') : null;
  const checkOriginal = () => {
    if (original) {
      const bytes = readFileSync(photoPath(original, false));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), 'f277e21dc1fd3b002fa47d75be84404991597b235c4f6aa33215d02ed0e1039e');
      assert(bytes.includes(Buffer.from('Exif')), 'The retained original has metadata; it must not be the portable display');
    }
  };
  checkOriginal();
  const working = resolve('.local/editorial.sqlite'), hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex'), before = existsSync(working) ? hash(working) : null;
  const pack = readEditorialReviewPack(packPath), existing = process.env.RESEARCH_PACKET_VERIFY_DIRECTORY;
  let result: Awaited<ReturnType<typeof prepareResearchPacket>>;
  if (existing !== undefined) {
    const directory = photoPath(existing, true), parent = resolve('.local/research-review-packets');
    if (!/^(?:run|zip-check)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(directory.split(/[\\/]/).at(-1) ?? '') || resolve(directory, '..') !== parent) throw new Error('Owned research packet directory required');
    const committed = JSON.parse(readFileSync(join(directory, 'basis.json'), 'utf8'));
    if (committed.schemaVersion !== 'private-research-handoff.1' || committed.packDigest !== `sha256:${createHash('sha256').update(JSON.stringify(pack)).digest('hex')}` ||
      committed.manifestDigest !== `sha256:${hash(referencePath)}` || committed.publicationEligible !== false || !Array.isArray(committed.items) || committed.items.length !== referenceCount) throw new Error('Wrong committed research snapshot');
    researchPacketHtml(pack, committed.items); // Validates reference projection and safe filenames before any path use.
    result = { directory, packDigest: committed.packDigest, manifestDigest: committed.manifestDigest, references: referenceCount,
      sourceBytes: committed.items.reduce((sum: number, item: { reference: { bytes: number } }) => sum + item.reference.bytes, 0), displayBytes: committed.items.reduce((sum: number, item: { bytes: number }) => sum + item.bytes, 0), publicationEligible: false };
  } else result = await prepareResearchPacket({ pack: packPath, references: referencePath, browser: 'edge' });
  const basis = JSON.parse(readFileSync(join(result.directory, 'basis.json'), 'utf8'));
  assert.equal(basis.items.length, referenceCount); assert.equal(basis.packDigest, result.packDigest); assert.equal(basis.sourceFilesIncluded, false); assert.equal(basis.publicationEligible, false);
  const names = readdirSync(result.directory).sort(), expected = ['start.html', 'pack.json', 'review-notes.txt', 'basis.json', ...basis.items.map((item: { filename: string }) => item.filename)].sort();
  assert.deepEqual(names, expected); assert.deepEqual(JSON.parse(readFileSync(join(result.directory, 'pack.json'), 'utf8')), pack);
  for (const item of basis.items) {
    const bytes = readFileSync(join(result.directory, item.filename)), info = inspectDerivativeJpeg(bytes);
    assert.equal(`sha256:${hash(join(result.directory, item.filename))}`, item.sha256); assert.equal(info.metadataPolicy, 'jfif-only-no-thumbnail'); assert.equal(info.width, item.width); assert.equal(info.height, item.height);
    for (const raw of ['Exif', 'GPSLatitude', 'GPSLongitude', 'ICC_PROFILE', 'XMP', 'Photoshop']) assert.equal(bytes.includes(Buffer.from(raw)), false);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), errors: string[] = [], external: string[] = [];
  try {
    const context = await browser.newContext(); await context.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(pathToFileURL(join(result.directory, 'start.html')).href);
      await expect(page.getByRole('img')).toHaveCount(referenceCount);
      assert.equal(await page.getByRole('img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length), referenceCount);
      await expect(page.getByText(pack.drafts[0].content.educationText, { exact: true })).toBeVisible();
      for (const source of pack.sources) await expect(page.getByRole('heading', { name: source.input.title, exact: true })).toBeVisible();
      for (const item of basis.items) {
        await expect(page.getByRole('heading', { name: item.reference.name, exact: true })).toBeVisible();
        await page.getByRole('heading', { name: item.reference.name, exact: true }).locator('..').screenshot({ path: join(result.directory, '..', `qa-${result.directory.split(/[\\/]/).at(-1)}-${item.reference.id}-${width}.png`) });
      }
      assert.equal(await page.locator('script, form, iframe').count(), 0); assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  assert.equal(before, existsSync(working) ? hash(working) : null);
  checkOriginal();
  const report = { ...result, status: 'passed', names, views: [1200, 390], images: referenceCount, sources: 10, originalFilesIncluded: false, credentialsOrDatabaseIncluded: false,
    workingDatabaseUnchanged: true, browserStopped: true, externalRequests: external, errors, finishedAt: new Date().toISOString() };
  writeFileSync(join(result.directory, '..', `qa-${result.directory.split(/[\\/]/).at(-1)}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
});
