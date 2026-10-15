import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { SessionInfo } from '../../shared/contracts';

const origin = 'http://127.0.0.1:4314';
test.use({ baseURL: origin });
async function headers(context: BrowserContext) {
  const response = await context.request.get('/api/v1/auth/me'); expect(response.status()).toBe(200);
  const session: SessionInfo = await response.json(); return { Origin: origin, 'X-CSRF-Token': session.csrfToken };
}
async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill('browser-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-only-admin-password-2026');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '来源核验与发布检查', exact: true }).click();
}
test('selected source checks reject mismatched reads and malformed acknowledgements after a real committed write, then require a valid explicit read', async ({ page, context, browser }) => {
  test.setTimeout(60000);
  const author = await browser.newContext({ baseURL: origin });
  try {
    const signedIn = await author.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: 'browser-response-editor', password: 'test-only-response-editor-password-2026' } });
    expect(signedIn.status()).toBe(200);
    const title = `来源响应核验-${Date.now()}`;
    const created = await author.request.post('/api/v1/editorial/sources', { headers: await headers(author), data: { title, publisher: '仅工程测试', url: 'https://example.org/source-response-browser' } });
    expect(created.status()).toBe(201); const source = await created.json();
    await open(page); await page.getByLabel('搜索待核验来源', { exact: true }).fill(title);
    const readPath = `**/api/v1/editorial/source-checks/${source.id}/1`;
    const wrongRead = async () => page.route(readPath, async route => {
      const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, source: { ...body.source, revision: 2 } } });
    });
    await wrongRead(); await page.getByRole('button', { name: `核验${title}`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('数据格式无效'); await expect(page.getByLabel('来源核验状态', { exact: true })).toHaveCount(0);
    await page.unroute(readPath); await page.getByRole('button', { name: '刷新来源核验', exact: true }).click();
    await expect(page.getByLabel('来源核验状态', { exact: true })).toContainText('尚未核验');
    await page.getByLabel('来源核验依据类型', { exact: true }).selectOption('test-fixture');
    await page.getByLabel('来源核验依据编号', { exact: true }).fill('source-response-test-only');
    await page.getByLabel('来源复核截止UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByLabel('查找适用食材', { exact: true }).fill('黄芪'); await page.getByRole('button', { name: '加入黄芪核验范围', exact: true }).click();
    await page.getByLabel('身份依据', { exact: true }).check(); await page.getByLabel('来源核验说明', { exact: true }).fill('真实写入测试夹具后的未知回执，不能自动重交。');
    await page.getByLabel('确认已核对来源依据', { exact: true }).check();
    let writes = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/editorial/source-checks/${source.id}`)) writes++; });
    await page.route(`**/api/v1/editorial/source-checks/${source.id}`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json();
      await route.fulfill({ response, json: { ...body, latest: { ...body.latest, ingredientIds: ['jiang'] } } });
    });
    await page.getByRole('button', { name: '保存来源核验', exact: true }).click();
    await expect(page.getByRole('status', { name: '来源核验结果' })).toContainText('先重新读取核对');
    await expect(page.getByRole('button', { name: '保存来源核验', exact: true })).toBeDisabled();
    await expect(page.getByLabel('来源核验说明', { exact: true })).toHaveValue('真实写入测试夹具后的未知回执，不能自动重交。');
    await expect(page.getByLabel('来源核验状态', { exact: true })).toHaveCount(0);
    const committed = await (await context.request.get(`/api/v1/editorial/source-checks/${source.id}/1`)).json();
    expect(committed.checkVersion).toBe(1); expect(committed.latest.ingredientIds).toEqual(['huang-qi']); expect(writes).toBe(1);
    await wrongRead(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '刷新来源核验', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('数据格式无效'); await expect(page.getByRole('button', { name: '保存来源核验', exact: true })).toBeDisabled();
    await expect(page.getByLabel('来源核验说明', { exact: true })).toHaveValue('真实写入测试夹具后的未知回执，不能自动重交。'); expect(writes).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('source-response-uncertain-narrow.png'), fullPage: true });
    await page.unroute(readPath); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '刷新来源核验', exact: true }).click();
    await expect(page.getByLabel('来源核验状态', { exact: true })).toContainText('仅工程测试核验');
    await expect(page.getByLabel('来源核验说明', { exact: true })).toHaveValue('');
    await expect(page.getByText('真实写入测试夹具后的未知回执，不能自动重交。', { exact: true })).toBeVisible(); expect(writes).toBe(1);
  } finally { await author.close(); }
});

test('preflight and source pickers reject malformed successful data, never display readiness for another ingredient, and recover by deliberate reads', async ({ page }) => {
  await page.route('**/api/v1/editorial/sources?**', async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, total: '0' } });
  });
  await open(page);
  const sourcePanel = page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name: '固定来源核验', exact: true }) });
  await expect(sourcePanel.getByRole('alert')).toContainText('数据格式无效'); await expect(sourcePanel.getByRole('button', { name: /^核验/ })).toHaveCount(0);
  await page.unroute('**/api/v1/editorial/sources?**'); await page.getByRole('button', { name: '重试待核验来源', exact: true }).click();
  await expect(sourcePanel.getByRole('alert')).toHaveCount(0);
  await page.route('**/api/v1/editorial/publication-preflight/huang-qi', async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, ingredientId: 'jiang' } });
  });
  await page.getByLabel('搜索发布检查食材', { exact: true }).fill('黄芪'); await page.getByRole('button', { name: '检查黄芪发布资料', exact: true }).click();
  const preflightPanel = page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name: '发布前资料检查', exact: true }) });
  await expect(preflightPanel.getByRole('alert')).toContainText('数据格式无效'); await expect(page.getByLabel('发布前检查结果', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/editorial/publication-preflight/huang-qi'); await page.getByRole('button', { name: '刷新发布前检查', exact: true }).click();
  await expect(page.getByLabel('发布前检查结果', { exact: true })).toContainText('黄芪'); await expect(preflightPanel.getByRole('alert')).toHaveCount(0);
});
