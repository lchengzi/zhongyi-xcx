import { test, expect, type Page } from '@playwright/test';
import { browserToken } from '../../playwright.config';
import { parseAuditEventList, parseCatalogPage, parsePlatformSummary, parseWorkflowEventList } from '../../shared/workbench-response';
import { fixturePassword } from '../migration-fixture';

async function connect(page: Page) {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新内容' })).toBeEnabled();
}

test('malformed successful overview reads hide untrusted rows, counts and history while preserving the unsent note', async ({ page, context }) => {
  await connect(page);
  await page.getByLabel('搜索食材', { exact: true }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const editor = page.getByLabel('编辑备注', { exact: true });
  await editor.fill('未保存：读取失败应保留此输入。');
  const headers = { Authorization: `Bearer ${browserToken}` };
  const before: unknown = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json();
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  const faults: { path: string; alter: (value: unknown) => unknown }[] = [
    { path: '**/api/v1/ingredients?**', alter: value => ({ ...parseCatalogPage(value, { page: 1, pageSize: 12, query: '黄芪' }), page: 2 }) },
    { path: '**/api/v1/ingredients?**', alter: value => ({ ...parseCatalogPage(value, { page: 1, pageSize: 12, query: '黄芪' }), items: [] }) },
    { path: '**/api/v1/summary', alter: value => ({ ...parsePlatformSummary(value), eventCount: '0' }) },
    { path: '**/api/v1/summary', alter: value => ({ ...parsePlatformSummary(value), publicationEnabled: true }) },
    { path: '**/api/v1/events', alter: value => ({ ...parseAuditEventList(value), privateEvidence: 'PRIVATE_RESPONSE_MUST_NOT_RENDER' }) }
  ];
  for (const fault of faults) {
    await page.route(fault.path, async route => {
      const response = await route.fetch(); const body: unknown = await response.json();
      await route.fulfill({ response, json: fault.alter(body) });
    });
    await page.getByRole('button', { name: '刷新内容' }).click();
    await expect(page.getByRole('alert')).toContainText('数据格式无效');
    await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '没有找到相关食材', exact: true })).toHaveCount(0);
    for (const index of [0, 1, 2]) await expect(page.locator('.stat strong').nth(index)).toHaveText('—');
    await expect(page.locator('.snapshot')).toHaveCount(0); await expect(editor).toHaveValue('未保存：读取失败应保留此输入。');
    await page.getByRole('button', { name: '编辑记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '编辑记录暂不可用', exact: true })).toBeVisible();
    await expect(page.locator('.events-panel table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '还没有编辑记录', exact: true })).toHaveCount(0);
    await expect(page.getByText('PRIVATE_RESPONSE_MUST_NOT_RENDER', { exact: true })).toHaveCount(0);
    await page.unroute(fault.path); await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('.stat strong').nth(0)).toHaveText('106');
    await page.getByRole('button', { name: '食材资料' }).click();
    await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible(); await expect(editor).toHaveValue('未保存：读取失败应保留此输入。');
  }
  expect(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json()).toEqual(before);
  expect(writes).toBe(0);
});

test('a held old catalog response cannot replace a newer search or resurrect its previous batch', async ({ page }) => {
  await connect(page); const search = page.getByLabel('搜索食材', { exact: true });
  await search.fill('黄芪'); await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  let handled = () => {}; const finished = new Promise<void>(resolve => { handled = resolve; });
  let reads = 0, writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/ingredients?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query !== '姜') { await route.continue(); return; }
    reads += 1;
    try { const response = await route.fetch(); await gate; await route.fulfill({ response }); }
    finally { handled(); }
  });
  try {
    await search.fill('姜'); await expect.poll(() => reads).toBe(1);
    await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toHaveCount(0);
    await expect(page.getByText('正在读取内容库…', { exact: true })).toBeVisible();
    await search.fill('黄芪'); await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
    release(); await finished;
    await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible(); expect(writes).toBe(0);
  } finally { release(); await finished; await page.unroute('**/api/v1/ingredients?**'); }
});

test('malformed successful collaboration history remains unknown and deliberate reread never writes', async ({ page, context }, info) => {
  const origin = 'http://127.0.0.1:4315';
  await page.goto(origin); await page.getByLabel('用户名', { exact: true }).fill('publication-ui-editor');
  await page.getByLabel('密码', { exact: true }).fill(fixturePassword); await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  const before: unknown = await (await context.request.get(`${origin}/api/v1/editorial/events`)).json();
  const valid = parseWorkflowEventList(before); expect(valid.items.length).toBeGreaterThan(0);
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/editorial/events', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { items: [{ ...valid.items[0], ingredientId: null, sourceId: null }] } });
  });
  await page.getByRole('button', { name: '协作记录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await expect(page.getByRole('table', { name: '内容协作记录', exact: true })).toHaveCount(0);
  await expect(page.getByText('尚无协作记录。', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('workflow-response-invalid-narrow', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.unroute('**/api/v1/editorial/events'); await page.getByRole('button', { name: '刷新协作记录', exact: true }).click();
  await expect(page.getByRole('table', { name: '内容协作记录', exact: true })).toBeVisible();
  expect(await (await context.request.get(`${origin}/api/v1/editorial/events`)).json()).toEqual(before); expect(writes).toBe(0);
});
