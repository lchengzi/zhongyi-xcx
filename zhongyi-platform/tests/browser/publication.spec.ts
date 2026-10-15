import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { SessionInfo } from '../../shared/contracts';
import { fixturePassword } from '../migration-fixture';

const origin = 'http://127.0.0.1:4313';
const path = '/api/v1/editorial/publications/huang-qi';
const detailPattern = /\/api\/v1\/editorial\/publications\/huang-qi(?:\/versions\/\d+)?$/;
test.use({ baseURL: origin });
async function login(page: Page, username: string) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材', exact: true })).toBeVisible();
}
async function panel(page: Page) {
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
  await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click();
  await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: '发布规则' })).toContainText('独立批准');
  await expect(page.getByText('未启用', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新加载发布状态', exact: true })).toBeEnabled();
}
async function fill(page: Page, control = false) {
  await page.getByLabel('发布操作说明', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL：仅本地浏览器验收。');
  if (control) await page.getByLabel('恢复或冻结核对编号', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL');
  await page.getByLabel('确认已核对发布依据', { exact: true }).check();
}
async function clickConfirmed(page: Page, name: string) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name, exact: true }).click();
}
async function act(page: Page, name: string, control = false) {
  await fill(page, control); await clickConfirmed(page, name);
  await expect(page.getByLabel('发布操作结果', { exact: true })).toContainText(`已记录「${name}」`);
  await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('确认已核对发布依据', { exact: true })).not.toBeChecked();
}
async function reload(page: Page) {
  let dirty = false;
  for (const name of ['发布操作说明', '更早快照版本', '恢复或冻结核对编号']) {
    const field = page.getByLabel(name, { exact: true });
    if (await field.count()) dirty ||= !!(await field.inputValue());
  }
  const confirmation = page.getByLabel('确认已核对发布依据', { exact: true });
  if (await confirmation.count()) dirty ||= await confirmation.isChecked();
  if (dirty) page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新加载发布状态', exact: true })).toBeEnabled();
  await expect(page.getByLabel('发布操作错误', { exact: true })).toHaveCount(0);
}
const education = (context: BrowserContext) => context.request.get('/api/v1/public/education/huang-qi');

test('publication list failures show an unknown count, block pagination and recover without writes', async ({ page, context }) => {
  await login(page, 'publication-ui-editor');
  const reference = await (await context.request.get('/api/v1/ingredients?page=1&pageSize=8')).json();
  expect(reference.total).toBe(3); // This isolated publication fixture has three records, not the working catalog.
  let writes = 0; page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/ingredients?**', (route) => route.abort());
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
  const count = page.locator('.workflow-split > section .pagination > span');
  await expect(page.getByRole('button', { name: '重试食材列表', exact: true })).toBeVisible();
  await expect(count).toHaveText('结果数量暂不可用');
  await expect(page.getByText('没有匹配食材。', { exact: true })).toHaveCount(0);
  for (const name of ['上一批发布条目', '下一批发布条目']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/ingredients?**');
  await page.getByRole('button', { name: '重试食材列表', exact: true }).click();
  await expect(count).toHaveText(`共 ${reference.total} 条`);
  await expect(page.getByRole('button', { name: '下一批发布条目', exact: true })).toBeDisabled();
  await page.route('**/api/v1/ingredients?**', (route) => route.abort());
  await page.getByLabel('搜索发布管理食材', { exact: true }).fill('姜');
  await expect(page.getByRole('button', { name: '重试食材列表', exact: true })).toBeVisible();
  await expect(count).toHaveText('结果数量暂不可用');
  await expect(page.getByRole('button', { name: /^管理.+发布$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一批发布条目', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/ingredients?**');
  await page.getByRole('button', { name: '重试食材列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理姜发布', exact: true })).toBeVisible();
  await page.getByLabel('搜索发布管理食材', { exact: true }).fill('没有这项食材');
  await expect(page.getByText('没有匹配食材。', { exact: true })).toBeVisible();
  await expect(count).toHaveText('共 0 条'); expect(writes).toBe(0);
});

test('publication initial detail failure is unknown, not no active content or no history; retry reads the real state', async ({ page, context }) => {
  await login(page, 'publication-ui-editor');
  const before = await (await context.request.get(path)).json();
  let writes = 0; page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.route(detailPattern, (route) => route.abort());
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
  await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click();
  await expect(page.getByLabel('发布操作错误', { exact: true })).toBeVisible();
  await expect(page.getByLabel('发布状态待确认', { exact: true })).toContainText('不能确认');
  await expect(page.getByLabel('教育发布状态', { exact: true })).toHaveCount(0);
  await expect(page.getByText('尚无发布事件。', { exact: true })).toHaveCount(0);
  await page.unroute(detailPattern);
  await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click();
  await expect(page.getByLabel('发布操作错误', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
  await expect(page.getByLabel('发布状态待确认', { exact: true })).toHaveCount(0);
  const after = await (await context.request.get(path)).json();
  expect(after).toEqual(before); expect(writes).toBe(0);
});

test('publication pending and failed refresh hide stale authority and history while keeping input until deliberate successful reload', async ({ page, context }, testInfo) => {
  await login(page, 'publication-ui-editor'); await panel(page); await fill(page);
  const before = await (await context.request.get(path)).json();
  const original = await page.getByLabel('发布操作说明', { exact: true }).inputValue();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed!: () => void; const handled = new Promise<void>((resolve) => { completed = resolve; });
  let reads = 0, writes = 0;
  page.on('request', (request) => { if (request.method() !== 'GET') writes += 1; });
  await page.route(detailPattern, async (route) => { reads += 1; await gate; try { await route.abort(); } finally { completed(); } });
  try {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    await expect(page.getByText('正在读取固定快照与当前发布权限…', { exact: true })).toBeVisible();
    for (const name of ['教育发布状态', '快照批准状态', '固定快照内容']) await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '最近发布事件', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue(original);
    await expect(page.getByRole('button', { name: '生成固定快照', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('publication-refresh-loading-mobile.png'), fullPage: true });
    release(); await expect(page.getByLabel('发布操作错误', { exact: true })).toBeVisible();
    await expect(page.getByLabel('发布状态待确认', { exact: true })).toContainText('不能确认');
    for (const name of ['教育发布状态', '快照批准状态', '固定快照内容']) await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '最近发布事件', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue(original);
    await expect(page.getByLabel('确认已核对发布依据', { exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: '读取历史快照版本', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('publication-refresh-failure-mobile.png'), fullPage: true });
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click();
    expect(reads).toBe(1); await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue(original);
    await page.unroute(detailPattern); await reload(page);
    await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
    await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('确认已核对发布依据', { exact: true })).not.toBeChecked();
    const after = await (await context.request.get(path)).json(); expect(after).toEqual(before); expect(writes).toBe(0);
  } finally { release(); await handled; await page.unroute(detailPattern); }
});

test('real React UI creates a fixed version, rejects self-approval, independently publishes, rolls back, withdraws and freezes without auto-revival', async ({ page, browser, context }, testInfo) => {
  test.setTimeout(90000);
  const originalCatalog = await (await context.request.get('/api/v1/public/catalog')).text();
  await login(page, 'migration-editor'); await panel(page);
  await expect(page.getByRole('button', { name: '发布此快照', exact: true })).toBeDisabled();
  await act(page, '生成固定快照');
  await expect(page.getByLabel('固定快照版本', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByLabel('固定快照内容', { exact: true })).toContainText('浏览器测试第三版');
  const adminContext = await browser.newContext({ baseURL: origin });
  const approverContext = await browser.newContext({ baseURL: origin });
  try {
    const admin = await adminContext.newPage(); await login(admin, 'migration-admin'); await panel(admin);
    await act(admin, '恢复发布操作', true);
    await fill(admin); await clickConfirmed(admin, '批准此快照');
    await expect(admin.getByLabel('发布操作错误', { exact: true })).toContainText('输入已保留');
    await expect(admin.getByLabel('发布操作说明', { exact: true })).not.toHaveValue('');
    await expect(admin.getByRole('button', { name: '批准此快照', exact: true })).toBeDisabled();
    expect((await education(context)).status()).toBe(404);
    const approver = await approverContext.newPage(); await login(approver, 'publication-approver'); await panel(approver);
    await act(approver, '批准此快照'); expect((await education(context)).status()).toBe(404);
    await act(approver, '发布此快照');
    const published = await education(context); expect(published.status()).toBe(200);
    const body = await published.json(); expect(body.snapshotVersion).toBe(3);
    await approver.screenshot({ path: testInfo.outputPath('publication-desktop.png'), fullPage: true });
    expect(Object.keys(body).sort()).toEqual(['scope', 'ingredientId', 'name', 'snapshotId', 'snapshotVersion', 'contentRevision', 'baseReleaseId', 'publishedAt', 'ediblePart', 'latinName', 'educationText', 'safetyText', 'sources', 'boundary'].sort());
    const options = approver.getByLabel('固定快照版本', { exact: true });
    await options.selectOption({ label: '快照 1 · 正文 2' });
    await act(approver, '批准此快照'); await act(approver, '回滚到此快照');
    expect((await (await education(context)).json()).snapshotVersion).toBe(1);
    await act(approver, '撤回当前发布'); expect((await education(context)).status()).toBe(404);
    await fill(approver); await clickConfirmed(approver, '发布此快照');
    await expect(approver.getByLabel('发布操作错误', { exact: true })).toBeVisible();
    expect((await education(context)).status()).toBe(404);
    await reload(approver); await act(approver, '批准此快照'); await act(approver, '发布此快照');
    await act(approver, '冻结全部教育发布', true); expect((await education(context)).status()).toBe(404);
    await act(approver, '恢复发布操作', true); expect((await education(context)).status()).toBe(404);
    await act(approver, '批准此快照'); expect((await education(context)).status()).toBe(404);
    await act(approver, '发布此快照'); expect((await education(context)).status()).toBe(200);
    expect(await (await context.request.get('/api/v1/public/catalog')).text()).toBe(originalCatalog);
  } finally { await adminContext.close(); await approverContext.close(); }
});

test('failed writes preserve input, require refresh and guard tab, ingredient and snapshot navigation; early reload failures can recover', async ({ page }) => {
  await login(page, 'publication-ui-editor'); await panel(page); await fill(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await expect(page.getByLabel('发布操作说明', { exact: true })).not.toHaveValue('');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '管理姜发布', exact: true }).click();
  await expect(page.getByRole('heading', { name: '黄芪 · 固定版本发布', exact: true })).toBeVisible();
  const selected = await page.getByLabel('固定快照版本', { exact: true }).inputValue();
  const alternative = await page.getByLabel('固定快照版本', { exact: true }).locator('option').evaluateAll((options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== current)!, selected);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('固定快照版本', { exact: true }).selectOption(alternative);
  await expect(page.getByLabel('固定快照版本', { exact: true })).toHaveValue(selected);
  await page.route(`**${path}/snapshots`, (route) => route.abort());
  await clickConfirmed(page, '生成固定快照');
  await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('输入已保留');
  await expect(page.getByLabel('确认已核对发布依据', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '生成固定快照', exact: true })).toBeDisabled();
  await page.unroute(`**${path}/snapshots`); await reload(page);
  await page.route(`**${path}/versions/*`, (route) => route.abort());
  await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click();
  await expect(page.getByLabel('发布操作错误', { exact: true })).toBeVisible();
  await page.unroute(`**${path}/versions/*`); await reload(page);
  await page.getByLabel('更早快照版本', { exact: true }).fill('1');
  await page.getByRole('button', { name: '读取历史快照版本', exact: true }).click();
  await expect(page.getByLabel('固定快照内容', { exact: true })).toContainText('正文修订 2');
  await page.getByLabel('搜索发布管理食材', { exact: true }).fill('没有这项食材');
  await expect(page.getByText('没有匹配食材。', { exact: true })).toBeVisible();
});

test('a committed global control with failed refresh is not silently retried; busy UI prevents navigation', async ({ page, context }) => {
  await login(page, 'publication-ui-admin'); await panel(page); await fill(page, true);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/editorial/publication-controls', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await held; await route.continue();
  });
  await clickConfirmed(page, '冻结全部教育发布');
  await expect(page.getByRole('button', { name: '固定版本发布', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '管理姜发布', exact: true })).toBeDisabled();
  await page.route(`**${path}/versions/*`, (route) => route.abort());
  release();
  await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('操作已记录，但状态刷新失败');
  await expect(page.getByLabel('教育发布状态', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('快照批准状态', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('固定快照内容', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('发布状态待确认', { exact: true })).toContainText('不能确认');
  await expect(page.getByRole('button', { name: '冻结全部教育发布', exact: true })).toBeDisabled();
  await expect(page.getByLabel('发布操作说明', { exact: true })).not.toHaveValue('');
  const me: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json();
  const controls = await context.request.get('/api/v1/editorial/publication-controls', { headers: { Origin: origin, 'X-CSRF-Token': me.csrfToken } });
  const before = await controls.json(); expect(before.items[0].action).toBe('freeze');
  await page.unroute(`**${path}/versions/*`); await reload(page);
  await expect(page.getByLabel('教育发布状态', { exact: true })).toContainText('全部教育发布冻结');
  const after = await (await context.request.get('/api/v1/editorial/publication-controls')).json();
  expect(after.items.length).toBe(before.items.length);
});

test('reviewer publication view is read-only and remains usable at a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'publication-ui-reviewer'); await panel(page);
  await expect(page.getByLabel('发布操作说明', { exact: true })).toBeDisabled();
  for (const name of ['生成固定快照', '批准此快照', '发布此快照', '撤回当前发布', '回滚到此快照']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '冻结全部教育发布', exact: true })).toHaveCount(0);
  await expect(page.getByText('审阅账号只读本页；专业意见请在专业审校记录中操作。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('publication-narrow.png'), fullPage: true });
});

test('a real concurrent control change returns 409, preserves the stale form and cannot append a second event', async ({ page, context }) => {
  await login(page, 'publication-ui-admin'); await panel(page); await fill(page, true);
  const info: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json();
  const headers = { Origin: origin, 'X-CSRF-Token': info.csrfToken };
  const before = await (await context.request.get('/api/v1/editorial/publication-controls')).json();
  const concurrent = await context.request.post('/api/v1/editorial/publication-controls', { headers, data: {
    action: 'freeze', expectedVersion: before.items[0].version, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL',
    comment: '另一个窗口的隔离工程模拟。', confirmed: true
  } });
  expect(concurrent.status()).toBe(201);
  const response = page.waitForResponse((result) => result.url().endsWith('/api/v1/editorial/publication-controls') && result.request().method() === 'POST');
  await clickConfirmed(page, '冻结全部教育发布'); expect((await response).status()).toBe(409);
  await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('输入已保留');
  await expect(page.getByLabel('恢复或冻结核对编号', { exact: true })).toHaveValue('ENGINEERING_SIMULATION_NOT_REAL');
  const after = await (await context.request.get('/api/v1/editorial/publication-controls')).json();
  expect(after.items.length).toBe(before.items.length + 1);
  await reload(page);
});

test('server-side account revocation returns 401 without losing publication form input or changing fixed history', async ({ browser, context }) => {
  const loginResponse = await context.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: 'migration-admin', password: fixturePassword } });
  expect(loginResponse.status()).toBe(200); const info: SessionInfo = await loginResponse.json();
  const headers = { Origin: origin, 'X-CSRF-Token': info.csrfToken };
  const created = await context.request.post('/api/v1/users', { headers, data: { username: `pub-expiry-${Date.now()}`, password: fixturePassword, role: 'editor' } });
  expect(created.status()).toBe(201); const person = await created.json();
  const owned = await browser.newContext({ baseURL: origin });
  try {
    const page = await owned.newPage(); await login(page, person.username); await panel(page); await fill(page);
    const prior = await (await context.request.get(path)).json();
    const revoked = await context.request.put(`/api/v1/users/${person.id}`, { headers, data: { role: 'editor', active: false, expectedRevision: person.revision } });
    expect(revoked.status()).toBe(200);
    const response = page.waitForResponse((result) => result.url().endsWith(`${path}/snapshots`) && result.request().method() === 'POST');
    await clickConfirmed(page, '生成固定快照'); expect((await response).status()).toBe(401);
    await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('输入已保留');
    await expect(page.getByLabel('发布操作说明', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('确认已核对发布依据', { exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: '生成固定快照', exact: true })).toBeDisabled();
    const after = await (await context.request.get(path)).json(); expect(after.snapshots).toEqual(prior.snapshots); expect(after.events).toEqual(prior.events);
  } finally { await owned.close(); }
});
