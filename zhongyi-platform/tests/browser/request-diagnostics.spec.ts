import { test, expect } from '@playwright/test';
import { browserToken } from '../../playwright.config';

const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

test('real unauthorized login shows its response request ID, fits a narrow screen and recovers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByLabel('本地编辑密钥').fill('wrong-fixture-key');
  const failed = page.waitForResponse((response) => response.url().endsWith('/api/v1/summary') && response.status() === 401);
  await page.getByRole('button', { name: '进入工作台' }).click();
  const response = await failed; const id = response.headers()['x-request-id']; expect(id).toMatch(uuidV4);
  await expect(page.getByRole('alert')).toContainText(`请求编号：${id}`);
  await expect(page.getByRole('alert')).toContainText('编辑密钥');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('request-id-login-mobile.png'), fullPage: true });
  await page.getByLabel('本地编辑密钥').fill(browserToken); await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('injected catalog HTTP failure shows a valid server ID, rejects arbitrary header text and retries without a write', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  const search = page.getByRole('textbox', { name: '搜索食材' }); await search.fill('黄芪');
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
  let id = ''; let writes = 0;
  page.on('request', (request) => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes += 1; });
  await page.route('**/api/v1/ingredients?**', async (route) => {
    // Read the real service's ID. Only the status/body delivered to the browser
    // are fault-injected; this is not a claim of a server-side 503 or outage.
    const response = await route.fetch(); id = response.headers()['x-request-id'];
    await route.fulfill({ response, status: 503, contentType: 'application/json', body: '{"message":"测试读取故障，请稍后重试。"}' });
  });
  await search.fill('姜'); await expect(page.getByRole('alert')).toContainText('测试读取故障');
  expect(id).toMatch(uuidV4); await expect(page.getByRole('alert')).toContainText(`请求编号：${id}`);
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '没有找到相关食材', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('request-id-catalog-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/ingredients?**');
  await page.route('**/api/v1/ingredients?**', (route) => route.fulfill({ status: 503,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'private-health-header-never-render' }, body: '{"message":"测试读取故障，请稍后重试。"}' }));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/^测试读取故障，请稍后重试。\s*重试$/);
  await expect(page.getByRole('alert')).not.toContainText('private-health-header');
  await expect(page.getByRole('alert')).not.toContainText('请求编号');
  await page.unroute('**/api/v1/ingredients?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0); expect(writes).toBe(0);
});
