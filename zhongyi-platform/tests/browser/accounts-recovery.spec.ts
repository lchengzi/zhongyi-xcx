import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import type { Account, SessionInfo } from '../../shared/contracts';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function openAccounts(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill('browser-recovery-admin');
  await page.getByLabel('密码', { exact: true }).fill('test-only-recovery-admin-password-2026');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await page.getByRole('button', { name: '账号权限', exact: true }).click();
  await expect(page.getByLabel('browser-recovery-admin的角色', { exact: true })).toBeVisible();
}
async function addUser(context: BrowserContext, suffix: string): Promise<Account> {
  const session: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json();
  const response = await context.request.post('/api/v1/users', {
    headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': session.csrfToken },
    data: { username: `recovery-${suffix}-${Date.now()}`, password: 'fictional-test-password-2026', role: 'editor' }
  });
  expect(response.status()).toBe(201);
  return response.json();
}
const rowFor = (page: Page, username: string) => page.getByRole('row').filter({ has: page.getByLabel(`${username}的角色`, { exact: true }) });

test('account inputs require explicit discard on refresh, section change and logout without storing passwords', async ({ page, context }) => {
  await openAccounts(page);
  const name = page.getByLabel('新账号用户名'); const password = page.getByLabel('新账号初始密码');
  const value = `unsaved-${Date.now()}`;
  await name.fill(value); await password.fill('fictional-unsaved-password-2026');
  await page.getByLabel('新账号角色').selectOption('reviewer');
  let prompts = 0;
  const cancel = async (dialog: import('@playwright/test').Dialog) => { prompts++; await dialog.dismiss(); };
  page.on('dialog', cancel);
  await page.getByRole('button', { name: '刷新内容', exact: false }).click();
  await expect(name).toHaveValue(value); expect(prompts).toBe(1);
  await page.getByRole('button', { name: '食材资料', exact: false }).click();
  await expect(name).toHaveValue(value); expect(prompts).toBe(2);
  await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(password).toHaveValue('fictional-unsaved-password-2026'); expect(prompts).toBe(3);
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  const users = await (await context.request.get('/api/v1/users')).json();
  expect(users.items.some((user: Account) => user.username === value)).toBe(false);
  page.off('dialog', cancel);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '食材资料', exact: false }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
  await page.getByRole('button', { name: '账号权限', exact: true }).click();
  await expect(name).toHaveValue(''); await expect(password).toHaveValue('');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test('a committed account creation awaiting its response blocks unmount and duplicate submit', async ({ page, context }) => {
  await openAccounts(page);
  const username = `pending-${Date.now()}`;
  await page.getByLabel('新账号用户名').fill(username);
  await page.getByLabel('新账号初始密码').fill('fictional-pending-password-2026');
  let writes = 0; let release!: () => void; let observed!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const committed = new Promise<void>((resolve) => { observed = resolve; });
  await page.route('**/api/v1/users', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    writes++;
    const response = await route.fetch(); expect(response.status()).toBe(201); observed();
    await gate; await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '创建账号', exact: true }).click(); await committed;
    await expect(page.getByRole('button', { name: '退出工作台' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '刷新内容', exact: false })).toBeDisabled();
    await page.getByRole('button', { name: '食材资料', exact: false }).click();
    await expect(page.getByLabel('新账号用户名')).toHaveValue(username);
    await page.locator('form.account-form').evaluate((form: HTMLFormElement) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(writes).toBe(1);
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  } finally { release(); }
  await expect(page.getByRole('status', { name: '账号创建结果' })).toContainText('账号已创建');
  await expect(page.getByLabel('新账号初始密码')).toHaveValue('');
  await expect(rowFor(page, username)).toBeVisible(); expect(writes).toBe(1);
  const users = await (await context.request.get('/api/v1/users')).json();
  expect(users.items.filter((user: Account) => user.username === username)).toHaveLength(1);
});

test('saving one account preserves another account row draft and reload requires consent', async ({ page, context }) => {
  await openAccounts(page); const first = await addUser(context, 'first'); const second = await addUser(context, 'second');
  await page.getByRole('button', { name: '刷新内容', exact: false }).click();
  await page.getByLabel(`${second.username}的角色`, { exact: true }).selectOption('reviewer');
  await page.getByLabel(`${first.username}启用状态`, { exact: true }).uncheck();
  page.once('dialog', (dialog) => dialog.accept()); await rowFor(page, first.username).getByRole('button', { name: '更新权限', exact: true }).click();
  await expect(rowFor(page, first.username)).toContainText('修订 2');
  await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toBeEnabled();
  await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toHaveValue('reviewer');
  const users = await (await context.request.get('/api/v1/users')).json();
  expect(users.items.find((user: Account) => user.id === second.id).role).toBe('editor');
  page.once('dialog', (dialog) => dialog.dismiss()); await rowFor(page, second.username).getByRole('button', { name: '重新加载权限', exact: true }).click();
  await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toHaveValue('reviewer');
  page.once('dialog', (dialog) => dialog.accept()); await rowFor(page, second.username).getByRole('button', { name: '重新加载权限', exact: true }).click();
  await expect(page.getByLabel(`${second.username}的角色`, { exact: true })).toHaveValue('editor');
});

test('failed account reread preserves row draft; concurrent revision stays a real 409 until explicit reload', async ({ page, context }) => {
  await openAccounts(page); const user = await addUser(context, 'conflict');
  await page.getByRole('button', { name: '刷新内容', exact: false }).click();
  const role = page.getByLabel(`${user.username}的角色`, { exact: true }); await role.selectOption('reviewer');
  await page.route('**/api/v1/users', (route) => route.request().method() === 'GET' ? route.abort() : route.continue());
  await page.getByRole('button', { name: '刷新账号列表', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接'); await expect(role).toHaveValue('reviewer');
  await expect(rowFor(page, user.username).getByRole('button', { name: '更新权限', exact: true })).toBeDisabled();
  const session: SessionInfo = await (await context.request.get('/api/v1/auth/me')).json();
  const changed = await context.request.put(`/api/v1/users/${user.id}`, { headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': session.csrfToken }, data: { role: 'editor', active: false, expectedRevision: 1 } });
  expect(changed.status()).toBe(200);
  await page.unroute('**/api/v1/users'); await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(rowFor(page, user.username)).toContainText('服务端已有新修订'); await expect(role).toHaveValue('reviewer');
  const conflict = page.waitForResponse((response) => response.url().endsWith(`/users/${user.id}`) && response.request().method() === 'PUT');
  page.once('dialog', (dialog) => dialog.accept()); await rowFor(page, user.username).getByRole('button', { name: '更新权限', exact: true }).click();
  expect((await conflict).status()).toBe(409); await expect(role).toHaveValue('reviewer');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-revision-conflict-mobile.png'), fullPage: true });
  await rowFor(page, user.username).getByRole('button', { name: '重新加载权限', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('account-revision-controls-mobile.png'), fullPage: true });
  await page.route('**/api/v1/users', (route) => route.request().method() === 'GET' ? route.abort() : route.continue());
  page.once('dialog', (dialog) => dialog.accept()); await rowFor(page, user.username).getByRole('button', { name: '重新加载权限', exact: true }).click();
  await expect(rowFor(page, user.username).getByRole('alert')).toContainText('无法连接'); await expect(role).toHaveValue('reviewer');
  await page.unroute('**/api/v1/users');
  page.once('dialog', (dialog) => dialog.accept()); await rowFor(page, user.username).getByRole('button', { name: '重新加载权限', exact: true }).click();
  await expect(role).toHaveValue('editor'); await expect(page.getByLabel(`${user.username}启用状态`, { exact: true })).not.toBeChecked();
  await expect(rowFor(page, user.username)).toContainText('修订 2');
});
