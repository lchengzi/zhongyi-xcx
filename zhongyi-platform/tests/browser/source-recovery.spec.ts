import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import type { ManagedSource, SessionInfo } from '../../shared/contracts';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function openWorkflow(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill('browser-source-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-only-source-admin-password-2026');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await expect(page.getByLabel('搜索待编辑食材')).toBeVisible();
}
async function createSource(context: BrowserContext, tag: string): Promise<ManagedSource> {
  const session: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json();
  const response = await context.request.post('/api/v1/editorial/sources', {
    headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': session.csrfToken },
    data: { title: `来源恢复-${tag}-${Date.now()}`, publisher: '独立工程测试机构', url: `https://example.org/source-recovery/${tag}` }
  });
  expect(response.status()).toBe(201); return response.json();
}
async function chooseIngredient(page: Page, name: string) {
  await page.getByLabel('搜索待编辑食材').fill(name);
  await page.getByRole('button', { name: `编辑${name}内容`, exact: true }).click();
  await expect(page.getByLabel('草稿教育说明')).toBeVisible();
}

test('source registry failure hides previous results and preserves unsaved editor input across retry', async ({ page, context }) => {
  await openWorkflow(page); const source = await createSource(context, 'registry');
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  const search = page.getByLabel('搜索来源库'); await search.fill(source.title);
  const row = page.locator('button.workflow-item').filter({ hasText: source.title }); await row.click();
  const title = page.getByLabel('来源标题', { exact: true }); await title.fill(`${source.title}-保留输入`);
  await page.route('**/api/v1/editorial/sources?**', (route) => route.abort());
  await search.fill('本次查询读取失败');
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(row).toHaveCount(0);
  await expect(page.getByText('还没有匹配来源。来源录入不会自动核验网页内容。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('来源数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页来源', exact: true })).toBeDisabled();
  await expect(title).toHaveValue(`${source.title}-保留输入`);
  // Failed reload must also leave the selected revision and the editor intact.
  await page.route(`**/api/v1/editorial/sources/${source.id}`, (route) => route.abort());
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载来源', exact: true }).click();
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('无法连接');
  await expect(title).toHaveValue(`${source.title}-保留输入`);
  await expect(page.getByRole('heading', { name: '来源修订 · 版本 1', exact: true })).toBeVisible();
  await page.unroute(`**/api/v1/editorial/sources/${source.id}`);
  await page.unroute('**/api/v1/editorial/sources?**');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('还没有匹配来源。来源录入不会自动核验网页内容。', { exact: true })).toBeVisible();
  await expect(title).toHaveValue(`${source.title}-保留输入`);
  await search.fill(source.title); await expect(row).toBeVisible();
  await expect(title).toHaveValue(`${source.title}-保留输入`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('source-registry-recovery-mobile.png'), fullPage: true });
  const stored = await (await context.request.get(`/api/v1/editorial/sources/${source.id}`)).json();
  expect(stored.title).toBe(source.title); expect(stored.revision).toBe(1);
});

test('failed source picker never offers stale references and a successful retry persists the exact chosen version', async ({ page, context }) => {
  await openWorkflow(page);
  const before = await (await context.request.get('/api/v1/public/catalog')).json();
  const first = await createSource(context, 'picker-first'); const second = await createSource(context, 'picker-second');
  await chooseIngredient(page, '肉豆蔻');
  await page.getByLabel('草稿教育说明').fill('引用恢复工程测试，不是正式食养内容。');
  const search = page.getByLabel('搜索可引用来源'); await search.fill(first.title);
  await expect(page.getByRole('button', { name: '引用此来源', exact: true })).toHaveCount(1);
  await page.route('**/api/v1/editorial/sources?**', (route) => route.abort()); await search.fill(second.title);
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(page.getByRole('button', { name: '引用此来源', exact: true })).toHaveCount(0);
  await expect(page.getByText('没有匹配来源。可到“来源登记”创建记录；登记不代表已核验。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('来源数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一批来源', exact: true })).toBeDisabled();
  await expect(page.getByText('固定版本来源', { exact: false })).toContainText('0 / 10');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue('引用恢复工程测试，不是正式食养内容。');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('source-picker-failure-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/editorial/sources?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.source-choice')).toContainText(second.title);
  await page.getByRole('button', { name: '引用此来源', exact: true }).click();
  await page.getByLabel(`${second.title}的原文定位`).fill('工程测试页2');
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  const stored = await (await context.request.get('/api/v1/editorial/ingredients/rou-dou-kou')).json();
  expect(stored.draft.content.sourceRefs).toEqual([{ id: second.id, revision: second.revision, locator: '工程测试页2' }]);
  expect(stored.draft.professionalReviewState).toBe('pending'); expect(stored.draft.publicationEnabled).toBe(false);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(before);
});

test('content lookup failure hides old ingredient results while keeping the opened unsaved draft', async ({ page, context }) => {
  await openWorkflow(page); await chooseIngredient(page, '桑叶');
  const input = page.getByLabel('草稿教育说明'); await input.fill('搜索失败也须保留的未保存工程输入');
  const search = page.getByLabel('搜索待编辑食材');
  await page.route('**/api/v1/ingredients?**', (route) => route.abort()); await search.fill('本次无有效结果');
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(page.getByRole('button', { name: '编辑桑叶内容', exact: true })).toHaveCount(0);
  await expect(page.getByText('没有匹配食材。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('条目数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一批条目', exact: true })).toBeDisabled();
  await expect(input).toHaveValue('搜索失败也须保留的未保存工程输入');
  await page.unroute('**/api/v1/ingredients?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('没有匹配食材。', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('搜索失败也须保留的未保存工程输入');
  await search.fill('桑叶'); await expect(page.getByRole('button', { name: '编辑桑叶内容', exact: true })).toBeVisible();
  await expect(input).toHaveValue('搜索失败也须保留的未保存工程输入');
  expect((await (await context.request.get('/api/v1/editorial/ingredients/sang-ye')).json()).draft).toBeNull();
});

test('committed source creation awaiting its response is submitted once and blocks leaving', async ({ page, context }) => {
  await openWorkflow(page); await page.getByRole('button', { name: '来源登记', exact: true }).click();
  const title = `来源单次提交-${Date.now()}`;
  await page.getByLabel('来源标题', { exact: true }).fill(title);
  await page.getByLabel('来源发布机构').fill('独立工程测试机构');
  await page.getByLabel('来源原始网址').fill('https://example.org/source-once');
  let writes = 0; let release!: () => void; let observed!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const committed = new Promise<void>((resolve) => { observed = resolve; });
  await page.route('**/api/v1/editorial/sources', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    writes++; const response = await route.fetch(); expect(response.status()).toBe(201); observed();
    await gate; await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '保存来源', exact: true }).click(); await committed;
    await expect(page.getByRole('button', { name: '来源登记', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '退出工作台' })).toBeDisabled();
    const attempted = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/editorial/sources'), { timeout: 1000 }).catch(() => null);
    await page.locator('form.workflow-form').evaluate((form: HTMLFormElement) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(await attempted).toBeNull(); expect(writes).toBe(1);
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  } finally { release(); }
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存');
  const records = await (await context.request.get(`/api/v1/editorial/sources?q=${encodeURIComponent(title)}`)).json();
  expect(records.items).toHaveLength(1); expect(records.items[0].title).toBe(title); expect(records.items[0].revision).toBe(1);
});
