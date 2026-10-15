import { test, expect, type Page } from '@playwright/test';
import { parseSession } from '../../shared/auth-response';

const origin = 'http://127.0.0.1:4314', username = 'browser-auth-editor', password = 'test-only-auth-editor-password-2026';
test.use({ baseURL: origin });
async function form(page: Page) {
  await page.goto('/'); await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
  await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(password);
}
const login = (page: Page) => page.getByRole('button', { name: '登录工作台' });
async function enter(page: Page) { await form(page); await login(page).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible(); }
async function dirtyNote(page: Page) {
  await page.getByLabel('搜索食材', { exact: true }).fill('黄芪'); await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await page.getByLabel('编辑备注', { exact: true }).fill('退出结果不确定时保留的工程输入');
}
async function checkLogout(page: Page, accept = true) {
  page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss()); await page.getByRole('button', { name: '核对退出状态', exact: true }).click();
}

test('malformed configuration or restored session never selects a login fallback or enters a workspace; retry is read-only', async ({ page }) => {
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes += 1; });
  await page.route('**/api/v1/auth/config', route => route.fulfill({ status: 200, json: { mode: 'unexpected' } }));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await expect(page.getByLabel('用户名', { exact: true })).toHaveCount(0); await expect(page.getByLabel('本地编辑密钥')).toHaveCount(0);
  await page.unroute('**/api/v1/auth/config'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 200, json: { user: { role: 'admin' }, csrfToken: 'bad', expiresAt: 'invalid' } }));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await expect(page.getByLabel('用户名', { exact: true })).toHaveCount(0); await expect(page.getByLabel('搜索食材', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/auth/me'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByLabel('用户名', { exact: true })).toBeVisible(); expect(writes).toBe(0);
});

test('real committed login with mismatched receipt retains credentials and submits once; only a valid explicit session read enters', async ({ page, context }) => {
  await form(page); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/auth/login')) posts += 1; });
  await page.route('**/api/v1/auth/login', async route => {
    const response = await route.fetch(); const info = parseSession(await response.json());
    await route.fulfill({ response, json: { ...info, user: { ...info.user, username: 'unrelated-account' } } });
  });
  await page.locator('form').evaluate(element => { element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果'); await expect(login(page)).toBeDisabled();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password); await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(username);
  await expect(page.getByLabel('搜索食材', { exact: true })).toHaveCount(0); expect(posts).toBe(1);
  expect(parseSession(await (await context.request.get('/api/v1/auth/me')).json()).user.username).toBe(username);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 200, json: { user: {} } }));
  await page.getByRole('button', { name: '核对登录状态' }).click(); await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await expect(login(page)).toBeDisabled(); await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password);
  await page.unroute('**/api/v1/auth/me'); await page.getByRole('button', { name: '核对登录状态' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible(); expect(posts).toBe(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0); expect(await page.evaluate(() => document.cookie.includes('food_session'))).toBe(false);
});

test('an absent session after an uncommitted login is an observation; another login requires a separate confirmation', async ({ page }) => {
  await form(page); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/auth/login')) posts += 1; });
  await page.route('**/api/v1/auth/login', route => route.abort()); await login(page).click();
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果'); await expect(login(page)).toBeDisabled();
  await page.unroute('**/api/v1/auth/login'); await page.getByRole('button', { name: '核对登录状态' }).click();
  await expect(page.getByRole('alert')).toContainText('当前未查到有效会话'); await expect(login(page)).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await login(page).click(); expect(posts).toBe(1); await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password);
  page.once('dialog', dialog => dialog.accept()); await login(page).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible(); expect(posts).toBe(2);
});

test('another valid browser session cannot be adopted as the unknown login; a confirmed new login rotates it', async ({ page, context }) => {
  await form(page); await page.route('**/api/v1/auth/login', route => route.abort()); await login(page).click();
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果'); await page.unroute('**/api/v1/auth/login');
  const other = await context.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: 'browser-auth-reviewer', password: 'test-only-auth-reviewer-password-2026' } });
  expect(other.ok()).toBe(true); const previousCookie = (await context.cookies()).find(cookie => cookie.name === 'food_session'); expect(previousCookie).toBeTruthy();
  await page.getByRole('button', { name: '核对登录状态' }).click(); await expect(page.getByRole('alert')).toContainText('与本次登录账号不同');
  await expect(page.getByLabel('搜索食材', { exact: true })).toHaveCount(0); await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password);
  page.once('dialog', dialog => dialog.accept()); await login(page).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  const info = parseSession(await (await context.request.get('/api/v1/auth/me')).json()); expect(info.user.username).toBe(username);
  if (!previousCookie) throw new Error('Expected test-only cookie');
  expect((await context.request.get('/api/v1/auth/me', { headers: { Cookie: `food_session=${previousCookie.value}` } })).status()).toBe(401);
});

test('committed logout with malformed receipt keeps unsent input; invalid and cancelled checks cannot leave the workspace', async ({ page, context }, info) => {
  await enter(page); await dirtyNote(page); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/auth/logout')) posts += 1; });
  await page.route('**/api/v1/auth/logout', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ok: false } }); });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果'); await expect(page.getByRole('button', { name: '退出工作台' })).toBeDisabled();
  await expect(page.getByLabel('编辑备注', { exact: true })).toHaveValue('退出结果不确定时保留的工程输入'); expect(posts).toBe(1);
  expect((await context.request.get('/api/v1/auth/me')).status()).toBe(401);
  await checkLogout(page, false); await expect(page.getByLabel('编辑备注', { exact: true })).toBeVisible();
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 200, json: { invalid: true } }));
  await checkLogout(page); await expect(page.getByRole('alert')).toContainText('数据格式无效'); await expect(page.getByRole('button', { name: '退出工作台' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '查看黄芪', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '目录读取失败', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('auth-response-uncertain-logout-narrow', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.unroute('**/api/v1/auth/me'); await checkLogout(page); await expect(page.getByLabel('密码', { exact: true })).toBeVisible(); expect(posts).toBe(1);
});

test('uncommitted logout must be checked against the same retained session before a separately confirmed retry', async ({ page, context }) => {
  await enter(page); await dirtyNote(page); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/auth/logout')) posts += 1; });
  await page.route('**/api/v1/auth/logout', route => route.abort()); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果');
  await page.unroute('**/api/v1/auth/logout'); await checkLogout(page); await expect(page.getByRole('alert')).toContainText('当前会话仍有效');
  await expect(page.getByLabel('编辑备注', { exact: true })).toHaveValue('退出结果不确定时保留的工程输入');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '退出工作台' }).click(); expect(posts).toBe(1);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible(); expect(posts).toBe(2); expect((await context.request.get('/api/v1/auth/me')).status()).toBe(401);
});
