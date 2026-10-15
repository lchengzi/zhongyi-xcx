import { test, expect, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserToken } from '../../playwright.config';
import type { EditorialNote, IngredientDetail } from '../../shared/contracts';

async function connect(page: Page) {
  await page.goto('/');
  await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
}

test('unanswered catalog read leaves loading with an explicit timeout and recovers by one deliberate retry', async ({ page }) => {
  test.setTimeout(45000);
  await connect(page);
  const held: Route[] = [];
  await page.route('**/api/v1/ingredients?**', (route) => { held.push(route); });
  try {
    await page.getByRole('textbox', { name: '搜索食材' }).fill('姜');
    await expect(page.getByRole('alert')).toContainText('读取超时', { timeout: 22000 });
    await expect(page.getByText('结果数量暂不可用', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '没有找到相关食材', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    expect(held).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('request-read-timeout-mobile.png'), fullPage: true });
  } finally {
    await page.unroute('**/api/v1/ingredients?**');
    for (const route of held) await route.abort().catch(() => {});
  }
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('committed note with a withheld response reports uncertainty, retains input and never repeats the write', async ({ page, context }) => {
  test.setTimeout(45000);
  await connect(page);
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '编辑备注', exact: true });
  await expect(editor).toBeVisible();
  const headers = { Authorization: `Bearer ${browserToken}` };
  const before = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json() as IngredientDetail;
  const text = `测试夹具的响应丢失-${randomUUID()}`;
  let resolveCommit!: (value: EditorialNote) => void;
  let rejectCommit!: (reason: unknown) => void;
  const committed = new Promise<EditorialNote>((resolve, reject) => { resolveCommit = resolve; rejectCommit = reject; });
  const held: Route[] = [];
  let writes = 0;
  page.on('request', (value) => { if (value.method() === 'PUT' && value.url().endsWith('/huang-qi/note')) writes += 1; });
  await page.route('**/api/v1/ingredients/huang-qi/note', async (route) => {
    held.push(route);
    try {
      // Actually commits through HTTP and SQL. Only the response to this browser
      // is withheld; aborting its wait does not undo the committed revision.
      const response = await route.fetch({ timeout: 10000 });
      expect(response.ok()).toBe(true);
      resolveCommit(await response.json() as EditorialNote);
    } catch (reason) { rejectCommit(reason); }
  });
  try {
    await editor.fill(text);
    await page.getByRole('button', { name: '保存备注', exact: true }).click();
    const saved = await committed;
    expect(saved.text).toBe(text); expect(saved.revision).toBe(before.note.revision + 1);
    await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('无法确认提交结果', { timeout: 22000 });
    await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('先重新读取核对');
    await expect(editor).toHaveValue(text);
    await expect(page.getByRole('button', { name: '保存备注', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '清空备注', exact: true })).toBeDisabled();
    const after = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json() as IngredientDetail;
    expect(after.note).toEqual(saved); expect(writes).toBe(1); expect(held).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('request-write-uncertain-mobile.png'), fullPage: true });
  } finally {
    await page.unroute('**/api/v1/ingredients/huang-qi/note');
    for (const route of held) await route.abort().catch(() => {});
  }
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已加载最新修订');
  await expect(editor).toHaveValue(text);
  await expect(page.getByRole('heading', { name: `编辑备注 修订 ${before.note.revision + 1}` })).toBeVisible();
  expect(writes).toBe(1);
});
