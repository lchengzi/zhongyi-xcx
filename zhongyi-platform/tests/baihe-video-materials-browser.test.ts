import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { parseEditorialReference } from '../shared/editorial-references.js';
import { object } from '../shared/workflow-response.js';
import { photoPath } from '../server/photo-files.js';
import { inspectDerivativeJpeg } from '../server/photo-derivative-jpeg.js';

// Opt-in actual local research assets. Video frames deliberately do not enter
// the original-photo registry, publication contract or default remote CI.
test('Baihe full-frame evidence stays private, source-bound and readable with the seven existing displays offline', async () => {
  const root = photoPath(resolve('../zhongyi/content-private/research-refresh'), true);
  const directory = photoPath(join(root, 'baihe-video-reference-20261014/review-v10'), true);
  const pack = readEditorialReviewPack(join(directory, 'pack.json'));
  assert.deepEqual(pack, readEditorialReviewPack(join(root, '2026-10-14-baihe-domestic-draft-pack-v10.json')));
  const sha = (file: string) => `sha256:${createHash('sha256').update(readFileSync(photoPath(file, false))).digest('hex')}`;
  const basis = object(JSON.parse(readFileSync(join(directory, 'basis.json'), 'utf8')) as unknown,
    'schemaVersion preparedAt packDigest sourceDisplaysOrigin sourceManifestDigest publicationEligible professionalReview originalPhotosIncluded fullVideoIncluded mediaSegmentsIncluded sourceMetadataIncluded credentialsOrDatabaseIncluded selectedVideoFrame researchDisplays');
  assert.equal(basis.schemaVersion, 'private-baihe-video-handoff.1');
  assert.equal(basis.packDigest, `sha256:${createHash('sha256').update(JSON.stringify(pack)).digest('hex')}`);
  assert.equal(basis.publicationEligible, false); assert.equal(basis.professionalReview, 'pending');
  for (const field of ['originalPhotosIncluded', 'fullVideoIncluded', 'mediaSegmentsIncluded', 'sourceMetadataIncluded', 'credentialsOrDatabaseIncluded']) assert.equal(basis[field], false);
  assert(Array.isArray(basis.researchDisplays)); assert.equal(basis.researchDisplays.length, 7); assert.equal(pack.sources.length, 10);
  const names = ['start.html', 'pack.json', 'basis.json', 'review-notes.txt', 'frame-072.png'];
  for (const entry of basis.researchDisplays) {
    const item = object(entry, 'reference filename sha256 bytes width height decodedWidth decodedHeight metadataPolicy');
    const reference = parseEditorialReference(item.reference);
    assert(typeof item.filename === 'string' && typeof item.sha256 === 'string');
    assert.match(item.filename, /^research-[a-z0-9-]+-[a-f0-9]{64}\.jpg$/);
    assert.equal(item.filename, `${reference.id}-${item.sha256.slice(7)}.jpg`);
    assert.equal(sha(join(directory, item.filename)), item.sha256);
    const info = inspectDerivativeJpeg(readFileSync(photoPath(join(directory, item.filename), false)));
    assert.equal(info.width, item.width); assert.equal(info.height, item.height); assert.equal(info.bytes, item.bytes);
    names.push(item.filename);
  }
  const frame = object(basis.selectedVideoFrame, 'filename bytes sha256 width height requestedSeconds actualSeconds sourcePage pid representation declaredLicense publicationEligible crop');
  assert.equal(frame.filename, 'frame-072.png'); assert.equal(frame.actualSeconds, 72.031161);
  assert(typeof frame.sourcePage === 'string');
  assert.equal(frame.representation, 'full-video-frame-not-photographer-original'); assert.equal(frame.declaredLicense, 'not-established');
  assert.equal(frame.publicationEligible, false); assert.equal(frame.crop, 'none-full-frame-with-original-branding');
  assert.equal(frame.sha256, 'sha256:0c241542a1983de164a80498283a672d6a7e47be5ff83abcc7d804e3ef2f0854');
  assert.equal(sha(join(directory, 'frame-072.png')), frame.sha256);
  assert.equal(sha(join(root, 'baihe-video-reference-20261014/inspect-HOVlyA/frame-072.png')), frame.sha256);
  assert.deepEqual(readdirSync(directory).sort(), names.sort());
  const working = resolve('.local/editorial.sqlite'), before = existsSync(working) ? sha(working) : null;
  const parent = resolve('.local/baihe-video-evidence'); mkdirSync(parent, { recursive: true });
  const output = join(parent, `run-${randomUUID()}`); mkdirSync(output);
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), external: string[] = [], errors: string[] = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(pathToFileURL(join(directory, 'start.html')).href);
      await expect(page.getByRole('img')).toHaveCount(8);
      assert.equal(await page.getByRole('img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length), 8);
      await expect(page.getByRole('heading', { name: '国内采挖现场：已看画面，仍未证实球片配对', exact: true })).toBeVisible();
      const section = page.locator('#video-evidence');
      assert.deepEqual(await section.getByRole('img').evaluate(image => image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight] : []), [480, 360]);
      await expect(section.getByRole('link', { name: '央视原网页与节目出处', exact: true })).toHaveAttribute('href', frame.sourcePage);
      await expect(page.getByText(pack.drafts[0].content.educationText, { exact: true })).toBeVisible();
      await expect(page.getByText(pack.drafts[0].content.safetyText, { exact: true })).toBeVisible();
      for (const source of pack.sources) await expect(page.getByRole('heading', { name: source.input.title, exact: true })).toBeVisible();
      assert.equal(await page.locator('script,iframe,form,video').count(), 0);
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await section.screenshot({ path: join(output, `video-reference-${width}.png`) });
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  assert.equal(before, existsSync(working) ? sha(working) : null);
  const report = { status: 'passed', directory, packDigest: basis.packDigest, files: names, views: [1200, 390], researchDisplays: 7, videoFrames: 1,
    actualOriginalPhotosAdded: 0, publicationEligible: false, externalRequests: external, errors, browserStopped: true, workingDatabaseUnchanged: true, finishedAt: new Date().toISOString() };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ output, ...report }));
});
