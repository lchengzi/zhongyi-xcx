import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { parseDraftDetail, parseManagedSource } from '../../shared/workflow-response';
import { parseAssistantQuota, parseExcerptList, parseSavedExcerpt, parseSavedPermission } from '../../shared/assistant-response';
import { parseSession } from '../../shared/auth-response';

const origin = 'http://127.0.0.1:4314', ingredient = 'lian-zi', base = `/api/v1/editorial/assistant/ingredients/${ingredient}`;
const listPattern = `**${base}/excerpts?**`, postPattern = `**${base}/excerpts`;
test.use({ baseURL: origin });
async function prepare(page: Page, context: BrowserContext) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill('browser-assistant-response-editor');
  await page.getByLabel('密码', { exact: true }).fill('test-only-assistant-response-editor-password-2026');
  await page.getByRole('button', { name: '登录工作台' }).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  const session = parseSession(await (await context.request.get('/api/v1/auth/me')).json()), headers = { Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const title = `摘录响应工程测试-${randomUUID()}`;
  const saved = await context.request.post('/api/v1/editorial/sources', { headers, data: { title, publisher: '仅工程测试', url: `https://example.org/assistant-response/${randomUUID()}` } });
  expect(saved.status()).toBe(201); const source = parseManagedSource(await saved.json());
  const detail = parseDraftDetail(await (await context.request.get(`/api/v1/editorial/ingredients/${ingredient}`)).json(), ingredient);
  const content = { ediblePart: '待核对（工程测试）', latinName: '', educationText: '原有私有工程测试说明，未采用辅助结果。', safetyText: '仅工程测试，未专业审校。', sourceRefs: [{ id: source.id, revision: source.revision, locator: '工程测试来源位置' }] };
  const draft = await context.request.put(`/api/v1/editorial/ingredients/${ingredient}`, { headers, data: { expectedLockVersion: detail.draft?.lockVersion ?? 0, content } });
  expect(draft.ok()).toBe(true);
  await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '内容修订', exact: true }).click();
  await page.getByLabel('搜索待编辑食材').fill('莲子'); await page.getByRole('button', { name: '编辑莲子内容', exact: true }).click();
  await expect(page.getByLabel('模型服务状态')).toContainText('测试模拟器');
  await page.getByText('登记新原文摘录', { exact: true }).click();
  const input = { sourceId: source.id, sourceRevision: source.revision, locator: `工程摘录-${randomUUID()}`, text: '工程测试原文：所列部位与加工形态均待核对。', allowExternal: true };
  await page.getByLabel('摘录固定来源').selectOption(`${source.id}:${source.revision}`); await page.getByLabel('摘录原文定位').fill(input.locator);
  await page.getByLabel('原文摘录文本').fill(input.text); await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  return { input, headers, content, username: session.user.username };
}
const save = (page: Page) => page.getByRole('button', { name: '保存私有摘录', exact: true });
const status = (page: Page) => page.getByRole('status', { name: '摘录辅助结果' });
async function verifySave(page: Page, accepted = true) {
  page.once('dialog', dialog => accepted ? dialog.accept() : dialog.dismiss()); await page.getByRole('button', { name: '核对摘录保存结果' }).click();
}
async function saveNormally(page: Page) { await save(page).click(); await expect(status(page)).toContainText('未发送给模型'); await expect(page.getByLabel('辅助调用额度')).toBeVisible(); }

test('malformed service, quota or foreign excerpt batches never become empty/unconfigured states; read retry preserves input', async ({ page, context }) => {
  const fixture = await prepare(page, context); await saveNormally(page);
  await page.getByLabel('原文摘录文本').fill('尚未保存的原文输入');
  let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes++; });
  const faults = [
    { pattern: '**/api/v1/editorial/assistant/config', alter: (value: Record<string, unknown>) => ({ ...value, provider: 'unknown' }) },
    { pattern: '**/api/v1/editorial/assistant/quota', alter: (value: Record<string, unknown>) => ({ ...value, activeTotal: -1 }) },
    { pattern: listPattern, alter: (value: Record<string, unknown>) => ({ ...value, items: [{ ...parseExcerptList(value, ingredient).items[0], ingredientId: 'jiang' }] }) }
  ];
  for (const fault of faults) {
    await page.route(fault.pattern, async route => { const response = await route.fetch(); await route.fulfill({ response, json: fault.alter(await response.json()) }); });
    await page.getByRole('button', { name: '刷新调用额度', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('数据格式无效');
    await expect(page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('辅助调用额度')).toHaveCount(0); await expect(page.getByLabel('模型服务状态')).toContainText('状态暂不可用');
    await expect(page.getByText('没有匹配摘录。', { exact: false })).toHaveCount(0); await expect(page.getByText('真实模型未配置，原文检索可用，外部调用关闭。')).toHaveCount(0);
    await expect(page.getByLabel('原文摘录文本')).toHaveValue('尚未保存的原文输入');
    await page.unroute(fault.pattern); await page.getByRole('button', { name: '重新读取摘录' }).click();
    await expect(page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true })).toBeVisible();
  }
  expect(writes).toBe(0);
});

test('a held old excerpt query cannot return across A to B to A, expose stale options or erase the unsaved input', async ({ page, context }) => {
  const fixture = await prepare(page, context); await saveNormally(page); await page.getByLabel('原文摘录文本').fill('检索变化时保留的输入');
  let release = () => {}, finished = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); const done = new Promise<void>(resolve => { finished = resolve; });
  let reads = 0, writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes++; });
  await page.route(listPattern, async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query !== fixture.input.locator || ++reads !== 1) { await route.continue(); return; }
    try { const response = await route.fetch(); await gate; await route.fulfill({ response, json: { items: [], limit: 50 } }); } finally { finished(); }
  });
  try {
    const search = page.getByLabel('检索原文摘录'); await search.fill(fixture.input.locator); await expect.poll(() => reads).toBe(1);
    await expect(page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true })).toHaveCount(0);
    await search.fill('不存在的工程定位'); await expect(page.getByText('没有匹配摘录。', { exact: false })).toBeVisible();
    await search.fill(fixture.input.locator); await expect(page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true })).toBeVisible();
    release(); await done; await expect(page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true })).toBeVisible();
    await expect(page.getByLabel('原文摘录文本')).toHaveValue('检索变化时保留的输入'); expect(writes).toBe(0);
  } finally { release(); await done; await page.unroute(listPattern); }
});

test('a committed excerpt with corrupt ACK submits once and stays locked across ordinary refresh, cancelled and invalid checks', async ({ page, context }, info) => {
  const fixture = await prepare(page, context); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`${base}/excerpts`)) posts++; });
  await page.route(postPattern, async route => { const response = await route.fetch(); const body = parseSavedExcerpt(await response.json(), ingredient, fixture.input, fixture.username); await route.fulfill({ response, json: { ...body, sourceRevision: body.sourceRevision + 1 } }); });
  await save(page).evaluate(button => { const form = button.closest('form'); if (!form) throw new Error('Expected form'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect(status(page)).toContainText('无法确认提交结果'); await expect(save(page)).toBeDisabled();
  await expect(page.getByLabel('原文摘录文本')).toHaveValue(fixture.input.text); expect(posts).toBe(1);
  const observed = parseExcerptList(await (await context.request.get(`${base}/excerpts?q=${encodeURIComponent(fixture.input.locator)}`)).json(), ingredient); expect(observed.items).toHaveLength(1);
  await page.getByRole('button', { name: '刷新调用额度', exact: true }).click(); await expect(page.getByLabel('辅助调用额度')).toBeVisible(); await expect(save(page)).toBeDisabled();
  await verifySave(page, false); await expect(save(page)).toBeDisabled();
  await page.route(listPattern, route => route.fulfill({ status: 200, json: { items: [], limit: '50' } }));
  await verifySave(page); await expect(status(page)).toContainText('数据格式无效'); await expect(save(page)).toBeDisabled();
  await page.unroute(listPattern); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const screenshot = info.outputPath('assistant-response-uncertain-narrow.png'); await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: screenshot }); await info.attach('assistant-response-uncertain-narrow', { path: screenshot, contentType: 'image/png' });
  await verifySave(page); await expect(status(page)).toContainText('不能证明原请求归属'); await expect(page.getByLabel('原文摘录文本')).toHaveValue(''); expect(posts).toBe(1);
});

test('an absent excerpt after an uncommitted save is only an observation; a new POST needs separate confirmation', async ({ page, context }) => {
  const fixture = await prepare(page, context); let posts = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`${base}/excerpts`)) posts++; });
  await page.route(postPattern, route => route.abort()); await save(page).click(); await expect(status(page)).toContainText('无法确认提交结果');
  await page.unroute(postPattern); await verifySave(page); await expect(status(page)).toContainText('当前检索窗口未找到'); await expect(save(page)).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await save(page).click(); expect(posts).toBe(1); await expect(page.getByLabel('原文摘录文本')).toHaveValue(fixture.input.text);
  page.once('dialog', dialog => dialog.accept()); await save(page).click(); await expect(status(page)).toContainText('未发送给模型'); expect(posts).toBe(2);
  expect(parseExcerptList(await (await context.request.get(`${base}/excerpts?q=${encodeURIComponent(fixture.input.locator)}`)).json(), ingredient).items).toHaveLength(1);
});

test('a committed permission with corrupt ACK cannot unlock on refresh or substituted fixed reads; deliberate valid read allows a new confirmed CAS', async ({ page, context }) => {
  const fixture = await prepare(page, context); await saveNormally(page);
  const previous = parseExcerptList(await (await context.request.get(`${base}/excerpts?q=${encodeURIComponent(fixture.input.locator)}`)).json(), ingredient).items[0];
  let puts = 0; const permissionPath = `/api/v1/editorial/assistant/excerpts/${previous.id}/permission`, fixedPattern = `**${base}/excerpts/${previous.id}`;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(permissionPath)) puts++; });
  await page.route(`**${permissionPath}`, async route => { const response = await route.fetch(); const current = parseSavedPermission(await response.json(), previous, false, fixture.username); await route.fulfill({ response, json: { ...current, text: '不可变原文被替换' } }); });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: `撤回外部许可 ${fixture.input.locator}`, exact: true }).click();
  await expect(status(page)).toContainText('无法确认提交结果'); await expect(page.getByRole('button', { name: `允许外部使用 ${fixture.input.locator}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '整理所选原文摘录', exact: true })).toBeDisabled();
  const current = parseExcerptList(await (await context.request.get(`${base}/excerpts?q=${encodeURIComponent(fixture.input.locator)}`)).json(), ingredient).items[0]; expect(current.allowExternal).toBe(true); expect(current.externalPermission.allowed).toBe(false); expect(current.externalPermission.revision).toBe(1);
  await page.getByRole('button', { name: '刷新调用额度', exact: true }).click(); await expect(page.getByLabel('辅助调用额度')).toBeVisible();
  await expect(page.getByRole('button', { name: `允许外部使用 ${fixture.input.locator}`, exact: true })).toBeDisabled();
  await page.route(fixedPattern, route => route.fulfill({ status: 200, json: { ...current, sourceRevision: current.sourceRevision + 1 } }));
  await page.getByRole('button', { name: '核对外发许可结果' }).click(); await expect(status(page)).toContainText('数据格式无效'); await expect(page.getByRole('button', { name: '核对外发许可结果' })).toBeVisible(); expect(puts).toBe(1);
  await page.unroute(fixedPattern); await page.unroute(`**${permissionPath}`); await page.getByRole('button', { name: '核对外发许可结果' }).click(); await expect(status(page)).toContainText('不能归因先前请求');
  const grant = page.getByRole('button', { name: `允许外部使用 ${fixture.input.locator}`, exact: true }); await expect(grant).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await grant.click(); expect(puts).toBe(1);
  page.once('dialog', dialog => dialog.accept()); await grant.click(); await expect(status(page)).toContainText('已登记新的外部使用许可'); expect(puts).toBe(2);
});

test('a later matching original record cannot erase inputs edited after an absence observation', async ({ page, context }) => {
  const fixture = await prepare(page, context); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`${base}/excerpts`)) posts++; });
  await page.route(postPattern, route => route.abort()); await save(page).click(); await expect(status(page)).toContainText('无法确认提交结果');
  await page.unroute(postPattern); await verifySave(page); await expect(status(page)).toContainText('当前检索窗口未找到');
  await page.getByLabel('原文摘录文本').fill('之后人工编辑的新输入，不应被旧摘录核对清空。');
  // Owned API fixture models an earlier intent appearing later; it does not
  // assert that a browser abort rolls back or that this was that request.
  const recorded = await context.request.post(`${base}/excerpts`, { headers: fixture.headers, data: fixture.input }); expect(recorded.status()).toBe(201);
  await verifySave(page); await expect(status(page)).toContainText('已保留后来编辑的新输入');
  await expect(page.getByLabel('原文摘录文本')).toHaveValue('之后人工编辑的新输入，不应被旧摘录核对清空。');
  await expect(save(page)).toBeEnabled(); expect(posts).toBe(1);
});

test('fresh fixed permission is checked again before adopting extraction; a changed or malformed read cannot modify the draft', async ({ page, context }) => {
  const fixture = await prepare(page, context); await saveNormally(page); await page.getByLabel(`选择摘录 ${fixture.input.locator}`, { exact: true }).check();
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '整理所选原文摘录', exact: true }).click();
  await expect(page.getByText('测试模拟结果 · 不代表真实 AI 验收', { exact: true })).toBeVisible();
  const excerpt = parseExcerptList(await (await context.request.get(`${base}/excerpts?q=${encodeURIComponent(fixture.input.locator)}`)).json(), ingredient).items[0];
  const beforeQuota = parseAssistantQuota(await (await context.request.get('/api/v1/editorial/assistant/quota')).json());
  const publicBefore: unknown = await (await context.request.get('/api/v1/public/catalog')).json(); let writes = 0; page.on('request', request => { if (request.method() !== 'GET') writes++; });
  const pattern = `**${base}/excerpts/${excerpt.id}`;
  await page.route(pattern, route => route.fulfill({ status: 200, json: { ...excerpt, digest: 'invalid' } }));
  await page.getByLabel('我已逐条对照原文，仅作为私有编辑参考，不是专业批准').check(); await page.getByRole('button', { name: '将核对摘录填入编辑输入（不自动保存）' }).click();
  await expect(status(page)).toContainText('数据格式无效'); await expect(page.getByLabel('草稿教育说明')).toHaveValue(fixture.content.educationText);
  await page.unroute(pattern);
  const changed = await context.request.put(`/api/v1/editorial/assistant/excerpts/${excerpt.id}/permission`, { headers: fixture.headers, data: { allowExternal: false, expectedRevision: 0 } }); expect(changed.ok()).toBe(true);
  await page.getByRole('button', { name: '将核对摘录填入编辑输入（不自动保存）' }).click(); await expect(status(page)).toContainText('许可已变化');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(fixture.content.educationText);
  const after = parseDraftDetail(await (await context.request.get(`/api/v1/editorial/ingredients/${ingredient}`)).json(), ingredient); expect(after.draft?.content).toEqual(fixture.content);
  expect(parseAssistantQuota(await (await context.request.get('/api/v1/editorial/assistant/quota')).json())).toEqual(beforeQuota);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(publicBefore); expect(writes).toBe(0);
});
