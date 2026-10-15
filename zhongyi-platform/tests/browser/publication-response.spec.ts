import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { fixturePassword } from '../migration-fixture';

const origin = 'http://127.0.0.1:4315', path = '/api/v1/editorial/publications/huang-qi';
const details = /\/api\/v1\/editorial\/publications\/huang-qi(?:\/versions\/\d+)?$/;
test.use({ baseURL: origin });
async function login(page: Page, username: string) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
  await page.getByRole('button', { name: '登录工作台' }).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '固定版本发布', exact: true }).click();
}
async function open(page: Page, username: string) { await login(page, username); await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click(); await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible(); }
async function fill(page: Page, text = 'ENGINEERING_SIMULATION_NOT_REAL：损坏回执时保留本次输入。', control = false) {
  await page.getByLabel('发布操作说明', { exact: true }).fill(text); if (control) await page.getByLabel('恢复或冻结核对编号', { exact: true }).fill('ENGINEERING_SIMULATION_NOT_REAL');
  await page.getByLabel('确认已核对发布依据', { exact: true }).check(); return text;
}
async function click(page: Page, name: string) { page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name, exact: true }).click(); }
async function reload(page: Page, dirty = true) { if (dirty) page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '重新加载发布状态', exact: true }).click(); }
const workspace = async (context: BrowserContext) => { const response = await context.request.get(path); expect(response.status()).toBe(200); return await response.json(); };

test('publication pickers and workspace reject malformed successful data, private qualification leakage and an omitted focused historical snapshot', async ({ page, context }) => {
  await page.route('**/api/v1/ingredients?**', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, total: '3' } }); });
  await login(page, 'publication-ui-editor'); await expect(page.getByRole('button', { name: '重试食材列表', exact: true })).toBeVisible();
  await expect(page.getByLabel('发布食材结果数量', { exact: true })).toHaveText('结果数量暂不可用'); await expect(page.getByRole('button', { name: /^管理.+发布$/ })).toHaveCount(0);
  await page.unroute('**/api/v1/ingredients?**'); await page.getByRole('button', { name: '重试食材列表', exact: true }).click();
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes++; });
  const before = await workspace(context);
  await page.route(details, async route => {
    const response = await route.fetch(); const body = await response.json(); body.snapshots[0].basis.qualifications[0].evidenceReference = 'PRIVATE-RESPONSE-MUST-NOT-PASS'; await route.fulfill({ response, json: body });
  });
  await page.getByRole('button', { name: '管理黄芪发布', exact: true }).click(); await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('数据格式无效');
  await expect(page.getByLabel('教育发布状态', { exact: true })).toHaveCount(0); await expect(page.getByText('PRIVATE-RESPONSE-MUST-NOT-PASS', { exact: true })).toHaveCount(0);
  await page.unroute(details); await reload(page, false); await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
  await page.getByLabel('发布操作说明', { exact: true }).fill('历史读取失败仍保留当前说明。'); await page.getByLabel('更早快照版本', { exact: true }).fill('1');
  await page.route(`**${path}/versions/1`, async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, snapshots: body.snapshots.filter((item: { version: number }) => item.version !== 1) } });
  });
  await click(page, '读取历史快照版本'); await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('数据格式无效');
  await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('历史读取失败仍保留当前说明。'); await expect(page.getByLabel('固定快照内容', { exact: true })).toHaveCount(0);
  await page.unroute(`**${path}/versions/1`); await reload(page); await expect(page.getByLabel('教育发布状态', { exact: true })).toBeVisible();
  expect(writes).toBe(0); expect(await workspace(context)).toEqual(before);
});

test('real snapshot, control, approval and publication writes with corrupt acknowledgements stay uncertain, submit once and recover only through valid deliberate reads', async ({ page, browser, context }) => {
  test.setTimeout(90000); const catalogBefore = await (await context.request.get('/api/v1/public/catalog')).text();
  await open(page, 'migration-editor'); const original = await workspace(context); const comment = await fill(page);
  let snapshots = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`${path}/snapshots`)) snapshots++; });
  await page.route(`**${path}/snapshots`, async route => { const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json(); await route.fulfill({ response, json: { ...body, version: body.version + 1 } }); });
  await click(page, '生成固定快照'); await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('无法确认提交结果');
  await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue(comment); await expect(page.getByRole('button', { name: '生成固定快照', exact: true })).toBeDisabled();
  await expect(page.getByLabel('教育发布状态', { exact: true })).toHaveCount(0);
  const committed = await workspace(context); expect(committed.snapshots[0].version).toBe(original.snapshots[0].version + 1); expect(committed.snapshots[0].comment).toBe(comment); expect(snapshots).toBe(1);
  await page.unroute(`**${path}/snapshots`); await page.route(details, async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, ingredientId: 'jiang' } }); });
  await reload(page); await expect(page.getByLabel('发布操作错误', { exact: true })).toContainText('数据格式无效'); await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue(comment); expect(snapshots).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await test.info().attach('publication-response-uncertain-narrow', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.unroute(details); await reload(page); await expect(page.getByLabel('发布操作说明', { exact: true })).toHaveValue('');
  expect(snapshots).toBe(1);
  const adminContext = await browser.newContext({ baseURL: origin }), approverContext = await browser.newContext({ baseURL: origin });
  try {
    const admin = await adminContext.newPage(); await open(admin, 'publication-ui-admin'); const controlComment = await fill(admin, 'ENGINEERING_SIMULATION_NOT_REAL：冻结回执核对。', true);
    let controls = 0; admin.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/editorial/publication-controls')) controls++; });
    await admin.route('**/api/v1/editorial/publication-controls', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json(); await route.fulfill({ response, json: { ...body, evidenceReference: 'substituted' } });
    });
    const controlBefore = (await workspace(adminContext)).control.version;
    await click(admin, '冻结全部教育发布'); await expect(admin.getByLabel('发布操作错误', { exact: true })).toContainText('无法确认提交结果');
    await expect(admin.getByLabel('发布操作说明', { exact: true })).toHaveValue(controlComment); await expect(admin.getByRole('button', { name: '冻结全部教育发布', exact: true })).toBeDisabled();
    expect((await workspace(adminContext)).control.version).toBe(controlBefore + 1); expect(controls).toBe(1);
    await admin.unroute('**/api/v1/editorial/publication-controls'); await reload(admin); await expect(admin.getByLabel('教育发布状态', { exact: true })).toBeVisible();
    await fill(admin, 'ENGINEERING_SIMULATION_NOT_REAL：核对后恢复，不自动发布。', true); await click(admin, '恢复发布操作'); await expect(admin.getByLabel('发布操作结果', { exact: true })).toContainText('已记录'); expect(controls).toBe(2);
    expect((await context.request.get('/api/v1/public/education/huang-qi')).status()).toBe(404);
    const approver = await approverContext.newPage(); await open(approver, 'publication-approver');
    await approver.getByLabel('固定快照版本', { exact: true }).selectOption(committed.snapshots[0].id); const approvalComment = await fill(approver, 'ENGINEERING_SIMULATION_NOT_REAL：批准回执核对。');
    let approvals = 0, actions = 0; approver.on('request', request => { if (request.method() === 'POST') { if (request.url().endsWith(`${path}/approvals`)) approvals++; if (request.url().endsWith(`${path}/actions`)) actions++; } });
    await approver.route(`**${path}/approvals`, async route => { const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json(); await route.fulfill({ response, json: { ...body, version: body.version + 1 } }); });
    await click(approver, '批准此快照'); await expect(approver.getByLabel('发布操作错误', { exact: true })).toContainText('无法确认提交结果');
    await expect(approver.getByLabel('发布操作说明', { exact: true })).toHaveValue(approvalComment); expect(approvals).toBe(1); expect(actions).toBe(0);
    expect((await workspace(approverContext)).approvals.find((item: { snapshotId: string }) => item.snapshotId === committed.snapshots[0].id).version).toBe(1);
    expect((await context.request.get('/api/v1/public/education/huang-qi')).status()).toBe(404);
    await approver.unroute(`**${path}/approvals`); await reload(approver); await expect(approver.getByLabel('快照批准状态', { exact: true })).toContainText('批准记录 1');
    const publicationComment = await fill(approver, 'ENGINEERING_SIMULATION_NOT_REAL：已落库发布的回执损坏。');
    await approver.route(`**${path}/actions`, async route => { const response = await route.fetch(); expect(response.status()).toBe(201); const body = await response.json(); await route.fulfill({ response, json: { ...body, previousDigest: `sha256:${'a'.repeat(64)}` } }); });
    await click(approver, '发布此快照'); await expect(approver.getByLabel('发布操作错误', { exact: true })).toContainText('无法确认提交结果');
    await expect(approver.getByLabel('发布操作说明', { exact: true })).toHaveValue(publicationComment); await expect(approver.getByRole('button', { name: '发布此快照', exact: true })).toBeDisabled(); expect(actions).toBe(1);
    const published = await context.request.get('/api/v1/public/education/huang-qi'); expect(published.status()).toBe(200); expect((await published.json()).snapshotVersion).toBe(committed.snapshots[0].version);
    await approver.unroute(`**${path}/actions`); await reload(approver); await expect(approver.getByLabel('教育发布状态', { exact: true })).toContainText(`当前有效快照 ${committed.snapshots[0].version}`);
    await fill(approver, 'ENGINEERING_SIMULATION_NOT_REAL：核对后手动撤回。'); await click(approver, '撤回当前发布'); await expect(approver.getByLabel('发布操作结果', { exact: true })).toContainText('已记录'); expect(actions).toBe(2);
    await fill(approver, 'ENGINEERING_SIMULATION_NOT_REAL：手动撤销批准。'); await click(approver, '撤销此批准'); await expect(approver.getByLabel('快照批准状态', { exact: true })).toContainText('已撤销批准'); expect(approvals).toBe(2);
    expect((await context.request.get('/api/v1/public/education/huang-qi')).status()).toBe(404); expect(await (await context.request.get('/api/v1/public/catalog')).text()).toBe(catalogBefore);
  } finally { await adminContext.close(); await approverContext.close(); }
});
