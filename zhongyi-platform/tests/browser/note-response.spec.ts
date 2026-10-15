import { test, expect, type Page } from '@playwright/test';
import { browserToken } from '../../playwright.config';
import { parseEditorialNote, parseIngredientDetail } from '../../shared/note-response';

const headers = { Authorization: `Bearer ${browserToken}` };
async function connect(page: Page) {
  await page.goto('/'); await page.getByLabel('本地编辑密钥').fill(browserToken);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByLabel('搜索食材', { exact: true }).fill('黄芪');
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
}
const editor = (page: Page) => page.getByLabel('编辑备注', { exact: true });
const save = (page: Page) => page.getByRole('button', { name: '保存备注', exact: true });
const clear = (page: Page) => page.getByRole('button', { name: '清空备注', exact: true });
const feedback = (page: Page) => page.getByRole('status', { name: '备注保存结果' });
async function reload(page: Page, accept = true) {
  page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
}

test('initial note detail rejects another ingredient, mismatched notes and extra private data; explicit retry remains read-only', async ({ page, context }) => {
  await connect(page);
  const response: unknown = await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json();
  const detail = parseIngredientDetail(response, 'huang-qi');
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  const faults = [{ ...detail, ingredient: { ...detail.ingredient, id: 'jiang' } }, { ...detail, note: { ...detail.note, ingredientId: 'jiang' } },
    { ...detail, ingredient: { ...detail.ingredient, privateEvidence: 'PRIVATE_NOTE_RESPONSE' } }];
  for (const fault of faults) {
    await page.route('**/api/v1/ingredients/huang-qi', route => route.fulfill({ status: 200, json: fault }));
    await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
    await expect(page.locator('aside.detail').getByRole('alert')).toContainText('数据格式无效');
    await expect(editor(page)).toHaveCount(0); await expect(page.getByText('PRIVATE_NOTE_RESPONSE', { exact: true })).toHaveCount(0);
    await page.unroute('**/api/v1/ingredients/huang-qi'); await page.getByRole('button', { name: '重试读取详情', exact: true }).click();
    await expect(editor(page)).toHaveValue(detail.note.text);
    await page.getByRole('button', { name: '编辑记录', exact: true }).click();
    await page.getByRole('button', { name: '食材资料' }).click(); await expect(editor(page)).toHaveValue(detail.note.text);
    // The editor remains mounted across sections; select the error state again
    // through a different catalog target, not by overwriting its React state.
    await page.getByLabel('搜索食材', { exact: true }).fill('姜');
    await page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await page.getByLabel('搜索食材', { exact: true }).fill('黄芪');
    await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
  }
  expect(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json()).toEqual(response); expect(writes).toBe(0);
});

test('a committed malformed save keeps its original input and baseline, gates duplicate clicks and only a valid explicit reread unlocks', async ({ page, context }, info) => {
  await connect(page); await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  const before = parseIngredientDetail(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json(), 'huang-qi');
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT') writes += 1; });
  await page.route('**/api/v1/ingredients/huang-qi/note', async route => {
    const response = await route.fetch(); const note = parseEditorialNote(await response.json(), 'huang-qi');
    await route.fulfill({ response, json: { ...note, revision: note.revision + 1 } });
  });
  const input = '  实际保存但回执损坏：仅工程测试  ';
  await editor(page).fill(input);
  await save(page).evaluate(button => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await expect(feedback(page)).toContainText('无法确认提交结果'); await expect(editor(page)).toHaveValue(input);
  await expect(save(page)).toBeDisabled(); await expect(clear(page)).toBeDisabled();
  await expect(page.getByRole('heading', { name: `编辑备注 修订 ${before.note.revision}` })).toBeVisible();
  const committed = parseIngredientDetail(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json(), 'huang-qi');
  expect(committed.note.text).toBe(input.trim()); expect(committed.note.revision).toBe(before.note.revision + 1); expect(writes).toBe(1);
  await page.unroute('**/api/v1/ingredients/huang-qi/note');
  await editor(page).fill(`${input}-保留的新输入`);
  await page.getByRole('button', { name: '刷新内容' }).click(); await expect(page.getByRole('button', { name: '刷新内容' })).toBeEnabled();
  await expect(save(page)).toBeDisabled(); await reload(page, false); await expect(editor(page)).toHaveValue(`${input}-保留的新输入`);
  await page.route('**/api/v1/ingredients/huang-qi', route => route.fulfill({ status: 200, json: { ...committed, note: { ...committed.note, ingredientId: 'jiang' } } }));
  await reload(page); await expect(feedback(page)).toContainText('数据格式无效'); await expect(save(page)).toBeDisabled();
  await expect(editor(page)).toHaveValue(`${input}-保留的新输入`);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('note-response-uncertain-narrow', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.unroute('**/api/v1/ingredients/huang-qi');
  const independent = await context.request.put('/api/v1/ingredients/huang-qi/note', { headers, data: { text: '另一次实际请求的新修订', expectedRevision: committed.note.revision } });
  expect(independent.ok()).toBe(true);
  await reload(page); await expect(editor(page)).toHaveValue('另一次实际请求的新修订');
  await expect(feedback(page)).toContainText('不证明先前操作归属');
  await editor(page).fill('核对后的另一次手动保存'); await expect(save(page)).toBeEnabled(); await save(page).click();
  await expect(feedback(page)).toContainText('已保存'); expect(writes).toBe(2);
});

test('an actually committed clear with a malformed acknowledgement never clears the local input until a confirmed valid read', async ({ page, context }) => {
  await connect(page); await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await editor(page).fill('清空前保留的工程备注');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/v1/ingredients/huang-qi/note') && response.request().method() === 'PUT');
  await save(page).click(); expect((await saved).status()).toBe(200); await expect(feedback(page)).toContainText('已保存');
  const before = parseIngredientDetail(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json(), 'huang-qi');
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT') writes += 1; });
  await page.route('**/api/v1/ingredients/huang-qi/note', async route => {
    const response = await route.fetch(); const note = parseEditorialNote(await response.json(), 'huang-qi');
    await route.fulfill({ response, json: { ...note, text: 'not the clear intent' } });
  });
  await clear(page).click(); await expect(feedback(page)).toContainText('无法确认提交结果');
  await expect(editor(page)).toHaveValue(before.note.text); await expect(clear(page)).toBeDisabled(); await expect(save(page)).toBeDisabled();
  const actual = parseIngredientDetail(await (await context.request.get('/api/v1/ingredients/huang-qi', { headers })).json(), 'huang-qi');
  expect(actual.note.text).toBe(''); expect(actual.note.revision).toBe(before.note.revision + 1);
  await page.unroute('**/api/v1/ingredients/huang-qi/note');
  await page.route('**/api/v1/ingredients/huang-qi', route => route.abort());
  await reload(page); await expect(feedback(page)).toContainText('无法连接'); await expect(editor(page)).toHaveValue(before.note.text); await expect(clear(page)).toBeDisabled();
  await page.unroute('**/api/v1/ingredients/huang-qi'); await reload(page);
  await expect(editor(page)).toHaveValue(''); await expect(feedback(page)).toContainText('已加载最新修订');
  await expect(save(page)).toBeDisabled(); await expect(clear(page)).toBeDisabled(); expect(writes).toBe(1);
});

test('switching away from a held real detail read cancels ownership and late data cannot replace the new ingredient', async ({ page }) => {
  await connect(page);
  let release = () => {}, handled = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { handled = resolve; }); let reads = 0, writes = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/ingredients/huang-qi', async route => {
    reads += 1;
    try { const response = await route.fetch(); await gate; await route.fulfill({ response }); } finally { handled(); }
  });
  try {
    await page.getByRole('button', { name: '查看黄芪', exact: true }).click(); await expect.poll(() => reads).toBe(1);
    await expect(page.getByText('正在读取食材详情…', { exact: true })).toBeVisible();
    await page.getByLabel('搜索食材', { exact: true }).fill('姜'); await page.getByRole('button', { name: '查看姜（生姜、干姜）', exact: true }).click();
    await expect(page.locator('aside.detail h2')).toHaveText('姜（生姜、干姜）'); await expect(editor(page)).toBeVisible();
    release(); await finished; await expect(page.locator('aside.detail h2')).toHaveText('姜（生姜、干姜）'); expect(writes).toBe(0);
  } finally { release(); await finished; await page.unroute('**/api/v1/ingredients/huang-qi'); }
});
