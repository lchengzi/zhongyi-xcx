import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function login(page: Page, role: 'editor' | 'reviewer') {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(`browser-response-${role}`);
  await page.getByLabel('密码', { exact: true }).fill(`test-only-response-${role}-password-2026`);
  await page.getByRole('button', { name: '登录工作台', exact: false }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
}
async function makeSource(page: Page, suffix: string) {
  const title = `响应契约工程测试-${suffix}`;
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await page.getByLabel('来源标题', { exact: true }).fill(title); await page.getByLabel('来源发布机构').fill('仅工程测试机构');
  await page.getByLabel('来源原始网址').fill(`https://example.org/response-contract/${suffix}`);
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  return title;
}
async function edit(page: Page, name: string, title: string) {
  await page.getByRole('button', { name: '内容修订', exact: true }).click(); await page.getByLabel('搜索待编辑食材').fill(name);
  await page.getByRole('button', { name: `编辑${name}内容`, exact: true }).click();
  await expect(page.getByLabel('草稿教育说明')).toBeVisible(); await page.getByLabel('搜索可引用来源').fill(title);
  await page.getByRole('button', { name: '引用此来源', exact: true }).click(); await page.getByLabel(`${title}的原文定位`).fill('测试第一段，不作为正式证据');
  await page.getByLabel('草稿教育说明').fill('响应契约测试说明，不用于食用或诊疗。');
  await page.getByLabel('草稿安全边界').fill('仅工程测试，未专业审校。');
}

test('malformed successful source data never becomes an empty list or a saved source; committed write is checked by a deliberate read', async ({ page, context }) => {
  await login(page, 'editor');
  await page.route('**/api/v1/editorial/sources?**', async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, total: '0' } });
  });
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数据格式无效');
  await expect(page.getByText('来源数量暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有匹配来源。来源录入不会自动核验网页内容。', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/editorial/sources?**'); await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  let writes = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/editorial/sources')) writes++; });
  await page.route('**/api/v1/editorial/sources', async route => {
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, visibility: 'public' } });
  });
  const title = await makeSource(page, 'source-ack');
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('先重新读取核对');
  await expect(page.getByLabel('来源标题', { exact: true })).toHaveValue(title);
  await expect(page.getByRole('status', { name: '来源保存结果' })).not.toContainText('来源已保存');
  const recorded = await (await context.request.get(`/api/v1/editorial/sources?q=${encodeURIComponent(title)}`)).json();
  expect(recorded.items).toHaveLength(1); expect(recorded.items[0].revision).toBe(1); expect(writes).toBe(1);
  await page.unroute('**/api/v1/editorial/sources');
  await page.getByLabel('搜索来源库').fill(title);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: title, exact: false }).click();
  await expect(page.getByText('来源修订 · 版本 1', { exact: true })).toBeVisible(); expect(writes).toBe(1);
});

test('corrupt draft acknowledgement preserves input and never retries a committed save; mismatched reads are not displayed', async ({ page, context }) => {
  await login(page, 'editor'); const title = await makeSource(page, 'draft-ack');
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存'); await edit(page, '荷叶', title);
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/editorial/ingredients/he-ye')) writes++; });
  await page.route('**/api/v1/editorial/ingredients/he-ye', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, lockVersion: 'corrupt' } });
  });
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('先重新读取核对');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue('响应契约测试说明，不用于食用或诊疗。');
  await expect(page.getByRole('button', { name: '保存内容草稿', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交编辑审阅', exact: true })).toBeDisabled();
  const recorded = await (await context.request.get('/api/v1/editorial/ingredients/he-ye')).json();
  expect(recorded.revisions).toHaveLength(1); expect(recorded.draft.revision).toBe(1); expect(writes).toBe(1);
  await page.unroute('**/api/v1/editorial/ingredients/he-ye');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
  await expect(page.getByText('内容修订 1', { exact: false })).toBeVisible();
  await page.route('**/api/v1/editorial/ingredients/he-ye', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, draft: { ...body.draft, ingredientId: 'zhi-zi' } } });
  });
  await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('数据格式无效'); await expect(page.getByLabel('草稿教育说明')).toHaveCount(0);
  await page.unroute('**/api/v1/editorial/ingredients/he-ye'); await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
  await page.getByLabel('草稿教育说明').fill('核对后手动保存的第二版测试说明。'); await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿'); expect(writes).toBe(2);
  expect((await (await context.request.get('/api/v1/editorial/ingredients/he-ye')).json()).draft.revision).toBe(2);
});

test('review binds selected task and snapshot and preserves an opinion when a committed decision has an invalid acknowledgement', async ({ page, browser, context }) => {
  await login(page, 'editor'); const title = await makeSource(page, 'review-ack');
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存'); await edit(page, '栀子', title);
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click(); await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  await page.getByRole('button', { name: '提交编辑审阅', exact: true }).click(); await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已提交编辑审阅');
  const recorded = await (await context.request.get('/api/v1/editorial/ingredients/zhi-zi')).json(); const taskId = recorded.tasks[0].id;
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4312' });
  try {
    const review = await reviewerContext.newPage(); await login(review, 'reviewer'); await review.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
    const taskPath = `**/api/v1/editorial/tasks/${taskId}`;
    await review.route(taskPath, async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, id: 'different-task' } }); });
    await review.getByRole('button', { name: '审阅栀子修订1', exact: true }).click(); await expect(review.getByRole('alert')).toContainText('数据格式无效');
    await expect(review.getByLabel('编辑审阅意见')).toHaveCount(0); await review.unroute(taskPath);
    const revisionPath = '**/api/v1/editorial/ingredients/zhi-zi/revisions/1';
    await review.route(revisionPath, async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, digest: `sha256:${'f'.repeat(64)}` } }); });
    await review.getByRole('button', { name: '重新加载任务', exact: true }).click(); await expect(review.getByRole('alert')).toContainText('数据格式无效');
    await expect(review.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true })).toHaveCount(0); await review.unroute(revisionPath);
    await review.getByRole('button', { name: '重新加载任务', exact: true }).click(); await review.getByLabel('编辑审阅意见').fill('保留这条工程测试意见，非专业批准。');
    let decisions = 0; review.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/decision')) decisions++; });
    const decisionPath = `**/api/v1/editorial/tasks/${taskId}/decision`;
    await review.route(decisionPath, async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, ingredientId: 'he-ye' } }); });
    await review.getByRole('button', { name: '退回修改', exact: true }).click(); await expect(review.getByRole('status', { name: '编辑审阅结果' })).toContainText('先重新读取核对');
    await expect(review.getByLabel('编辑审阅意见')).toHaveValue('保留这条工程测试意见，非专业批准。');
    await expect(review.getByRole('button', { name: '退回修改', exact: true })).toBeDisabled();
    await expect(review.getByRole('button', { name: '通过编辑审阅（不发布）', exact: true })).toBeDisabled();
    const after = await (await reviewerContext.request.get(`/api/v1/editorial/tasks/${taskId}`)).json(); expect(after.status).toBe('returned'); expect(decisions).toBe(1);
    await review.setViewportSize({ width: 390, height: 844 }); expect(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review.screenshot({ path: test.info().outputPath('review-response-uncertain-narrow.png'), fullPage: true });
    await review.unroute(decisionPath); review.once('dialog', dialog => dialog.accept()); await review.getByRole('button', { name: '重新加载任务', exact: true }).click();
    await expect(review.getByText('已记录意见：保留这条工程测试意见，非专业批准。', { exact: false })).toBeVisible(); expect(decisions).toBe(1);
    expect((await (await context.request.get('/api/v1/editorial/ingredients/zhi-zi')).json()).draft.publicationEnabled).toBe(false);
  } finally { await reviewerContext.close(); }
});
