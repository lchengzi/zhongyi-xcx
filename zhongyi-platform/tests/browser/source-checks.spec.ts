import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { SessionInfo } from '../../shared/contracts';

const origin = 'http://127.0.0.1:4312';
test.use({ baseURL: origin });
async function login(page: Page, username: string, password: string) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
}
async function headers(context: BrowserContext) {
  const response = await context.request.get('/api/v1/auth/me'); expect(response.status()).toBe(200);
  const info: SessionInfo = await response.json(); return { Origin: origin, 'X-CSRF-Token': info.csrfToken };
}
async function panel(page: Page, title: string) {
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '来源核验与发布检查', exact: true }).click();
  await page.getByLabel('搜索待核验来源', { exact: true }).fill(title);
  await page.getByRole('button', { name: `核验${title}`, exact: true }).click();
  await expect(page.getByLabel('来源核验状态', { exact: true })).toBeVisible();
}

test('source-check UI preserves failed input, persists fixture scope and revocation, and never publishes; editors remain read-only', async ({ page, context, browser }) => {
  test.setTimeout(60000);
  const publicBefore = await (await context.request.get('/api/v1/public/catalog')).json();
  await login(page, 'browser-admin', 'test-only-admin-password-2026');
  const adminHeaders = await headers(context); const suffix = Date.now();
  const username = `source-author-${suffix}`; const password = 'test-only-source-password-2026';
  const created = await context.request.post('/api/v1/users', { headers: adminHeaders, data: { username, password, role: 'editor' } });
  expect(created.status()).toBe(201);
  const author = await browser.newContext({ baseURL: origin });
  try {
    const editor = await author.newPage(); await login(editor, username, password);
    const authorHeaders = await headers(author); const title = `来源核验浏览器工程测试-${suffix}`;
    const sourceResponse = await author.request.post('/api/v1/editorial/sources', { headers: authorHeaders, data: { title, publisher: '工程测试，非官方核验', url: `https://example.org/source-check-browser-${suffix}` } });
    expect(sourceResponse.status()).toBe(201); const source = await sourceResponse.json();
    const draft = await author.request.put('/api/v1/editorial/ingredients/lian-zi', { headers: authorHeaders, data: { expectedLockVersion: 0, content: { ediblePart: '工程测试部位', latinName: '', educationText: '工程测试草稿，不代表已核验食材资料。', safetyText: '仅测试，不用于食用指导。', sourceRefs: [{ id: source.id, revision: 1, locator: '测试第 1 页' }] } } });
    expect(draft.status()).toBe(200);
    await panel(page, title);
    await page.getByLabel('来源核验依据类型', { exact: true }).selectOption('test-fixture');
    await page.getByLabel('来源类别', { exact: true }).selectOption('official');
    await page.getByLabel('来源核验依据编号', { exact: true }).fill('工程测试，不代表官方核验');
    await page.getByLabel('来源复核截止UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByLabel('查找适用食材', { exact: true }).fill('莲子');
    await page.getByRole('button', { name: '加入莲子核验范围', exact: true }).click();
    for (const label of ['身份依据', '食用部位', '加工形态', '安全边界', '目录适用范围']) await page.getByLabel(label, { exact: true }).check();
    await page.getByLabel('来源核验说明', { exact: true }).fill('网络失败仍应保留的工程测试输入。');
    await expect(page.getByRole('button', { name: '保存来源核验', exact: true })).toBeDisabled();
    await page.getByLabel('确认已核对来源依据', { exact: true }).check();
    page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: '来源登记', exact: true }).click();
    await expect(page.getByLabel('来源核验说明', { exact: true })).toHaveValue('网络失败仍应保留的工程测试输入。');
    await page.route(`**/api/v1/editorial/source-checks/${source.id}`, (route) => route.request().method() === 'POST' ? route.abort() : route.continue());
    await page.getByRole('button', { name: '保存来源核验', exact: true }).click();
    await expect(page.getByRole('status', { name: '来源核验结果' })).toContainText('无法确认提交结果');
    await expect(page.getByRole('status', { name: '来源核验结果' })).toContainText('先重新读取核对');
    await expect(page.getByLabel('来源核验说明', { exact: true })).toHaveValue('网络失败仍应保留的工程测试输入。');
    await page.unroute(`**/api/v1/editorial/source-checks/${source.id}`);
    await expect(page.getByRole('button', { name: '保存来源核验', exact: true })).toBeDisabled();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '刷新来源核验', exact: true }).click();
    await expect(page.getByLabel('来源核验状态', { exact: true })).toContainText('尚未核验');
    await page.getByLabel('来源核验依据类型', { exact: true }).selectOption('test-fixture');
    await page.getByLabel('来源类别', { exact: true }).selectOption('official');
    await page.getByLabel('来源核验依据编号', { exact: true }).fill('工程测试，不代表官方核验');
    await page.getByLabel('来源复核截止UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByRole('button', { name: '加入莲子核验范围', exact: true }).click();
    for (const label of ['身份依据', '食用部位', '加工形态', '安全边界', '目录适用范围']) await page.getByLabel(label, { exact: true }).check();
    await page.getByLabel('来源核验说明', { exact: true }).fill('网络失败仍应保留的工程测试输入。');
    await page.getByLabel('确认已核对来源依据', { exact: true }).check();
    await page.getByRole('button', { name: '保存来源核验', exact: true }).click();
    await expect(page.getByRole('status', { name: '来源核验结果' })).toContainText('未发布内容');
    await expect(page.getByLabel('来源核验状态', { exact: true })).toContainText('仅工程测试核验');
    await expect(page.getByLabel('确认已核对来源依据', { exact: true })).not.toBeChecked();
    await page.reload(); await panel(page, title);
    await page.getByLabel('查找适用食材', { exact: true }).fill('莲子');
    await expect(page.getByRole('button', { name: '移除莲子范围', exact: true })).toBeVisible();
    await expect(page.getByText('网络失败仍应保留的工程测试输入。', { exact: true })).toBeVisible();
    await page.getByLabel('搜索发布检查食材', { exact: true }).fill('莲子');
    await page.getByRole('button', { name: '检查莲子发布资料', exact: true }).click();
    await expect(page.getByLabel('发布前检查结果', { exact: true })).toContainText('工程测试不能作为发布依据');
    await expect(page.getByLabel('发布前检查结果', { exact: true })).toContainText('本页不执行发布');
    await page.screenshot({ path: test.info().outputPath('source-check-fixture-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('source-check-fixture-mobile.png'), fullPage: true });
    await page.getByLabel('核验决定', { exact: true }).selectOption('revoke');
    await page.getByLabel('来源核验说明', { exact: true }).fill('撤销工程测试核验，保留原始历史。');
    await page.getByRole('button', { name: '保存来源核验', exact: true }).click();
    await expect(page.getByLabel('来源核验状态', { exact: true })).toContainText('核验已撤销');
    const detail = await (await context.request.get(`/api/v1/editorial/source-checks/${source.id}/1`)).json();
    expect(detail.checkVersion).toBe(2); expect(detail.checks).toHaveLength(2); expect(detail.visibility).toBe('private');
    const savedDraft = await (await author.request.get('/api/v1/editorial/ingredients/lian-zi')).json();
    const originalDraft = await draft.json();
    expect(originalDraft.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(savedDraft.draft).toEqual(originalDraft);
    await panel(editor, title);
    await expect(editor.getByLabel('来源核验说明', { exact: true })).toBeDisabled();
    await expect(editor.getByRole('button', { name: '保存来源核验', exact: true })).toBeDisabled();
    expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(publicBefore);
  } finally { await author.close(); }
});

test('source and preflight search errors recover on explicit refresh before any selection', async ({ page, browser }) => {
  const username = `source-retry-${Date.now()}`; const password = 'test-only-source-retry-password-2026';
  const admin = await browser.newContext({ baseURL: origin });
  try {
    const signedIn = await admin.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: 'browser-admin', password: 'test-only-admin-password-2026' } });
    expect(signedIn.status()).toBe(200);
    const created = await admin.request.post('/api/v1/users', { headers: await headers(admin), data: { username, password, role: 'editor' } });
    expect(created.status()).toBe(201);
  } finally { await admin.close(); }
  await login(page, username, password);
  await page.route('**/api/v1/editorial/sources?*', (route) => route.abort());
  await page.route('**/api/v1/ingredients?*', (route) => route.abort());
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '来源核验与发布检查', exact: true }).click();
  const sourcePanel = page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name: '固定来源核验', exact: true }) });
  const preflightPanel = page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name: '发布前资料检查', exact: true }) });
  await expect(sourcePanel.getByRole('alert')).toContainText('无法连接');
  await expect(preflightPanel.getByRole('alert')).toContainText('无法连接');
  await page.unroute('**/api/v1/editorial/sources?*'); await page.unroute('**/api/v1/ingredients?*');
  await page.getByRole('button', { name: '刷新来源核验', exact: true }).click();
  await page.getByRole('button', { name: '刷新发布前检查', exact: true }).click();
  await expect(sourcePanel.getByRole('button', { name: /^核验/ }).first()).toBeVisible();
  await expect(preflightPanel.getByRole('button', { name: /^检查.*发布资料$/ }).first()).toBeVisible();
  await expect(sourcePanel.getByRole('alert')).toHaveCount(0); await expect(preflightPanel.getByRole('alert')).toHaveCount(0);
});
