import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect, type Page } from '@playwright/test';
import { prepareEditorialReviewDemo, readEditorialReviewPack } from '../server/editorial-review-pack.js';
import { EditorialReferenceRegistry } from '../server/editorial-references.js';
import { launchDemoCli } from './local-demo-process.js';
import type { DemoCredential } from '../server/local-demo.js';

declare global { interface Window { __researchUrls?: { created: string[]; revoked: string[] } } }
// Opt-in actual local private materials; not a remote CI attachment/dependency.
test('actual Baihe research images, sources and questions work together in the normal compiled React editor', async () => {
  const root = resolve('.'), assetRoot = resolve('../zhongyi/content-private/research-refresh');
  const edition = process.env.BAIHE_REVIEW_EDITION ?? 'domestic-drying-20261014';
  assert(['domestic-drying-20261014', 'domestic-taxonomy-20261014', 'domestic-yixing-thumb-20261014', 'domestic-food-forms-20261014', 'domestic-gansu-dry-20261014', 'domestic-edible-part-20261014', 'domestic-video-20261014', 'food-part-supplement-20261014', 'fresh-form-supplement-20261015', 'fresh-supplier-20261015'].includes(edition), 'Unknown private research editor edition');
  const withSupplierSupplement = edition === 'fresh-supplier-20261015';
  const withFreshFormSupplement = withSupplierSupplement || edition === 'fresh-form-supplement-20261015';
  const withFoodPartSupplement = edition === 'food-part-supplement-20261014';
  const withVideo = edition === 'domestic-video-20261014';
  const withEdiblePart = withVideo || edition === 'domestic-edible-part-20261014';
  const withGansuDry = withEdiblePart || edition === 'domestic-gansu-dry-20261014';
  const withFoodForms = withGansuDry || edition === 'domestic-food-forms-20261014';
  const withThumbnail = withFoodForms || edition === 'domestic-yixing-thumb-20261014';
  const manifest = join(assetRoot, withSupplierSupplement ? '2026-10-15-baihe-supplier-form-references.json' : withFreshFormSupplement ? 'baihe-shangjie-food-20261015/references.json' : withFoodPartSupplement ? 'baihe-xinhua-food-20261014/references.json' : withGansuDry ? '2026-10-14-baihe-editorial-references-v3.json' : withThumbnail ? '2026-10-14-baihe-editorial-references-v2.json' : '2026-10-14-baihe-editorial-references.json'), registry = new EditorialReferenceRegistry(manifest);
  const packFile = withSupplierSupplement ? '2026-10-15-baihe-supplier-form-supplement.json' : withFreshFormSupplement ? '2026-10-15-baihe-fresh-form-supplement.json' : withFoodPartSupplement ? '2026-10-14-baihe-food-part-supplement.json' : withVideo ? '2026-10-14-baihe-domestic-draft-pack-v10.json' : withEdiblePart ? '2026-10-14-baihe-domestic-draft-pack-v9.json' : withGansuDry ? '2026-10-14-baihe-domestic-draft-pack-v8.json' : withFoodForms ? '2026-10-14-baihe-domestic-draft-pack-v7.json' : withThumbnail ? '2026-10-14-baihe-domestic-draft-pack-v6.json' : edition === 'domestic-taxonomy-20261014' ? '2026-10-14-baihe-domestic-draft-pack-v5.json' : '2026-10-14-baihe-domestic-draft-pack-v4.json';
  const raw = readEditorialReviewPack(join(assetRoot, packFile));
  const prepared = await prepareEditorialReviewDemo(root, raw), references = registry.list().items;
  assert.equal(references.length, withSupplierSupplement ? 2 : withFreshFormSupplement ? 1 : withFoodPartSupplement ? 2 : withGansuDry ? 7 : withThumbnail ? 6 : 5);
  const sourceCount = withSupplierSupplement ? 5 : withFreshFormSupplement ? 4 : withFoodPartSupplement ? 5 : 10;
  assert.equal(raw.sources.length, sourceCount);
  if (withFreshFormSupplement) {
    assert.equal(raw.drafts[0].content.latinName, '');
    assert(raw.drafts[0].content.educationText.includes('没有复制图片'));
    assert(raw.drafts[0].content.safetyText.includes('先取得版权方许可'));
    assert.equal(references[0].sha256, 'sha256:7fe874fc6daae582a505f269a3b0df49995b2a29b04bf6b98f621f23c55f1a65');
  }
  if (withSupplierSupplement) {
    assert.equal(references[1].sha256, 'sha256:d3ee591aefdb9b966f8a84dfd88c4e559ccda15b43b22e805174a9b1c4fd1f85');
    assert.equal(references[1].declaredLicense, 'not-established');
    assert(raw.drafts[0].content.educationText.includes('不证明未经处理、免洗、生食或即食'));
    assert(references[1].concerns.some(item => item.includes('商标')));
  }
  if (withFoodPartSupplement) {
    assert(raw.drafts[0].content.ediblePart.includes('肉质鳞片'));
    assert(raw.drafts[0].content.educationText.includes('不能拼成同一颗百合的加工前后'));
    assert(raw.drafts[0].content.safetyText.includes('AI生成'));
    assert.equal(raw.drafts[0].content.latinName, '');
  }
  if (withEdiblePart) {
    const snapshot = readFileSync(join(assetRoot, 'baihe-edible-part-sources-20261014/cntv-20110816-original.html'));
    assert.equal(createHash('sha256').update(snapshot).digest('hex'), '8bd40a0ba2d8c47bd9be2cb13e505315ecede06ad3358fb50e7a050cf20dcf05');
    // The untouched legacy page has a bad byte in an unrelated block. Validate
    // the pinned article region strictly; do not silently replace source bytes.
    assert.throws(() => new TextDecoder('gbk', { fatal: true }).decode(snapshot));
    const begin = snapshot.indexOf('<!--repaste.body.begin-->'), end = snapshot.indexOf('<!--repaste.body.end-->');
    assert.equal(begin, 45977); assert.equal(end, 52507);
    assert.equal(snapshot.indexOf('<!--repaste.body.begin-->', begin + 1), -1);
    assert.equal(snapshot.indexOf('<!--repaste.body.end-->', end + 1), -1);
    assert.equal(createHash('sha256').update(snapshot.subarray(begin, end)).digest('hex'), 'f1e29bc643eefc4b4627a95e5124590ad0f608276d54b9d2f0b646aa106ca818');
    const source = new TextDecoder('gbk', { fatal: true }).decode(snapshot.subarray(begin, end));
    assert(source.includes('百合的地下茎为鳞茎') && source.includes('我剥开一个您看看就知道了'));
    assert(raw.sources.some(item => item.key === 'cntv-2011-lanzhou-bulb-peeling'));
    assert(!raw.sources.some(item => item.key === 'commons-yixing-bulb-thumbnail'));
    assert(raw.drafts[0].content.ediblePart.includes('肉质鳞片'));
    assert(raw.drafts[0].content.educationText.includes(withVideo ? '未核实连续剥取或同一颗样本' : '未取得视频或配对帧'));
    assert(raw.drafts[0].content.educationText.includes('七图没有同一颗或同一批食品样本'));
  }
  if (withGansuDry) {
    const added = references.find(item => item.id === 'research-gansu-dried-scales'); assert(added);
    assert.equal(added.representation, 'processed-display'); assert.equal(added.publicationEligible, false);
    assert.equal(added.sha256, 'sha256:d95d0944ea6aec78f41e13c1d1a61ec49e136011b206cd0783034e9c03e37947');
    assert(added.concerns.some(value => value.includes('Dried flower textures')));
  }
  const users: DemoCredential[] = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8')).accounts;
  const working = resolve('.local/editorial.sqlite'), hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = existsSync(working) ? hash(working) : null, manifestBefore = hash(manifest);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  let app: Awaited<ReturnType<typeof launchDemoCli>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report = { schemaVersion: 'editorial-research-browser.1', demoId: prepared.demoId, packFile, packDigest: prepared.report.packDigest, status: 'running', sourceCount: raw.sources.length, referenceCount: references.length,
    views: [] as { id: string; width: number }[], errors: [] as string[], applicationStarts: 0, gracefulStops: 0, fixturesStopped: false, workingDatabaseUnchanged: false,
    dirtyInputPreserved: false, listFailureRejected: false, corruptImageRejected: false, cancelledReadRetired: false, hiddenCleanupVerified: false, logoutCleanupVerified: false,
    saveAndRestartVerified: false, reviewerReadOnlyVerified: false, originalRequests: 0, publicBoundaryVerified: false, publicationEnabled: false, professionalReviewVerified: false, realModelCalls: 0,
    manifestUnchanged: false, finishedAt: null as string | null };
  async function login(page: Page, role: 'editor' | 'reviewer') {
    assert(app); const user = users.find(item => item.role === role); assert(user);
    await page.goto(app.url); await page.getByLabel('用户名', { exact: true }).fill(user.username); await page.getByLabel('密码', { exact: true }).fill(user.password);
    const response = page.waitForResponse(value => value.url().endsWith('/api/v1/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: /登录工作台/ }).click(); assert.equal((await response).status(), 200);
    await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '内容修订', exact: true }).click();
    await page.getByLabel('搜索待编辑食材', { exact: true }).fill('百合'); await page.getByRole('button', { name: '编辑百合内容', exact: true }).click();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toBeVisible();
  }
  try {
    app = await launchDemoCli(root, prepared.demoId, port, 'compiled', undefined, manifest); report.applicationStarts++;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.addInitScript(() => {
      const evidence = { created: [] as string[], revoked: [] as string[] }; window.__researchUrls = evidence;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { const result = create(value); evidence.created.push(result); return result; };
      URL.revokeObjectURL = value => { evidence.revoked.push(value); revoke(value); };
    });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/original')) report.originalRequests++; });
    assert.equal((await context.request.get(`${app.url}/api/v1/editorial-references`)).status(), 401);
    assert.equal((await context.request.get(`${app.url}/api/v1/editorial-references/${references[0].id}/image`)).status(), 401);
    await login(page, 'editor'); const panel = page.getByRole('region', { name: '当前食材研究参考', exact: true });
    await expect(panel.getByText('食品身份、图片使用许可和专业匹配待逐项核对。', { exact: true })).toBeVisible();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(raw.drafts[0].content.educationText);
    await expect(page.locator('.draft-source')).toHaveCount(sourceCount);
    for (const source of raw.sources) await expect(page.locator('.draft-source').getByText(source.input.title, { exact: true })).toBeVisible();
    if (withFoodForms) {
      assert(raw.drafts[0].content.educationText.includes('净片不自动等于免洗、生食或即食'));
      assert(raw.sources.some(source => source.key === 'yixing-2024-food-processing-forms'));
      assert(!raw.sources.some(source => source.key === 'cas-zhongbai1-bulb-reference'));
    }
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const reference of references) {
        await panel.getByRole('button', { name: reference.name, exact: true }).click();
        const image = panel.getByRole('img', { name: `${reference.name}，私有研究参考`, exact: true }); await expect(image).toBeVisible();
        assert.deepEqual(await image.evaluate(element => element instanceof HTMLImageElement ? [element.naturalWidth, element.naturalHeight] : []), [reference.width, reference.height]);
        await expect(panel.getByRole('link', { name: '研究出处', exact: true })).toHaveAttribute('href', reference.sourceUrl);
        if (!reference.licenseUrl) await expect(panel.getByText('图片转载许可未取得', { exact: false })).toBeVisible();
        else await expect(panel.getByRole('link', { name: `${reference.declaredLicense}声明`, exact: true })).toHaveAttribute('href', reference.licenseUrl);
        if (reference.representation === 'source-thumbnail') await expect(panel.getByText(/来源站独立缩略图，不是已校验原件/)).toBeVisible();
        const concernsSummary = panel.getByText('研究图待核对事项', { exact: true });
        const concernsDetails = concernsSummary.locator('..');
        // Keeping the same image across viewport changes preserves <details>.
        // Do not toggle an already-open panel closed in a one-image edition.
        if (await concernsDetails.getAttribute('open') === null) await concernsSummary.click();
        await expect(concernsDetails).toHaveAttribute('open', '');
        for (const concern of reference.concerns) await expect(panel.getByText(concern, { exact: true })).toBeVisible();
        assert.equal(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await panel.screenshot({ path: join(prepared.directory, `${reference.id}-${width}.png`) }); report.views.push({ id: reference.id, width });
      }
    }
    const temporary = raw.drafts[0].content.educationText + '\n工程临时输入，未保存。'; await page.getByLabel('草稿教育说明', { exact: true }).fill(temporary);
    await panel.getByRole('button', { name: references[0].name, exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    await panel.getByRole('button', { name: '重新读取研究参考', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(temporary); report.dirtyInputPreserved = true;
    const listPattern = '**/api/v1/editorial-references'; await context.route(listPattern, route => route.fulfill({ status: 503, json: { message: '研究参考暂不可用。' } }));
    await panel.getByRole('button', { name: '重新读取研究参考', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('研究参考暂不可用'); await expect(panel.getByRole('img')).toHaveCount(0); report.listFailureRejected = true;
    await context.unroute(listPattern); await panel.getByRole('button', { name: '重新读取研究参考', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    const imagePattern = `**/api/v1/editorial-references/${references[0].id}/image`, corrupt = registry.image(references[0].id)!; corrupt[10] ^= 1;
    await context.route(imagePattern, route => route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'Content-Length': String(corrupt.length) }, body: corrupt }));
    await panel.getByRole('button', { name: '重新读取研究参考', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('摘要与候选记录不符'); await expect(panel.getByRole('img')).toHaveCount(0); report.corruptImageRejected = true;
    await context.unroute(imagePattern); await panel.getByRole('button', { name: '重新读取研究图', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    let release!: () => void; const gate = new Promise<void>(done => { release = done; }); let seen!: () => void; const observed = new Promise<void>(done => { seen = done; });
    await context.route(imagePattern, async route => { seen(); await gate; await route.fulfill({ status: 200, contentType: 'image/jpeg', body: registry.image(references[0].id)! }).catch(() => {}); });
    try {
      await panel.getByRole('button', { name: '重新读取研究参考', exact: true }).click(); await observed;
      await panel.getByRole('button', { name: '取消研究图读取', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('读取已取消'); await expect(panel.getByRole('img')).toHaveCount(0); report.cancelledReadRetired = true;
    } finally { release(); await context.unroute(imagePattern); }
    await panel.getByRole('button', { name: '重新读取研究图', exact: true }).click(); await expect(panel.getByRole('img')).toBeVisible();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(panel.getByRole('img')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.__researchUrls!.created.filter(url => !window.__researchUrls!.revoked.includes(url)).length), 0); report.hiddenCleanupVerified = true;
    await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(temporary);
    await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); }); await expect(panel.getByRole('img')).toBeVisible();
    const updated = raw.drafts[0].content.educationText + '\n本地研究图同页演练，未构成审核批准。'; await page.getByLabel('草稿教育说明', { exact: true }).fill(updated);
    await page.getByRole('button', { name: '保存内容草稿', exact: true }).click(); await expect(page.getByRole('status', { name: '内容草稿结果', exact: true })).toContainText('已保存私有草稿');
    await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.__researchUrls!.created.filter(url => !window.__researchUrls!.revoked.includes(url)).length), 0); report.logoutCleanupVerified = true;
    assert.equal((await context.request.get(`${app.url}/api/v1/editorial-references/${references[0].id}/image`)).status(), 401);
    await app.close(); report.gracefulStops++; app = undefined;
    app = await launchDemoCli(root, prepared.demoId, port, 'compiled', undefined, manifest); report.applicationStarts++;
    await login(page, 'editor'); await expect(page.getByLabel('草稿教育说明', { exact: true })).toHaveValue(updated); await expect(panel.getByRole('img')).toBeVisible(); report.saveAndRestartVerified = true;
    const readerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), reviewer = await readerContext.newPage(); await login(reviewer, 'reviewer');
    await expect(reviewer.getByLabel('草稿教育说明', { exact: true })).toHaveAttribute('readonly', ''); await expect(reviewer.getByRole('button', { name: '保存内容草稿', exact: true })).toBeDisabled();
    await expect(reviewer.getByRole('region', { name: '当前食材研究参考', exact: true }).getByRole('img')).toBeVisible(); report.reviewerReadOnlyVerified = true;
    const publicText = await (await context.request.get(`${app.url}/api/v1/public/catalog`)).text();
    for (const reference of references) assert(!publicText.includes(reference.id) && !publicText.includes(reference.sourceUrl));
    assert(!publicText.includes(JSON.stringify(updated).slice(1, -1))); assert.equal((await context.request.get(`${app.url}/api/v1/public/photos/bai-he`)).status(), 503);
    const candidates = await (await context.request.get(`${app.url}/api/v1/private-photos`)).json(); assert.equal(candidates.enabled, false); assert.equal(candidates.items.length, 0);
    assert.equal((await context.request.get(`${app.url}/api/v1/editorial/photo-publications/bai-he`)).status(), 503);
    assert.equal((await (await context.request.get(`${app.url}/api/v1/editorial/assistant/config`)).json()).enabled, false); report.publicBoundaryVerified = true;
    assert.equal(report.originalRequests, 0); assert.equal(report.views.length, references.length * 2); assert.deepEqual(report.errors, []); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown research review failure'); throw error; }
  finally {
    try { await browser?.close(); if (app) { await app.close(); report.gracefulStops++; } report.fixturesStopped = report.applicationStarts === report.gracefulStops; }
    finally {
      report.workingDatabaseUnchanged = before === (existsSync(working) ? hash(working) : null); report.manifestUnchanged = manifestBefore === hash(manifest);
      const db = new DatabaseSync(join(prepared.directory, 'editorial.sqlite'), { readOnly: true });
      try { for (const table of ['source_checks', 'professional_qualifications', 'professional_reviews', 'review_tasks', 'publication_approvals', 'publication_events', 'assistant_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0); }
      finally { db.close(); }
      report.finishedAt = new Date().toISOString(); writeFileSync(join(prepared.directory, 'research-browser-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(`Private research editor evidence: ${prepared.directory}`); assert(report.fixturesStopped && report.workingDatabaseUnchanged && report.manifestUnchanged);
    }
  }
});
