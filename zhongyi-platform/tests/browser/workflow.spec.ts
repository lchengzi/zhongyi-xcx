import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function login(page: Page, role: 'admin' | 'editor' | 'reviewer') {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(`browser-${role}`);
  await page.getByLabel('密码', { exact: true }).fill(`test-only-${role}-password-2026`);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
}
async function enter(page: Page) { await page.getByRole('button', { name: '内容协作', exact: true }).click(); }
async function createSource(page: Page, title: string) {
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await page.getByLabel('来源标题', { exact: true }).fill(title);
  await page.getByLabel('来源发布机构').fill('浏览器测试机构');
  await page.getByLabel('来源原始网址').fill(`https://example.org/${encodeURIComponent(title)}`);
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存');
}
async function chooseIngredient(page: Page, name: string) {
  await page.getByRole('button', { name: '内容修订', exact: true }).click();
  await page.getByLabel('搜索待编辑食材').fill(name);
  await page.getByRole('button', { name: `编辑${name}内容`, exact: true }).click();
  await expect(page.getByLabel('草稿教育说明')).toBeVisible();
}
async function addSource(page: Page, title: string) {
  await page.getByLabel('搜索可引用来源').fill(title);
  await page.getByRole('button', { name: '引用此来源', exact: true }).click();
  await page.getByLabel(`${title}的原文定位`).fill('第 2 页，食材身份段落（仅测试）');
}

test('actual editor→reviewer return→revision→accept cycle preserves private boundary and snapshots', async ({ page, browser, context }) => {
  const publicBefore = await (await context.request.get('/api/v1/public/catalog')).json();
  const title = `浏览器来源闭环-${Date.now()}`; const original = '原始测试教育说明，非正式材料。';
  await login(page, 'editor'); await enter(page); await createSource(page, title); await chooseIngredient(page, '黄芪');
  await page.getByLabel('草稿教育说明').fill(original); await page.getByLabel('草稿安全边界').fill('仅测试资料，不用于诊疗。');
  await addSource(page, title); await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  await page.getByRole('button', { name: '提交编辑审阅', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已提交编辑审阅');
  await expect(page.getByLabel('草稿教育说明')).toHaveAttribute('readonly', '');
  await page.screenshot({ path: test.info().outputPath('workflow-submitted-desktop.png'), fullPage: true });

  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4312', viewport: { width: 1440, height: 1000 } });
  try {
    const review = await reviewerContext.newPage(); await login(review, 'reviewer'); await enter(review);
    await review.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
    await review.getByRole('button', { name: '审阅黄芪修订1', exact: true }).click();
    await expect(review.getByText(original, { exact: true })).toBeVisible();
    await review.getByLabel('编辑审阅意见').fill('请补充更具体的原文位置（测试审阅，非专业签审）。');
    await review.route('**/api/v1/editorial/ingredients/huang-qi/revisions/1', async route => {
      const response = await route.fetch(); const revision = await response.json();
      await route.fulfill({ json: { ...revision, sources: [] } });
    });
    review.once('dialog', dialog => dialog.accept()); await review.getByRole('button', { name: '重新加载任务', exact: true }).click();
    await expect(review.getByLabel('固定来源 1', { exact: true }).getByRole('alert')).toBeVisible();
    await review.getByLabel('编辑审阅意见').fill('固定来源缺失，需先补充；仅工程测试。');
    await expect(review.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true })).toBeDisabled();
    await expect(review.getByRole('button', { name: '退回修改', exact: true })).toBeEnabled();
    await review.unroute('**/api/v1/editorial/ingredients/huang-qi/revisions/1');
    review.once('dialog', dialog => dialog.accept()); await review.getByRole('button', { name: '重新加载任务', exact: true }).click();
    await review.getByLabel('编辑审阅意见').fill('请补充更具体的原文位置（测试审阅，非专业签审）。');
    await review.getByRole('button', { name: '退回修改', exact: true }).click();
    await expect(review.getByRole('status', { name: '编辑审阅结果' })).toContainText('已退回');

    await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
    await expect(page.getByText('已退回待修订', { exact: true })).toBeVisible();
    await expect(page.getByText('请补充更具体的原文位置（测试审阅，非专业签审）。', { exact: true })).toBeVisible();
    await page.getByLabel('草稿教育说明').fill('修订后的测试说明，仍为待专业审校资料。');
    await page.getByLabel(`${title}的原文定位`).fill('第 2 页第 3 段（仅测试）');
    await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
    await page.getByRole('button', { name: '提交编辑审阅', exact: true }).click();
    await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已提交编辑审阅');
    await review.getByRole('button', { name: '刷新任务', exact: true }).click();
    await review.getByRole('button', { name: '审阅黄芪修订2', exact: true }).click();
    await expect(review.getByText('修订后的测试说明，仍为待专业审校资料。', { exact: true })).toBeVisible();
    await review.getByLabel('编辑审阅意见').fill('资料整理质量通过，未核实医学结论，非发布批准。');
    await review.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true }).click();
    await expect(review.getByRole('status', { name: '编辑审阅结果' })).toContainText('仍为私有待专业审校');
    const detail = await (await context.request.get('/api/v1/editorial/ingredients/huang-qi')).json();
    expect(detail.draft.state).toBe('editorial_accepted'); expect(detail.draft.professionalReviewState).toBe('pending'); expect(detail.draft.publicationEnabled).toBe(false);
    expect(detail.revisions[1].content.educationText).toBe(original);
    expect((await context.request.get('/api/v1/public/ingredients/huang-qi')).status()).toBe(404);
    const publicAfter = await (await context.request.get('/api/v1/public/catalog')).json();
    expect(publicAfter).toEqual(publicBefore);
    expect(JSON.stringify(publicAfter)).not.toContain('修订后的测试说明');
    expect(JSON.stringify(publicAfter)).not.toContain(title);
    await review.setViewportSize({ width: 390, height: 844 });
    expect(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review.screenshot({ path: test.info().outputPath('workflow-reviewed-mobile.png'), fullPage: true });
    await page.reload(); await enter(page); await chooseIngredient(page, '黄芪');
    await expect(page.getByText('编辑审阅通过 · 未发布', { exact: true })).toBeVisible();
    await expect(page.getByLabel('草稿教育说明')).toHaveValue('修订后的测试说明，仍为待专业审校资料。');
    await expect(page.getByRole('status', { name: '来源加载状态' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('workflow-history-desktop.png'), fullPage: true });
  } finally { await reviewerContext.close(); }
});

test('source edits conflict between tabs, old draft stays pinned, dirty navigation can be cancelled', async ({ page, context }) => {
  const title = `浏览器来源冲突-${Date.now()}`;
  await login(page, 'editor'); await enter(page); await createSource(page, title); await chooseIngredient(page, '枸杞子');
  await page.getByLabel('草稿教育说明').fill('来源引用版本测试，非正式资料。'); await addSource(page, title);
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await page.getByLabel('搜索来源库').fill(title); await page.getByRole('button').filter({ hasText: title }).click();
  const second = await context.newPage();
  try {
    await second.goto('/'); await enter(second); await second.getByRole('button', { name: '来源登记', exact: true }).click();
    await second.getByLabel('搜索来源库').fill(title); await second.getByRole('button').filter({ hasText: title }).click();
    await page.getByLabel('来源发布机构').fill('窗口一测试机构'); await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存');
    await second.getByLabel('来源标题', { exact: true }).fill(`${title}-未保存的窗口二输入`);
    await second.getByRole('button', { name: '保存来源', exact: true }).click();
    await expect(second.getByRole('status', { name: '来源保存结果' })).toContainText('来源已被修改');
    await expect(second.getByLabel('来源标题', { exact: true })).toHaveValue(`${title}-未保存的窗口二输入`);
    second.once('dialog', (dialog) => dialog.accept()); await second.getByRole('button', { name: '重新加载来源', exact: true }).click();
    await expect(second.getByLabel('来源发布机构')).toHaveValue('窗口一测试机构');
    await chooseIngredient(page, '枸杞子');
    await expect(page.getByText('浏览器测试机构 · 固定版本 1 · 待核验', { exact: true })).toBeVisible();
    await page.getByLabel('草稿教育说明').fill('需要保留的未保存输入');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name: /食材资料/ }).click();
    await expect(page.getByLabel('草稿教育说明')).toHaveValue('需要保留的未保存输入');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: '来源登记', exact: true }).click();
    await expect(page.getByLabel('草稿教育说明')).toHaveValue('需要保留的未保存输入');
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
    await expect(page.getByLabel('草稿教育说明')).toHaveValue('来源引用版本测试，非正式资料。');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('status', { name: '来源加载状态' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('workflow-editor-mobile.png'), fullPage: true });
  } finally { await second.close(); }
});

test('admin contributor cannot self-review, reviewer cannot edit sources, malformed API response shows retry', async ({ page, context, browser }) => {
  await login(page, 'admin'); await enter(page);
  const me = await (await context.request.get('/api/v1/auth/me')).json();
  const headers = { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': me.csrfToken };
  const source = await (await context.request.post('/api/v1/editorial/sources', { headers, data: { title: '自审阻断测试来源', publisher: '测试机构', url: `https://example.org/self-review-${Date.now()}` } })).json();
  const draft = await (await context.request.put('/api/v1/editorial/ingredients/jiang', { headers, data: { content: { ediblePart: '待核对', latinName: '', educationText: '仅测试草稿', safetyText: '仅测试，不用于诊疗', sourceRefs: [{ id: source.id, revision: 1, locator: '测试页 1' }] }, expectedLockVersion: 0 } })).json();
  expect((await context.request.post('/api/v1/editorial/ingredients/jiang/submit', { headers, data: { expectedLockVersion: draft.lockVersion } })).status()).toBe(200);
  await page.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
  await page.getByRole('button', { name: '审阅姜（生姜、干姜）修订1', exact: true }).click();
  await expect(page.getByText('参与此条目编辑或提交的账号不能自审。服务端检查完整编辑历史。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await page.route('**/api/v1/editorial/sources?**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>not json</html>' }));
  await page.getByLabel('搜索来源库').fill('坏响应');
  await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await page.unroute('**/api/v1/editorial/sources?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('还没有匹配来源。来源录入不会自动核验网页内容。', { exact: true })).toBeVisible();
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4312' });
  try {
    const review = await reviewerContext.newPage(); await login(review, 'reviewer'); await enter(review);
    await review.getByRole('button', { name: '来源登记', exact: true }).click();
    await review.getByLabel('搜索来源库').fill('自审阻断测试来源');
    await review.getByRole('button').filter({ hasText: '自审阻断测试来源' }).click();
    await expect(review.getByLabel('来源标题', { exact: true })).toHaveAttribute('readonly', '');
    await expect(review.getByRole('button', { name: '保存来源', exact: true })).toBeDisabled();
  } finally { await reviewerContext.close(); }
});

test('review queue failure hides stale filter results and preserves a selected task opinion on retry', async ({ page, context }) => {
  // Own accounts avoid exhausting the shared editor's real login window.
  // Do not clear attempts or weaken production limits to make this case pass.
  await login(page, 'admin');
  const admin = await (await context.request.get('/api/v1/auth/me')).json();
  const adminHeaders = { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': admin.csrfToken };
  const password = 'queue-recovery-test-only-password-2026'; const suffix = Date.now();
  const usernames = { editor: `queue-editor-${suffix}`, reviewer: `queue-reviewer-${suffix}` };
  for (const role of ['editor', 'reviewer'] as const) {
    expect((await context.request.post('/api/v1/users', { headers: adminHeaders, data: { username: usernames[role], password, role } })).status()).toBe(201);
  }
  async function ownedLogin(role: 'editor' | 'reviewer') {
    // Wait for the preceding UI logout to finish; navigating immediately can
    // interrupt its request and restore the previous account on slower SQL.
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
    await page.getByLabel('用户名', { exact: true }).fill(usernames[role]);
    await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录工作台' }).click();
    await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
  }
  await page.getByRole('button', { name: '退出工作台', exact: false }).click();
  await ownedLogin('editor'); await enter(page);
  const me = await (await context.request.get('/api/v1/auth/me')).json();
  const headers = { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': me.csrfToken };
  const sourceResponse = await context.request.post('/api/v1/editorial/sources', { headers, data: {
    title: `队列恢复工程测试-${Date.now()}`, publisher: '工程测试机构', url: 'https://example.org/queue-recovery-fixture'
  } });
  expect(sourceResponse.status()).toBe(201); const source = await sourceResponse.json();
  const draftResponse = await context.request.put('/api/v1/editorial/ingredients/ju-pi', { headers, data: { expectedLockVersion: 0,
    content: { ediblePart: '测试部位待核对', latinName: '', educationText: '仅用于队列恢复工程测试。', safetyText: '不用于食用或诊疗。', sourceRefs: [{ id: source.id, revision: 1, locator: '测试第 1 页' }] }
  } });
  expect(draftResponse.status()).toBe(200); const draft = await draftResponse.json();
  expect((await context.request.post('/api/v1/editorial/ingredients/ju-pi/submit', { headers, data: { expectedLockVersion: draft.lockVersion } })).status()).toBe(200);
  await page.getByRole('button', { name: '退出工作台', exact: false }).click();
  await ownedLogin('reviewer'); await enter(page); await page.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
  const row = page.getByRole('button', { name: '审阅橘皮修订1', exact: true }); await expect(row).toBeVisible();
  await page.route('**/api/v1/editorial/tasks?**', (route) => route.abort());
  await page.getByLabel('筛选审阅任务').selectOption('accepted');
  await expect(page.getByRole('alert')).toContainText('无法连接');
  await expect(row).toHaveCount(0);
  await expect(page.getByText('当前状态没有审阅任务。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('任务数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页任务', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/editorial/tasks?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(row).toHaveCount(0);
  await page.getByLabel('筛选审阅任务').selectOption('pending'); await row.click();
  const opinion = page.getByLabel('编辑审阅意见'); await opinion.fill('应保留的未提交工程测试意见');
  let decisions = 0; page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/decision')) decisions += 1; });
  await page.route('**/api/v1/editorial/tasks?**', (route) => route.abort()); await page.getByRole('button', { name: '刷新任务', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接'); await expect(opinion).toHaveValue('应保留的未提交工程测试意见');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('review-queue-failure-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/editorial/tasks?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(row).toBeVisible(); await expect(opinion).toHaveValue('应保留的未提交工程测试意见'); expect(decisions).toBe(0);
});
