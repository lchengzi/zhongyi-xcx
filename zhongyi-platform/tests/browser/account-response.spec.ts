import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Account, SessionInfo } from '../../shared/contracts';

const origin = 'http://127.0.0.1:4314', password = 'engineering-account-test-password-2026';
test.use({ baseURL: origin });
async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill('browser-recovery-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-only-recovery-admin-password-2026');
  const accepted = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录工作台' }).click(); expect((await accepted).status()).toBe(200); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '账号权限', exact: true }).click();
}
const row = (page: Page, username: string) => page.getByRole('row').filter({ has: page.getByLabel(`${username}的角色`, { exact: true }) });
async function users(context: BrowserContext): Promise<Account[]> { const response = await context.request.get('/api/v1/users'); expect(response.status()).toBe(200); return (await response.json()).items; }
async function headers(context: BrowserContext) { const session: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json(); return { Origin: origin, 'X-CSRF-Token': session.csrfToken }; }
async function add(context: BrowserContext, suffix: string): Promise<Account> {
  const response = await context.request.post('/api/v1/users', { headers: await headers(context), data: { username: `response-${suffix}-${Date.now()}`, password, role: 'editor' } }); expect(response.status()).toBe(201); return response.json();
}
async function confirm(page: Page, name: string, accept = true) { page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss()); await page.getByRole('button', { name, exact: true }).click(); }
async function fill(page: Page, username: string) { await page.getByLabel('新账号用户名', { exact: true }).fill(username); await page.getByLabel('新账号初始密码', { exact: true }).fill(password); }

test('malformed account and security lists stay independent; failed refresh retains local row and creation input without current authority', async ({ page, context }) => {
  await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); body.items[0].password_hash = 'PRIVATE-MUST-NOT-RENDER'; await route.fulfill({ response, json: body }); });
  await page.route('**/api/v1/security-events', async route => { const response = await route.fetch(); const body = await response.json(); body.items[0].id = 'wrong-id'; await route.fulfill({ response, json: body }); });
  await open(page); await expect(page.getByLabel('账号列表错误', { exact: true })).toContainText('数据格式无效');
  await expect(page.getByLabel('安全记录读取错误', { exact: true })).toContainText('数据格式无效'); await expect(page.getByLabel('账号结果数量', { exact: true })).toHaveText('账号数量暂不可用');
  await expect(page.getByLabel('新账号用户名', { exact: true })).toBeDisabled(); await expect(page.getByLabel('安全记录列表', { exact: true })).toHaveCount(0);
  await expect(page.getByText('PRIVATE-MUST-NOT-RENDER', { exact: true })).toHaveCount(0); await expect(page.getByText('暂无安全记录。', { exact: true })).toHaveCount(0);
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes++; }); const before = await users(context);
  await page.unroute('**/api/v1/users'); await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(page.getByLabel('新账号用户名', { exact: true })).toBeEnabled(); await expect(page.getByLabel('安全记录读取错误', { exact: true })).toBeVisible();
  await fill(page, 'response-unsent-account'); const role = page.getByLabel('browser-editor的角色', { exact: true }); await role.selectOption('reviewer');
  await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); body.items.push(body.items[0]); await route.fulfill({ response, json: body }); });
  await page.getByRole('button', { name: '刷新账号列表', exact: true }).click(); await expect(page.getByLabel('账号列表错误', { exact: true })).toBeVisible();
  await expect(role).toHaveValue('reviewer'); await expect(role).toBeDisabled(); await expect(page.getByLabel('新账号初始密码', { exact: true })).toHaveValue(password);
  await expect(page.getByLabel('账号权限读取状态', { exact: true })).toBeVisible(); await expect(row(page, 'browser-editor').getByRole('button', { name: '更新权限', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/users'); await page.getByRole('button', { name: '重新读取账号', exact: true }).click(); await expect(role).toBeEnabled(); await expect(role).toHaveValue('reviewer');
  await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, items: body.items.filter((user: Account) => user.username !== 'browser-editor') } }); });
  await page.getByRole('button', { name: '刷新账号列表', exact: true }).click(); await expect(page.getByLabel('账号列表错误', { exact: true })).toContainText('数据格式无效');
  await expect(role).toHaveValue('reviewer'); await expect(role).toBeDisabled();
  await page.unroute('**/api/v1/users'); await page.getByRole('button', { name: '重新读取账号', exact: true }).click(); await expect(role).toBeEnabled();
  await page.unroute('**/api/v1/security-events'); await page.getByRole('button', { name: '重新读取安全记录', exact: true }).click(); await expect(page.getByLabel('安全记录列表', { exact: true })).toBeVisible();
  await expect(page.getByLabel('新账号用户名', { exact: true })).toHaveValue('response-unsent-account'); expect(writes).toBe(0); expect(await users(context)).toEqual(before);
});

test('a real account creation with corrupt acknowledgement locks only its original intent; failed or unrelated refresh cannot confirm or repeat it', async ({ page, context }) => {
  await open(page); const username = `response-unknown-${Date.now()}`; await fill(page, username);
  let writes = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/users')) writes++; });
  await page.route('**/api/v1/users', async route => { if (route.request().method() !== 'POST') { await route.continue(); return; } const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json(); await route.fulfill({ response, json: { ...body, revision: 2 } }); });
  await page.getByRole('button', { name: '创建账号', exact: true }).click(); await expect(page.getByLabel('账号创建错误', { exact: true })).toContainText('无法确认提交结果');
  await expect(page.getByLabel('新账号初始密码', { exact: true })).toHaveValue(password); await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeDisabled();
  const committed = (await users(context)).filter(user => user.username === username); expect(committed).toHaveLength(1); expect(committed[0].revision).toBe(1); expect(writes).toBe(1);
  await page.getByRole('button', { name: '刷新账号列表', exact: true }).click(); await expect(row(page, username)).toBeVisible(); await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeDisabled();
  await confirm(page, '核对账号创建结果', false); await expect(page.getByLabel('新账号初始密码', { exact: true })).toHaveValue(password);
  await page.unroute('**/api/v1/users'); await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); body.items[0].role = 'root'; await route.fulfill({ response, json: body }); });
  await confirm(page, '核对账号创建结果'); await expect(page.getByLabel('账号创建错误', { exact: true })).toContainText('数据格式无效');
  await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeDisabled(); await expect(page.getByLabel('新账号用户名', { exact: true })).toHaveValue(username); expect(writes).toBe(1);
  await page.unroute('**/api/v1/users');
  const changed = await context.request.put(`/api/v1/users/${committed[0].id}`, { headers: await headers(context), data: { role: 'reviewer', active: false, expectedRevision: 1 } }); expect(changed.status()).toBe(200);
  await confirm(page, '核对账号创建结果'); await expect(page.getByLabel('账号创建结果', { exact: true })).toContainText(`账号列表中已有 ${username}，修订 2`);
  await expect(page.getByLabel('账号创建结果', { exact: true })).toContainText('不证明本次创建归属或初始密码可用'); await expect(page.getByLabel('新账号初始密码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('新账号用户名', { exact: true })).toHaveValue(''); expect(writes).toBe(1); expect((await users(context)).filter(user => user.username === username)).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('committed permission update with a substituted identity preserves its row and other drafts; only a valid selected reread unlocks and old sessions are truly revoked', async ({ page, context, browser }) => {
  await open(page); const first = await add(context, 'update'), second = await add(context, 'other');
  await page.getByRole('button', { name: '刷新账号列表', exact: true }).click(); await expect(row(page, second.username)).toBeVisible();
  const oldSession = await browser.newContext({ baseURL: origin });
  try {
    const signed = await oldSession.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: first.username, password } }); expect(signed.status()).toBe(200);
    await page.getByLabel(`${second.username}的角色`, { exact: true }).selectOption('reviewer');
    const target = row(page, first.username), role = page.getByLabel(`${first.username}的角色`, { exact: true }); await role.selectOption('reviewer'); await page.getByLabel(`${first.username}启用状态`, { exact: true }).uncheck();
    let writes = 0; page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/users/${first.id}`)) writes++; });
    await page.route(`**/api/v1/users/${first.id}`, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); const body = await response.json(); await route.fulfill({ response, json: { ...body, id: second.id } }); });
    page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '更新权限', exact: true }).click();
    await expect(target.getByRole('alert')).toContainText('无法确认提交结果'); await expect(target.getByRole('button', { name: '更新权限', exact: true })).toBeDisabled();
    await expect(role).toHaveValue('reviewer'); await expect(target).toContainText('修订 1'); expect(writes).toBe(1);
    const committed = (await users(context)).find(user => user.id === first.id)!; expect(committed.revision).toBe(2); expect(committed.active).toBe(false); expect(committed.role).toBe('reviewer'); expect((await oldSession.request.get('/api/v1/auth/me')).status()).toBe(401);
    await page.unroute(`**/api/v1/users/${first.id}`); await page.getByRole('button', { name: '刷新账号列表', exact: true }).click(); await expect(target).toContainText('服务端已有新修订');
    await expect(target.getByRole('button', { name: '更新权限', exact: true })).toBeDisabled(); await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toHaveValue('reviewer');
    await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); body.items = body.items.map((user: Account) => user.id === first.id ? { ...user, username: 'substituted-user' } : user); await route.fulfill({ response, json: body }); });
    page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '重新加载权限', exact: true }).click(); await expect(target.getByRole('alert')).toContainText('数据格式无效');
    await expect(role).toHaveValue('reviewer'); await expect(target.getByRole('button', { name: '更新权限', exact: true })).toBeDisabled(); expect(writes).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await test.info().attach('account-response-uncertain-narrow', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.unroute('**/api/v1/users'); page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '重新加载权限', exact: true }).click(); await expect(target).toContainText('修订 2');
    await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toHaveValue('reviewer'); await page.getByLabel(`${first.username}启用状态`, { exact: true }).check();
    page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '更新权限', exact: true }).click(); await expect(target).toContainText('修订 3'); expect(writes).toBe(2);
  } finally { await oldSession.close(); }
});

test('an absent account after an uncommitted failed create is only an observation; another create is a separate manual confirmed action', async ({ page, context }) => {
  await open(page); const username = `response-absent-${Date.now()}`; await fill(page, username); let attempts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/users')) attempts++; });
  await page.route('**/api/v1/users', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByRole('button', { name: '创建账号', exact: true }).click(); await expect(page.getByLabel('账号创建错误', { exact: true })).toContainText('无法确认提交结果');
  expect((await users(context)).some(user => user.username === username)).toBe(false); await page.unroute('**/api/v1/users');
  await confirm(page, '核对账号创建结果'); await expect(page.getByLabel('账号创建结果', { exact: true })).toContainText('不代表原请求一定没有或不会稍后提交');
  await expect(page.getByLabel('新账号用户名', { exact: true })).toHaveValue(username); await expect(page.getByLabel('新账号初始密码', { exact: true })).toHaveValue(password); expect(attempts).toBe(1);
  await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeEnabled(); await confirm(page, '创建账号', false); expect(attempts).toBe(1);
  await confirm(page, '创建账号'); await expect(page.getByLabel('账号创建结果', { exact: true })).toContainText('账号已创建'); expect(attempts).toBe(2);
  expect((await users(context)).filter(user => user.username === username)).toHaveLength(1);
});
