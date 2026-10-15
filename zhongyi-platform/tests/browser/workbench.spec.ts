import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserToken } from '../../playwright.config';
import type { IngredientDetail } from '../../shared/contracts';

async function connectWorkbench(page: Page) {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
}

test('audit initial read failure is unknown, not an empty history or zero statistics; deliberate retry is read-only', async ({ page }) => {
  await page.route('**/api/v1/events', (route) => route.abort());
  await connectWorkbench(page);
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑记录暂不可用', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还没有编辑记录', exact: true })).toHaveCount(0);
  await expect(page.locator('.events-panel table')).toHaveCount(0);
  await expect(page.locator('.stat strong').nth(0)).toHaveText('—');
  await expect(page.locator('.stat strong').nth(1)).toHaveText('—');
  await expect(page.locator('.stat strong').nth(2)).toHaveText('—');
  let writes = 0; page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.unroute('**/api/v1/events'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.stat strong').nth(0)).toHaveText('106');
  await expect(page.getByRole('heading', { name: '编辑记录暂不可用', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('audit refresh failure hides old records and statistics while retaining the unsaved ingredient note', async ({ page, context }) => {
  await connectWorkbench(page);
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '编辑备注', exact: true });
  const saved = `记录刷新验收-${randomUUID()}`;
  await editor.fill(saved); await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
  await expect(page.getByRole('button', { name: '刷新内容' })).toBeEnabled();
  const before: IngredientDetail = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers: { Authorization: `Bearer ${browserToken}` } })).json();
  await editor.fill(`${saved}-未保存`);
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.locator('.events-panel tbody tr').first()).toBeVisible();
  let writes = 0; page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/events', (route) => route.abort());
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(page.locator('.events-panel table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '编辑记录暂不可用', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还没有编辑记录', exact: true })).toHaveCount(0);
  await expect(page.locator('.stat strong').nth(2)).toHaveText('—');
  await expect(page.locator('.snapshot')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('audit-refresh-failure-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/events'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.events-panel tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: '食材资料' }).click();
  await expect(editor).toHaveValue(`${saved}-未保存`);
  const after: IngredientDetail = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers: { Authorization: `Bearer ${browserToken}` } })).json();
  expect(after.note).toEqual(before.note); expect(writes).toBe(0);
});

test('audit pending refresh hides the previous history and snapshot until the held real read finishes', async ({ page }) => {
  await connectWorkbench(page);
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑备注', exact: true }).fill(`记录加载验收-${randomUUID()}`);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
  await expect(page.getByRole('button', { name: '刷新内容' })).toBeEnabled();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.locator('.events-panel tbody tr').first()).toBeVisible();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let continued!: () => void; const handled = new Promise<void>((resolve) => { continued = resolve; });
  let reads = 0, writes = 0;
  page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/events', async (route) => { reads += 1; await gate; try { await route.continue(); } finally { continued(); } });
  try {
    await page.getByRole('button', { name: '刷新内容' }).click();
    await expect.poll(() => reads).toBe(1);
    await expect(page.locator('.events-panel').getByRole('status')).toHaveText('正在读取编辑记录…');
    await expect(page.locator('.events-panel table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '还没有编辑记录', exact: true })).toHaveCount(0);
    await expect(page.locator('.stat strong').nth(0)).toHaveText('—');
    await expect(page.locator('.stat strong').nth(2)).toHaveText('—');
    await expect(page.locator('.snapshot')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('audit-loading-mobile.png'), fullPage: true });
    release(); await expect(page.locator('.events-panel tbody tr').first()).toBeVisible();
    await expect(page.locator('.events-panel').getByRole('status')).toHaveCount(0);
    await expect(page.locator('.stat strong').nth(0)).toHaveText('106');
    expect(reads).toBe(1); expect(writes).toBe(0);
  } finally { release(); await handled; await page.unroute('**/api/v1/events'); }
});

test('connect, search, edit through HTTP, reload, conflict between tabs, clear and view history', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('本地编辑密钥').fill('wrong');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('alert')).toContainText('编辑密钥');
  await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '编辑备注', exact: true });
  await expect(editor).toBeVisible();
  const note = `浏览器实测备注-${Date.now()}`;
  await editor.fill(note);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
  await page.reload();
  await expect(page.getByLabel('本地编辑密钥')).toBeVisible();
  await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('textbox', { name: '搜索食材' }).fill('huang qi');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(editor).toHaveValue(note);

  const second = await context.newPage();
  await second.goto('/'); await second.getByLabel('本地编辑密钥').fill(browserToken); await second.getByRole('button', { name: '进入工作台' }).click();
  await second.getByRole('textbox', { name: '搜索食材' }).fill('黄芪'); await second.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const secondEditor = second.getByRole('textbox', { name: '编辑备注', exact: true }); await expect(secondEditor).toHaveValue(note);
  await editor.fill(`${note}-窗口一`); await page.getByRole('button', { name: '保存备注', exact: true }).click(); await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
  await secondEditor.fill(`${note}-窗口二`);
  const conflictResponse = second.waitForResponse((response) => response.url().endsWith('/huang-qi/note') && response.status() === 409);
  await second.getByRole('button', { name: '保存备注', exact: true }).click();
  const conflictId = (await conflictResponse).headers()['x-request-id'];
  expect(conflictId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  await expect(second.getByRole('status', { name: '备注保存结果' })).toContainText(`请求编号：${conflictId}`);
  await expect(second.getByRole('status', { name: '备注保存结果' })).toContainText('另一窗口'); await expect(secondEditor).toHaveValue(`${note}-窗口二`);
  await second.setViewportSize({ width: 390, height: 844 });
  expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await second.screenshot({ path: test.info().outputPath('request-id-conflict-mobile.png'), fullPage: true });
  second.once('dialog', (dialog) => dialog.accept()); await second.getByRole('button', { name: '重新加载', exact: true }).click(); await expect(secondEditor).toHaveValue(`${note}-窗口一`);
  const cleared = second.waitForResponse(response => response.url().endsWith('/api/v1/ingredients/huang-qi/note') && response.request().method() === 'PUT');
  await second.getByRole('button', { name: '清空备注', exact: true }).click(); expect((await cleared).status()).toBe(200); await expect(second.getByRole('status', { name: '备注保存结果' })).toContainText('备注已清空'); await expect(secondEditor).toHaveValue('');
  await second.getByRole('button', { name: '编辑记录', exact: true }).click(); await expect(second.getByRole('cell', { name: '清空备注', exact: true }).first()).toBeVisible();
  await second.close();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('workbench-desktop.png'), fullPage: true });
});

test('empty results, network failure and recovery; narrow screen stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByLabel('本地编辑密钥').fill(browserToken); await page.getByRole('button', { name: '进入工作台' }).click();
  const search = page.getByRole('textbox', { name: '搜索食材' }); await search.fill('没有这个食材');
  await expect(page.getByRole('heading', { name: '没有找到相关食材' })).toBeVisible();
  await page.route('**/api/v1/ingredients?**', (route) => route.abort()); await search.fill('姜');
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await page.unroute('**/api/v1/ingredients?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true }).click(); await expect(page.getByRole('textbox', { name: '编辑备注', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('workbench-mobile.png'), fullPage: true });
});

test('failed search never presents old rows or an empty result as the new query; retry recovers', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  const search = page.getByRole('textbox', { name: '搜索食材' }); await search.fill('黄芪');
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
  await page.route('**/api/v1/ingredients?**', (route) => route.abort()); await search.fill('姜');
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '没有找到相关食材', exact: true })).toHaveCount(0);
  await expect(page.getByText('结果数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('workbench-search-failure-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/ingredients?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toBeVisible();
  await expect(search).toHaveValue('姜');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('detail failure can return to an idle directory or retry the same ingredient without a write', async ({ page, context }) => {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  const before = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers: { Authorization: `Bearer ${browserToken}` } })).json();
  let noteWrites = 0; page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/note')) noteWrites += 1; });
  await page.route('**/api/v1/ingredients/huang-qi', (route) => route.abort());
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(page.locator('aside.detail').getByRole('alert')).toContainText('无法连接');
  await page.getByRole('button', { name: '返回目录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从一条资料开始', exact: true })).toBeVisible();
  await expect(page.locator('aside.detail').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(page.locator('aside.detail').getByRole('alert')).toContainText('无法连接');
  await page.unroute('**/api/v1/ingredients/huang-qi');
  await page.getByRole('button', { name: '重试读取详情', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '编辑备注', exact: true })).toHaveValue(before.note.text);
  const after = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers: { Authorization: `Bearer ${browserToken}` } })).json();
  expect(after.note).toEqual(before.note); expect(noteWrites).toBe(0);
});
