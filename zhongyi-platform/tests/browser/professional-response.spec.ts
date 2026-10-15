import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Account, SessionInfo } from '../../shared/contracts';

const origin = 'http://127.0.0.1:4314', password = 'test-only-professional-response-password-2026';
test.use({ baseURL: origin });
async function headers(context: BrowserContext) {
  const response = await context.request.get('/api/v1/auth/me'); expect(response.status()).toBe(200);
  const session: SessionInfo = await response.json(); return { Origin: origin, 'X-CSRF-Token': session.csrfToken };
}
async function open(page: Page, username = 'browser-admin', secret = 'test-only-admin-password-2026') {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '登录工作台' }).click(); await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click(); await page.getByRole('button', { name: '专业审校记录', exact: true }).click();
}
async function account(context: BrowserContext, prefix: string): Promise<Account> {
  const response = await context.request.post('/api/v1/users', { headers: await headers(context), data: { username: `${prefix}-${Date.now()}`, role: 'reviewer', password } });
  expect(response.status()).toBe(201); return await response.json();
}
const panel = (page: Page, name: string) => page.locator('section.professional-panel').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('qualification responses bind accounts and empty histories; a real committed write with a substituted acknowledgement stays locked until a valid read', async ({ page, context }) => {
  test.setTimeout(60000);
  await page.route('**/api/v1/users', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, items: [...body.items, body.items[0]] } }); });
  await open(page); const qualifications = panel(page, '专业资格核验记录');
  await expect(qualifications.getByRole('alert')).toContainText('数据格式无效'); await expect(qualifications.getByLabel('资格所属账号', { exact: true })).toHaveCount(0);
  const person = await account(context, 'qualification-response');
  const other = await account(context, 'qualification-new-target');
  const path = `**/api/v1/editorial/qualifications/${person.id}`;
  await page.unroute('**/api/v1/users');
  await page.route(path, async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, userId: 'wrong-empty-history-owner' } });
  });
  await qualifications.getByRole('button', { name: '刷新资格记录', exact: true }).click(); await qualifications.getByLabel('资格所属账号', { exact: true }).selectOption(person.id);
  await expect(qualifications.getByRole('alert')).toContainText('数据格式无效'); await expect(qualifications.getByRole('heading', { name: '最近资格版本', exact: true })).toHaveCount(0);
  await page.unroute(path); await qualifications.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(qualifications.getByLabel('内部核验依据编号', { exact: true })).toBeEnabled();
  await qualifications.getByLabel('资格依据类型', { exact: true }).selectOption('test-fixture'); await qualifications.getByLabel('内部核验依据编号', { exact: true }).fill('response-test-only');
  await qualifications.getByLabel('核验有效截止时间UTC', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  const comment = '真实写入工程夹具后回执损坏，保留输入并核对。';
  await qualifications.getByLabel('资格核验说明', { exact: true }).fill(comment); await qualifications.getByLabel('确认已核对资格依据', { exact: true }).check();
  let writes = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/editorial/qualifications/${person.id}`)) writes++; });
  await page.route(path, async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: route.request().method() === 'POST' ? { ...body, comment: 'substituted acknowledgement' } : body });
  });
  await qualifications.getByRole('button', { name: '保存资格记录', exact: true }).click();
  await expect(qualifications.getByRole('status', { name: '资格保存结果' })).toContainText('先重新读取核对');
  await expect(qualifications.getByLabel('资格核验说明', { exact: true })).toHaveValue(comment);
  await expect(qualifications.getByRole('button', { name: '保存资格记录', exact: true })).toBeDisabled();
  await expect(qualifications.getByRole('heading', { name: '最近资格版本', exact: true })).toHaveCount(0);
  const committed = await (await context.request.get(`/api/v1/editorial/qualifications/${person.id}`)).json(); expect(committed.items[0].comment).toBe(comment); expect(committed.items[0].revision).toBe(1); expect(writes).toBe(1);
  await page.unroute(path); await page.route(path, route => route.fulfill({ json: { userId: 'wrong-owner', items: [] } }));
  page.once('dialog', dialog => dialog.accept()); await qualifications.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(qualifications.getByRole('alert')).toContainText('数据格式无效'); await expect(qualifications.getByRole('button', { name: '保存资格记录', exact: true })).toBeDisabled();
  await expect(qualifications.getByLabel('资格核验说明', { exact: true })).toHaveValue(comment); expect(writes).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('qualification-response-uncertain-narrow.png'), fullPage: true });
  await page.unroute(path); page.once('dialog', dialog => dialog.accept()); await qualifications.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(qualifications.getByText('修订 1 · 中医师 · 已记录核验', { exact: true })).toBeVisible(); await expect(qualifications.getByLabel('资格核验说明', { exact: true })).toHaveValue('');
  await qualifications.getByLabel('资格状态', { exact: true }).selectOption('revoked'); await qualifications.getByLabel('资格核验说明', { exact: true }).fill('明确核对后的手动撤销，仅测试。');
  await qualifications.getByRole('button', { name: '保存资格记录', exact: true }).click(); await expect(qualifications.getByText('修订 2 · 中医师 · 已撤销', { exact: true })).toBeVisible(); expect(writes).toBe(2);
  await qualifications.getByLabel('资格核验说明', { exact: true }).fill('旧账号未保存的文字，不应出现在新账号下。');
  const otherPath = `**/api/v1/editorial/qualifications/${other.id}`;
  await page.route(otherPath, route => route.fulfill({ json: { userId: person.id, items: [] } }));
  page.once('dialog', dialog => dialog.accept()); await qualifications.getByLabel('资格所属账号', { exact: true }).selectOption(other.id);
  await expect(qualifications.getByRole('alert')).toContainText('数据格式无效');
  await expect(qualifications.getByLabel('资格核验说明', { exact: true })).toHaveValue('');
  await expect(qualifications.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('');
  await expect(qualifications.getByRole('button', { name: '保存资格记录', exact: true })).toBeDisabled();
  await expect(qualifications.getByRole('heading', { name: '最近资格版本', exact: true })).toHaveCount(0);
  await page.unroute(otherPath); await qualifications.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(qualifications.getByLabel('内部核验依据编号', { exact: true })).toBeEnabled(); expect(writes).toBe(2);
});

test('professional reads bind draft and own qualification; a corrupted committed opinion keeps input and cannot resubmit until both reads validate', async ({ page, context, browser }) => {
  test.setTimeout(60000); await open(page);
  const publicBefore = await (await context.request.get('/api/v1/public/catalog')).json();
  const physician = await account(context, 'professional-response'), editorial = await account(context, 'professional-editorial');
  const adminHeaders = await headers(context);
  const granted = await context.request.post(`/api/v1/editorial/qualifications/${physician.id}`, { headers: adminHeaders, data: { expectedRevision: 0, qualification: { profession: 'tcm_physician', status: 'verified', evidenceKind: 'test-fixture', evidenceReference: 'engineering-response-only', validUntil: new Date(Date.now() + 86400000).toISOString(), comment: '仅工程模拟，无真实资格。', verificationConfirmed: true } } }); expect(granted.status()).toBe(201);
  const created = await context.request.post('/api/v1/editorial/sources', { headers: adminHeaders, data: { title: '专业响应工程来源', publisher: '仅测试机构', url: 'https://example.org/professional-response' } }); expect(created.status()).toBe(201); const source = await created.json();
  const saved = await context.request.put('/api/v1/editorial/ingredients/ge-gen', { headers: adminHeaders, data: { expectedLockVersion: 0, content: { ediblePart: '仅测试部位', latinName: '', educationText: '非专业资料，仅验证专业回执链路。', safetyText: '不用于诊疗。', sourceRefs: [{ id: source.id, revision: 1, locator: '测试第一段' }] } } }); expect(saved.status()).toBe(200); const draft = await saved.json();
  const submitted = await context.request.post('/api/v1/editorial/ingredients/ge-gen/submit', { headers: adminHeaders, data: { expectedLockVersion: draft.lockVersion } }); expect(submitted.status()).toBe(200); const task = await submitted.json();
  const editorContext = await browser.newContext({ baseURL: origin }), professional = await browser.newContext({ baseURL: origin });
  try {
    expect((await editorContext.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: editorial.username, password } })).status()).toBe(200);
    expect((await editorContext.request.post(`/api/v1/editorial/tasks/${task.task.id}/decision`, { headers: await headers(editorContext), data: { decision: 'accept', comment: '仅工程编辑审阅。', expectedLockVersion: task.draft.lockVersion } })).status()).toBe(200);
    const review = await professional.newPage(); await open(review, physician.username, password); const desk = panel(review, '固定版本专业审校');
    const path = '**/api/v1/editorial/professional/ge-gen', credentials = `**/api/v1/editorial/qualifications/${physician.id}`;
    await review.route(path, async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, ingredientId: 'jiang' } }); });
    await desk.getByLabel('搜索待专业审校食材', { exact: true }).fill('葛根'); await desk.getByRole('button', { name: '查看葛根专业审校', exact: true }).click();
    await expect(desk.getByRole('alert')).toContainText('数据格式无效'); await expect(desk.getByLabel('专业审校状态', { exact: true })).toHaveCount(0);
    await review.unroute(path); await desk.getByRole('button', { name: '刷新专业审校', exact: true }).click(); await expect(desk.getByLabel('专业审校状态', { exact: true })).toBeVisible();
    const comment = '回执损坏不能重复签审；仅工程测试意见。'; await desk.getByLabel('专业审校意见', { exact: true }).fill(comment);
    let writes = 0; review.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/editorial/professional/ge-gen')) writes++; });
    await review.route(path, async route => {
      const response = await route.fetch(); const body = await response.json(); expect(response.status()).toBe(200);
      await route.fulfill({ response, json: { ...body, reviews: [{ ...body.reviews[0], comment: 'substituted opinion' }, ...body.reviews.slice(1)], latestReviews: body.latestReviews.map((item: { profession: string }) => item.profession === 'tcm_physician' ? { ...item, comment: 'substituted opinion' } : item) } });
    });
    await desk.getByRole('button', { name: '记录专业通过（不发布）', exact: true }).click();
    await expect(desk.getByRole('status', { name: '专业审校结果' })).toContainText('先重新读取核对'); await expect(desk.getByLabel('专业审校意见', { exact: true })).toHaveValue(comment);
    await expect(desk.getByRole('button', { name: '记录专业通过（不发布）', exact: true })).toBeDisabled(); await expect(desk.getByLabel('专业审校状态', { exact: true })).toHaveCount(0);
    const committed = await (await professional.request.get('/api/v1/editorial/professional/ge-gen')).json(); expect(committed.reviewVersion).toBe(1); expect(committed.reviews[0].comment).toBe(comment); expect(writes).toBe(1);
    await review.unroute(path); await review.route(credentials, route => route.fulfill({ json: { userId: 'wrong-current-user', items: [] } }));
    review.once('dialog', dialog => dialog.accept()); await desk.getByRole('button', { name: '刷新专业审校', exact: true }).click();
    await expect(desk.getByRole('alert')).toContainText('数据格式无效'); await expect(desk.getByLabel('专业审校意见', { exact: true })).toHaveValue(comment);
    await expect(desk.getByRole('button', { name: '撤销该专业意见', exact: true })).toBeDisabled(); expect(writes).toBe(1);
    await review.setViewportSize({ width: 390, height: 844 }); expect(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review.screenshot({ path: test.info().outputPath('professional-response-uncertain-narrow.png'), fullPage: true });
    await review.unroute(credentials); review.once('dialog', dialog => dialog.accept()); await desk.getByRole('button', { name: '刷新专业审校', exact: true }).click();
    await expect(desk.getByText(comment, { exact: true })).toBeVisible(); await expect(desk.getByLabel('专业审校意见', { exact: true })).toHaveValue('');
    await desk.getByLabel('专业审校意见', { exact: true }).fill('核对后手动撤销工程意见。'); await desk.getByRole('button', { name: '撤销该专业意见', exact: true }).click();
    await expect(desk.getByRole('status', { name: '专业审校结果' })).toContainText('未发布任何内容'); expect(writes).toBe(2);
    expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(publicBefore);
  } finally { await editorContext.close(); await professional.close(); }
});
