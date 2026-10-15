import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function login(page: Page, role: 'admin' | 'editor' | 'reviewer') {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(`browser-${role}`);
  await page.getByLabel('密码', { exact: true }).fill(`test-only-${role}-password-2026`);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
}

test('account session restores on refresh, records editor actor, logout revokes session', async ({ page, context }) => {
  await login(page, 'editor');
  const cookies = await context.cookies(); const sessionCookie = cookies.find((item) => item.name === 'food_session')!;
  expect(sessionCookie.httpOnly).toBe(true); expect(sessionCookie.sameSite).toBe('Strict');
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const text = `账号闭环测试-${Date.now()}`;
  await page.getByRole('textbox', { name: '编辑备注', exact: true }).fill(text);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('已保存');
  await page.reload(); await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '编辑备注', exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'browser-editor', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.cookie.includes('food_session'))).toBe(false);
  await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
  expect((await context.request.get('/api/v1/auth/me')).status()).toBe(401);
  await page.reload(); await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
});

test('reviewer UI is readonly and crafted HTTP writes/admin queries are forbidden', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page, 'reviewer');
  await expect(page.getByRole('button', { name: '账号权限', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '编辑备注', exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '保存备注', exact: true })).toBeDisabled();
  const info = await (await context.request.get('/api/v1/auth/me')).json();
  expect((await context.request.put('/api/v1/ingredients/huang-qi/note', { headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': info.csrfToken }, data: { text: 'should not save', expectedRevision: 0 } })).status()).toBe(403);
  expect((await context.request.get('/api/v1/users')).status()).toBe(403);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-reviewer-mobile.png'), fullPage: true });
});

test('administrator creates user, changes permissions and disables account via actual UI', async ({ page }) => {
  await login(page, 'admin'); await page.getByRole('button', { name: '账号权限', exact: true }).click();
  const username = `test-user-${Date.now()}`;
  await page.getByRole('textbox', { name: '新账号用户名' }).fill(username);
  await page.getByLabel('新账号初始密码').fill('test-only-created-password-2026');
  await page.getByLabel('新账号角色').selectOption('editor');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByRole('status', { name: '账号创建结果' })).toContainText('账号已创建');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell').filter({ hasText: username }) }).first();
  await row.getByRole('combobox').selectOption('reviewer');
  page.once('dialog', (dialog) => dialog.accept()); await row.getByRole('button', { name: '更新权限' }).click();
  await expect(row).toContainText('修订 2');
  await row.getByRole('checkbox').uncheck();
  page.once('dialog', (dialog) => dialog.accept()); await row.getByRole('button', { name: '更新权限' }).click();
  await expect(row).toContainText('修订 3'); await expect(row.getByRole('checkbox')).not.toBeChecked();
  const own = page.getByRole('row').filter({ hasText: 'browser-admin（当前账号）' });
  await expect(own.getByRole('combobox')).toBeDisabled();
  await expect(page.getByLabel('新账号初始密码')).toHaveValue('');
  await page.screenshot({ path: test.info().outputPath('account-admin-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('account-admin-mobile.png'), fullPage: true });
});

test('server-revoked session preserves unsaved draft and failed logout does not pretend success', async ({ page, context }) => {
  await login(page, 'editor');
  await page.getByRole('textbox', { name: '搜索食材' }).fill('黄芪');
  await page.getByRole('button', { name: '查看黄芪', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '编辑备注', exact: true });
  await editor.fill('会话失效时仍保留的未保存输入');
  await page.route('**/api/v1/auth/logout', (route) => route.abort());
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '退出工作台' }).click();
  await expect(page.getByRole('alert')).toContainText('无法确认提交结果');
  await expect(page.getByRole('alert')).toContainText('先重新读取核对');
  await expect(editor).toHaveValue('会话失效时仍保留的未保存输入');
  await page.unroute('**/api/v1/auth/logout');
  const info = await (await context.request.get('/api/v1/auth/me')).json();
  expect((await context.request.post('/api/v1/auth/logout', { headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': info.csrfToken } })).status()).toBe(200);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByRole('status', { name: '备注保存结果' })).toContainText('会话已失效');
  await expect(editor).toHaveValue('会话失效时仍保留的未保存输入');
  await expect(page.getByRole('button', { name: '退出工作台' })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '核对退出状态' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
});
