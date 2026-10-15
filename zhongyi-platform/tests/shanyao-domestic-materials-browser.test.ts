import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect, type Page } from '@playwright/test';
import { prepareEditorialReviewDemo, readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { PhotoDerivativeRegistry } from '../server/photo-derivative-registry.js';
import { inspectDerivativeJpeg } from '../server/photo-derivative-jpeg.js';
import { parseEditorialReference } from '../shared/editorial-references.js';
import { researchPacketHtml, type ResearchDisplay } from '../photo-processing/research-packet.js';
import { launchDemoCli } from './local-demo-process.js';
import type { DemoCredential } from '../server/local-demo.js';

// Explicit local acceptance only. Actual private assets are never default CI inputs.
test('domestic-source yam original, cleaned display and botanical basis work in the actual editor and offline handoff', async () => {
  const root = resolve('.'), assetRoot = resolve('../zhongyi/content-private/research-refresh/shanyao-domestic-20261015');
  const manifest = join(assetRoot, 'originals.json'), packPath = resolve(assetRoot, '../2026-10-15-shanyao-domestic-draft-pack.json');
  const derivativeRoot = resolve('.local/photo-derivatives/run-6d8966a0-74a3-413e-823a-9d0f0bfce991');
  const originals = new PrivatePhotoRegistry(assetRoot, manifest), display = new PhotoDerivativeRegistry(derivativeRoot, originals);
  const pack = readEditorialReviewPack(packPath), candidates = originals.list().items;
  assert.equal(candidates.length, 1); assert.equal(pack.sources.length, 7); assert.equal(pack.drafts.length, 1);
  const photo = candidates[0], draft = pack.drafts[0], derivative = display.metadata(photo.id), bytes = display.asset(photo.id);
  assert(derivative && bytes); assert.equal(draft.ingredientId, 'shan-yao'); assert.equal(photo.ingredientId, draft.ingredientId);
  assert.equal(draft.content.latinName, ''); assert(draft.content.ediblePart.includes('地下块茎'));
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const pins = new Map([
    ['iron-rod-yam-original.jpg', 'd4d12a26b5b8270c500095b60f1a0fb62e474691fecdca533ace465def2b141a'],
    ['commons-source-metadata.json', 'd37ce6f05ef3f07e677203bc66a1337818560c78527a3dfa5dfecbbcf11b4e4e'],
    ['flora-source-page.html', 'c4586796e6a6987a5779bcd12bd9bf0a8466478805c49570f2b54303280d4f6b'],
  ]);
  const checkSources = () => { for (const [file, sha] of pins) assert.equal(hash(join(assetRoot, file)), sha); };
  checkSources(); const original = originals.asset(photo.id); assert(original);
  assert.equal(createHash('sha1').update(original).digest('hex'), 'f4933b76d81dc48d64e92a8db11dcfee7e533e93');
  assert(original.includes(Buffer.from('Exif'))); assert.equal(photo.declaredLicense, 'CC0-1.0');
  const flora = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(assetRoot, 'flora-source-page.html')));
  assert(flora.includes('块茎略呈圆柱形') && flora.includes('珠芽') && flora.includes('Dioscorea polystachya'));
  const info = inspectDerivativeJpeg(bytes); assert.deepEqual([info.width, info.height], [1280, 576]);
  for (const secret of ['Exif', 'GPSLatitude', 'GPSLongitude', 'ICC_PROFILE', 'XMP', 'Photoshop']) assert(!bytes.includes(Buffer.from(secret)));
  const working = resolve('.local/editorial.sqlite'), workingBefore = existsSync(working) ? hash(working) : null;
  const prepared = await prepareEditorialReviewDemo(root, pack), handoff = join(prepared.directory, 'shanyao-handoff');
  mkdirSync(handoff);
  // Reuse the existing safe material renderer; copy the verified derivative once,
  // never transcode the display a second time or include its EXIF-bearing original.
  const reference = parseEditorialReference({ id: 'research-shanyao-iron-rod-display', ingredientId: photo.ingredientId, name: photo.name,
    sourceUrl: `${photo.sourcePage}?oldid=${photo.sourceRevision}`, publisher: 'Wikimedia Commons；作者自述作品', locator: '固定修订1170270151；原件SHA1与官方一致；江苏摄影分类不是原料产地',
    author: photo.author, declaredLicense: photo.declaredLicense, licenseUrl: photo.licenseUrl, representation: 'processed-display', observation: photo.observation,
    concerns: photo.concerns, sha256: derivative.sha256, bytes: derivative.bytes, width: derivative.width, height: derivative.height, publicationEligible: false });
  const item: ResearchDisplay = { reference, filename: `${reference.id}-${derivative.sha256.slice(7)}.jpg`, sha256: derivative.sha256,
    bytes: derivative.bytes, width: derivative.width, height: derivative.height, decodedWidth: derivative.decodedWidth, decodedHeight: derivative.decodedHeight, metadataPolicy: derivative.metadataPolicy };
  writeFileSync(join(handoff, item.filename), bytes, { flag: 'wx' });
  writeFileSync(join(handoff, 'start.html'), researchPacketHtml(pack, [item]), { flag: 'wx' });
  writeFileSync(join(handoff, 'pack.json'), JSON.stringify(pack, null, 2), { flag: 'wx' });
  writeFileSync(join(handoff, 'review-notes.txt'), '山药待审意见（空白，不构成批准）\n姓名/职责/日期：____________\n食品身份、块茎部位与具体品种依据：____________\n加工、权利与画面隐私意见：____________\n无法确认项及需补材料：____________\n实际意见须登记既有工作台，不能由本文件自动批准。\n', { flag: 'wx' });
  // This local evidence adds original→derivative provenance; it is not the
  // processor CLI's private-research-handoff protocol or a publication payload.
  writeFileSync(join(handoff, 'basis.json'), JSON.stringify({ schemaVersion: 'private-shanyao-material-evidence.1', packDigest: prepared.report.packDigest,
    originalManifestDigest: hash(manifest), sourceDerivativeDigest: derivative.digest, sourceFilesIncluded: false, publicationEligible: false,
    professionalReview: 'pending', generativeEdit: false, crop: 'none', displayReencodedDuringHandoff: false, items: [item] }, null, 2), { flag: 'wx' });
  assert.equal(readdirSync(handoff).length, 5); assert.equal(hash(join(handoff, item.filename)), derivative.sha256.slice(7));
  const users: DemoCredential[] = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts;
  const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const address = probe.address(); assert(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  let app: Awaited<ReturnType<typeof launchDemoCli>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report = { status: 'running', packDigest: prepared.report.packDigest, sourceCount: 7, candidates: 1, originalBytes: original.length, displayBytes: bytes.length,
    handoff, offlineViews: [] as number[], editorViews: [] as number[], errors: [] as string[], externalRequests: [] as string[], originalRequests: 0,
    applicationStarts: 0, gracefulStops: 0, fixturesStopped: false, saveAndRestartVerified: false, reviewerReadOnlyVerified: false, publicBoundaryVerified: false,
    workingDatabaseUnchanged: false, originalSnapshotsUnchanged: false, actualProfessionalApproval: false, publicPhotosAdded: 0, actualWeChatOrPhone: false, realAiCalls: 0 };
  const photos = { manifest, derivatives: derivativeRoot };
  async function login(page: Page, role: 'editor' | 'reviewer') {
    assert(app); const user = users.find(user => user.role === role); assert(user);
    await page.goto(app.url); await page.getByLabel('用户名', { exact: true }).fill(user.username); await page.getByLabel('密码', { exact: true }).fill(user.password);
    const response = page.waitForResponse(value => value.url().endsWith('/api/v1/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: /登录工作台/ }).click(); assert.equal((await response).status(), 200);
    await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '内容修订', exact: true }).click();
    await page.getByLabel('搜索待编辑食材', { exact: true }).fill('山药'); await page.getByRole('button', { name: '编辑山药内容', exact: true }).click();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toBeVisible();
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext();
    await context.route(/^https?:/, route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalRequests.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/original')) report.originalRequests++; });
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(pathToFileURL(join(handoff, 'start.html')).href);
      await expect(page.getByRole('img')).toHaveCount(1);
      await expect.poll(() => page.getByRole('img').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1280, 576]);
      for (const source of pack.sources) await expect(page.getByRole('heading', { name: source.input.title, exact: true })).toBeVisible();
      for (const concern of photo.concerns) await expect(page.getByText(concern, { exact: true })).toBeVisible();
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: join(prepared.directory, `yam-offline-${width}.png`), fullPage: true }); report.offlineViews.push(width);
    }
    app = await launchDemoCli(root, prepared.demoId, port, 'compiled', photos); report.applicationStarts++;
    assert.equal((await context.request.get(`${app.url}/api/v1/private-photos`)).status(), 401);
    await login(page, 'editor'); const panel = page.getByRole('region', { name: '当前食材待审图片', exact: true });
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(draft.content.educationText);
      await expect(page.locator('.draft-source')).toHaveCount(7);
      for (const source of pack.sources) await expect(page.locator('.draft-source').getByText(source.input.title, { exact: true })).toBeVisible();
      const image = panel.getByRole('img', { name: `${photo.name}，私有待审展示图`, exact: true }); await expect(image).toBeVisible();
      assert.deepEqual(await image.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]), [1280, 576]);
      await expect(panel.getByRole('link', { name: /来源/ })).toHaveAttribute('href', `${photo.sourcePage}?oldid=${photo.sourceRevision}`);
      const concernsSummary = panel.getByText('匹配观察与待核对事项', { exact: true });
      if (await concernsSummary.locator('..').getAttribute('open') === null) await concernsSummary.click();
      for (const concern of photo.concerns) await expect(panel.getByText(concern, { exact: true })).toBeVisible();
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await panel.screenshot({ path: join(prepared.directory, `yam-editor-photo-${width}.png`) }); report.editorViews.push(width);
    }
    const updated = draft.content.educationText + '\n本地保存演练，未构成审核批准。';
    await page.getByLabel('草稿教育说明', { exact: true }).fill(updated); await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果', exact: true })).toContainText('已保存私有草稿');
    await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
    await app.close(); report.gracefulStops++; app = undefined;
    app = await launchDemoCli(root, prepared.demoId, port, 'compiled', photos); report.applicationStarts++;
    await login(page, 'editor'); await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(updated); await expect(panel.getByRole('img')).toBeVisible(); report.saveAndRestartVerified = true;
    await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
    await login(page, 'reviewer'); await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: '保存内容草稿', exact: true })).toBeDisabled(); await expect(panel.getByRole('img')).toBeVisible(); report.reviewerReadOnlyVerified = true;
    const publicCatalog = await (await context.request.get(`${app.url}/api/v1/public/catalog`)).text();
    assert(!publicCatalog.includes(photo.id) && !publicCatalog.includes(JSON.stringify(updated).slice(1, -1)));
    assert.equal((await context.request.get(`${app.url}/api/v1/public/photos/shan-yao`)).status(), 503);
    assert.equal((await (await context.request.get(`${app.url}/api/v1/editorial/assistant/config`)).json()).enabled, false);
    report.publicBoundaryVerified = true; assert.equal(report.originalRequests, 0); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown local yam material failure'); throw error; }
  finally {
    try { await browser?.close(); if (app) { await app.close(); report.gracefulStops++; } report.fixturesStopped = report.applicationStarts === report.gracefulStops; }
    finally {
      checkSources(); report.originalSnapshotsUnchanged = true; report.workingDatabaseUnchanged = workingBefore === (existsSync(working) ? hash(working) : null);
      const db = new DatabaseSync(join(prepared.directory, 'editorial.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('SELECT count(*) n FROM source_versions').get()!.n, 7);
        for (const table of ['source_checks', 'photo_notes', 'photo_submissions', 'photo_rights_reviews', 'photo_professional_reviews', 'professional_reviews', 'professional_qualifications', 'review_tasks', 'publication_approvals', 'publication_events', 'assistant_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
      } finally { db.close(); }
      writeFileSync(join(prepared.directory, 'yam-materials-report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
      console.log(`Private yam material evidence: ${prepared.directory}`); assert(report.fixturesStopped && report.workingDatabaseUnchanged);
    }
  }
});
