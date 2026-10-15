import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });
async function login(page: Page, role: 'editor' | 'reviewer' | 'assistant-review-editor' | 'assistant-proposal-editor') {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(`browser-${role}`);
  await page.getByLabel('密码', { exact: true }).fill(`test-only-${role}-password-2026`);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByLabel('搜索食材', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
}
async function prepare(page: Page, name: string) {
  const title = `摘录浏览器测试-${name}-${Date.now()}`;
  await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await page.getByLabel('来源标题', { exact: true }).fill(title); await page.getByLabel('来源发布机构').fill('测试机构');
  await page.getByLabel('来源原始网址').fill(`https://example.org/assistant/${encodeURIComponent(title)}`);
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(page.getByRole('status', { name: '来源保存结果' })).toContainText('来源已保存');
  await page.getByRole('button', { name: '内容修订', exact: true }).click(); await page.getByLabel('搜索待编辑食材').fill(name);
  await page.getByRole('button', { name: `编辑${name}内容`, exact: true }).click();
  await page.getByLabel('搜索可引用来源').fill(title); await page.getByRole('button', { name: '引用此来源', exact: true }).click();
  await page.getByLabel(`${title}的原文定位`).fill('第 1 页（测试）');
  await page.getByLabel('草稿教育说明').fill('原有私有测试说明，尚未采用辅助摘录。');
  await page.getByLabel('草稿安全边界').fill('测试草稿，不作专业批准或公开发布。');
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  await expect(page.getByLabel('模型服务状态')).toContainText('测试模拟器（非真实模型）');
  await page.getByText('登记新原文摘录', { exact: true }).click();
  await page.getByLabel('摘录固定来源').selectOption({ label: `${title} · v1` });
  await page.getByLabel('摘录原文定位').fill('第 2 页身份与形态（测试）');
  await page.getByLabel('原文摘录文本').fill('测试原文：记录所列部位为根，形态为干燥切片。');
  return title;
}

test('real React→API→SQL excerpt search→simulated extraction→human adoption→explicit save, never auto-publishes', async ({ page, context }) => {
  await login(page, 'editor'); const before = await (await context.request.get('/api/v1/public/catalog')).json();
  const title = await prepare(page, '当归');
  await expect(page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）')).not.toBeChecked();
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('检索原文摘录').fill('干燥切片');
  await page.getByLabel('选择摘录 第 2 页身份与形态（测试）').check();
  await expect(page.getByRole('button', { name: '整理所选原文摘录', exact: true })).toBeDisabled();
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check();
  await page.getByRole('button', { name: '整理所选原文摘录', exact: true }).click();
  await expect(page.getByText('测试模拟结果 · 不代表真实 AI 验收', { exact: true })).toBeVisible();
  await expect(page.getByLabel('辅助调用额度')).toContainText('当前账号 1/5 次');
  const adopt = page.getByRole('button', { name: '将核对摘录填入编辑输入（不自动保存）', exact: true });
  await expect(adopt).toBeDisabled();
  await page.getByLabel('我已逐条对照原文，仅作为私有编辑参考，不是专业批准').check();
  page.once('dialog', (dialog) => dialog.dismiss()); await adopt.click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('已取消采用');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue('原有私有测试说明，尚未采用辅助摘录。');
  await page.getByLabel('我已逐条对照原文，仅作为私有编辑参考，不是专业批准').check();
  page.once('dialog', (dialog) => dialog.accept()); await adopt.click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('尚未保存');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue('测试原文：记录所列部位为根，形态为干燥切片。');
  const unsaved = await (await context.request.get('/api/v1/editorial/ingredients/dang-gui')).json();
  expect(unsaved.draft.content.educationText).toBe('原有私有测试说明，尚未采用辅助摘录。');
  await expect(page.getByLabel(`${title}的原文定位`)).toHaveValue('第 1 页（测试）；第 2 页身份与形态（测试）');
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  const saved = await (await context.request.get('/api/v1/editorial/ingredients/dang-gui')).json();
  expect(saved.draft.content.educationText).toBe('测试原文：记录所列部位为根，形态为干燥切片。');
  expect(saved.draft.revision).toBe(unsaved.draft.revision + 1); expect(saved.draft.publicationEnabled).toBe(false); expect(saved.draft.professionalReviewState).toBe('pending');
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(before);
  await page.screenshot({ path: test.info().outputPath('assistant-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-mobile.png') });
  await page.reload(); await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '内容修订', exact: true }).click(); await page.getByLabel('搜索待编辑食材').fill('当归');
  await page.getByRole('button', { name: '编辑当归内容', exact: true }).click();
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(saved.draft.content.educationText);
  await expect(page.getByLabel('选择摘录 第 2 页身份与形态（测试）')).toBeVisible();
});

test('failed excerpt save preserves input; dirty navigation can be cancelled and confirmed reload really discards it', async ({ page }) => {
  await login(page, 'editor'); await prepare(page, '山柰');
  await expect(page.getByRole('button', { name: '提交编辑审阅', exact: true })).toBeDisabled();
  await page.route('**/api/v1/editorial/assistant/ingredients/*/excerpts', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '测试摘录保存失败，请重试。' }) }) : route.continue());
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('测试摘录保存失败');
  await expect(page.getByLabel('原文摘录文本')).toHaveValue('测试原文：记录所列部位为根，形态为干燥切片。');
  page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await expect(page.getByLabel('原文摘录文本')).toHaveValue('测试原文：记录所列部位为根，形态为干燥切片。');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '重新加载草稿', exact: true }).click();
  await page.getByText('登记新原文摘录', { exact: true }).click();
  await expect(page.getByLabel('原文摘录文本')).toHaveValue(''); await expect(page.getByLabel('摘录原文定位')).toHaveValue('');
  await expect(page.getByRole('button', { name: '提交编辑审阅', exact: true })).toBeEnabled();
});

test('reviewer can inspect excerpts but cannot register, generate or adopt them', async ({ page }) => {
  await login(page, 'reviewer'); await page.getByRole('button', { name: '内容修订', exact: true }).click();
  await page.getByLabel('搜索待编辑食材').fill('当归'); await page.getByRole('button', { name: '编辑当归内容', exact: true }).click();
  await expect(page.getByLabel('草稿教育说明')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('选择摘录 第 2 页身份与形态（测试）')).toBeDisabled();
  await expect(page.getByText('登记新原文摘录', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '整理所选原文摘录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /撤回外部许可/ })).toHaveCount(0);
});

test('owner can revoke/regrant in the real UI; a stale tab conflicts and quota is reloaded from SQL', async ({ page, context }) => {
  await login(page, 'editor'); await page.getByRole('button', { name: '内容修订', exact: true }).click();
  await page.getByLabel('搜索待编辑食材').fill('当归'); await page.getByRole('button', { name: '编辑当归内容', exact: true }).click();
  const revokeName = '撤回外部许可 第 2 页身份与形态（测试）'; const grantName = '允许外部使用 第 2 页身份与形态（测试）';
  await expect(page.getByRole('button', { name: revokeName, exact: true })).toBeVisible();
  const second = await context.newPage();
  try {
    await second.goto('/'); await second.getByRole('button', { name: '内容协作', exact: true }).click(); await second.getByRole('button', { name: '内容修订', exact: true }).click();
    await second.getByLabel('搜索待编辑食材').fill('当归'); await second.getByRole('button', { name: '编辑当归内容', exact: true }).click();
    await expect(second.getByRole('button', { name: revokeName, exact: true })).toBeVisible();
    const before = await (await context.request.get('/api/v1/editorial/assistant/ingredients/dang-gui/excerpts')).json();
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: revokeName, exact: true }).click();
    await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('已发送资料无法追回');
    await expect(page.getByLabel('选择摘录 第 2 页身份与形态（测试）')).toBeDisabled();
    second.once('dialog', (dialog) => dialog.accept()); await second.getByRole('button', { name: revokeName, exact: true }).click();
    await expect(second.getByRole('status', { name: '摘录辅助结果' })).toContainText('其他窗口修改');
    await expect(second.getByRole('button', { name: grantName, exact: true })).toBeVisible();
    const after = await (await context.request.get('/api/v1/editorial/assistant/ingredients/dang-gui/excerpts')).json();
    expect(after.items[0].digest).toBe(before.items[0].digest); expect(after.items[0].allowExternal).toBe(true); expect(after.items[0].externalPermission.allowed).toBe(false);
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: grantName, exact: true }).click();
    await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('已登记新的外部使用许可');
    await expect(page.getByLabel('选择摘录 第 2 页身份与形态（测试）')).toBeEnabled();
    await page.getByRole('button', { name: '刷新调用额度', exact: true }).click();
    await expect(page.getByLabel('辅助调用额度')).toContainText('当前账号 1/5 次');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-controls-mobile.png') });
  } finally { await second.close(); }
});

test('source-bound summary shows paragraph-to-quote mapping, human adoption only changes input, explicit save stays private', async ({ page, context }) => {
  await login(page, 'editor'); const before = await (await context.request.get('/api/v1/public/catalog')).json(); const title = await prepare(page, '山药');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('选择摘录 第 2 页身份与形态（测试）').check();
  await page.getByLabel('辅助任务类型').selectOption('summary');
  await expect(page.getByText('摘要是模型改写，不是原文。', { exact: false })).toBeVisible();
  const generate = page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }); await expect(generate).toBeDisabled();
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await generate.click();
  const paragraphs = page.getByLabel('有来源的摘要段落'); await expect(paragraphs).toContainText('资料概括（测试模拟）'); await expect(paragraphs).toContainText('原文依据：资料 1');
  await expect(page.getByText('模型提示的资料缺口：安全边界、身份、加工形态', { exact: true })).toBeVisible();
  await expect(page.getByLabel('辅助调用额度')).toContainText('当前账号 2/5 次');
  const unsaved = await (await context.request.get('/api/v1/editorial/ingredients/shan-yao')).json();
  const originalInput = await page.getByLabel('草稿教育说明').inputValue(); const safety = await page.getByLabel('草稿安全边界').inputValue();
  await expect(page.getByRole('button', { name: '采用所选修改（不自动保存）', exact: true })).toHaveCount(0);
  await page.getByLabel('建议处理方式').selectOption('replace');
  await page.getByRole('button', { name: '预览修改差异', exact: true }).click();
  const adopt = page.getByRole('button', { name: '采用所选修改（不自动保存）', exact: true }); await expect(adopt).toBeDisabled();
  await expect(page.getByLabel('建议采用前')).toHaveText(originalInput);
  await expect(page.getByLabel('建议采用后')).toHaveText('实际食用部位：资料概括（测试模拟）：测试原文：记录所列部位为根，形态为干燥切片。');
  await page.getByRole('button', { name: '取消本次建议', exact: true }).click(); await expect(page.getByLabel('草稿教育说明')).toHaveValue(originalInput);
  await page.getByRole('button', { name: '预览修改差异', exact: true }).click();
  await page.getByLabel('我已核对修改差异与原文依据，确认采用所选建议').check();
  await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-summary-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-summary-mobile.png') });
  await adopt.click();
  await expect(page.getByLabel('草稿教育说明')).toHaveValue('实际食用部位：资料概括（测试模拟）：测试原文：记录所列部位为根，形态为干燥切片。');
  await expect(page.getByLabel('草稿安全边界')).toHaveValue(safety); await expect(page.getByLabel(`${title}的原文定位`)).toHaveValue('第 1 页（测试）；第 2 页身份与形态（测试）');
  expect((await (await context.request.get('/api/v1/editorial/ingredients/shan-yao')).json()).draft.digest).toBe(unsaved.draft.digest);
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click(); await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  const saved = await (await context.request.get('/api/v1/editorial/ingredients/shan-yao')).json(); expect(saved.draft.revision).toBe(unsaved.draft.revision + 1); expect(saved.draft.professionalReviewState).toBe('pending'); expect(saved.draft.publicationEnabled).toBe(false);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(before);
});

test('local summary proposal guards changed input, failed evidence reads and revoked permission before append and explicit save', async ({ page, context }) => {
  await login(page, 'assistant-proposal-editor'); const before = await (await context.request.get('/api/v1/public/catalog')).json();
  await prepare(page, '玉竹');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click(); await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('选择摘录 第 2 页身份与形态（测试）').check(); await page.getByLabel('辅助任务类型').selectOption('summary');
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/yu-zhu/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click(); const result = await (await responsePromise).json();
  const unsaved = await (await context.request.get('/api/v1/editorial/ingredients/yu-zhu')).json();
  const original = await page.getByLabel('草稿教育说明').inputValue();
  const safety = await page.getByLabel('草稿安全边界').inputValue(); const latin = await page.getByLabel('草稿拉丁名').inputValue(); const part = await page.getByLabel('草稿食用部位').inputValue();
  const preview = page.getByRole('button', { name: '预览修改差异', exact: true }); const adopt = page.getByRole('button', { name: '采用所选修改（不自动保存）', exact: true });
  const confirm = page.getByLabel('我已核对修改差异与原文依据，确认采用所选建议');
  await preview.click(); await confirm.check(); await page.getByLabel('草稿教育说明').fill(`${original} 人工补充。`);
  await expect(page.getByRole('alert')).toContainText('草稿输入或版本已变化'); await expect(adopt).toBeDisabled(); await expect(confirm).not.toBeChecked();
  await page.getByLabel('草稿教育说明').fill(original); await expect(confirm).not.toBeChecked(); await expect(adopt).toBeDisabled();
  await page.getByLabel('草稿教育说明').fill(`${original} 人工补充。`);
  await preview.click(); await confirm.check();
  const evidencePath = `**/api/v1/editorial/assistant/ingredients/yu-zhu/excerpts/${result.citations[0].id}`;
  await page.route(evidencePath, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: '测试原文读取失败' }) }));
  await adopt.click(); await expect(page.getByRole('status', { name: '修改建议结果' })).toContainText('测试原文读取失败');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(`${original} 人工补充。`); await page.unroute(evidencePath);
  const citation = result.citations[0];
  const session = await (await context.request.get('/api/v1/auth/me')).json(); const headers = { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': session.csrfToken };
  const permission = await context.request.put(`/api/v1/editorial/assistant/excerpts/${citation.id}/permission`, { headers, data: { allowExternal: false, expectedRevision: citation.externalPermission.revision } }); expect(permission.status()).toBe(200);
  await confirm.check(); await adopt.click(); await expect(page.getByRole('status', { name: '修改建议结果' })).toContainText('原文依据或许可已变化');
  expect((await (await context.request.get('/api/v1/editorial/ingredients/yu-zhu')).json()).draft.digest).toBe(unsaved.draft.digest);
  const revoked = await permission.json();
  expect((await context.request.put(`/api/v1/editorial/assistant/excerpts/${citation.id}/permission`, { headers, data: { allowExternal: true, expectedRevision: revoked.externalPermission.revision } })).status()).toBe(200);
  // A new result must capture the new permission revision; old suggestions remain unusable.
  await page.getByRole('button', { name: '刷新调用额度', exact: true }).click();
  await expect(page.getByLabel('辅助调用额度')).toBeVisible(); await expect(page.getByLabel('编辑修改建议')).toHaveCount(0);
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click();
  await expect(page.getByLabel('有来源的摘要段落')).toBeVisible(); await preview.click(); await confirm.check(); await adopt.click();
  await expect(page.getByRole('status', { name: '修改建议结果' })).toContainText('尚未保存');
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(`${original} 人工补充。\n实际食用部位：资料概括（测试模拟）：测试原文：记录所列部位为根，形态为干燥切片。`);
  await expect(page.getByLabel('草稿安全边界')).toHaveValue(safety); await expect(page.getByLabel('草稿拉丁名')).toHaveValue(latin); await expect(page.getByLabel('草稿食用部位')).toHaveValue(part);
  expect((await (await context.request.get('/api/v1/editorial/ingredients/yu-zhu')).json()).draft.digest).toBe(unsaved.draft.digest);
  await page.getByRole('button', { name: '保存内容草稿', exact: true }).click(); await expect(page.getByRole('status', { name: '内容草稿结果' })).toContainText('已保存私有草稿');
  const saved = await (await context.request.get('/api/v1/editorial/ingredients/yu-zhu')).json(); expect(saved.draft.revision).toBe(unsaved.draft.revision + 1); expect(saved.draft.professionalReviewState).toBe('pending'); expect(saved.draft.publicationEnabled).toBe(false);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(before);
});

test('malformed summary cannot render or adopt; a concurrent server save invalidates a fresh local proposal', async ({ page, context }) => {
  await login(page, 'assistant-proposal-editor'); await prepare(page, '山楂');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click(); await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('选择摘录 第 2 页身份与形态（测试）').check(); await page.getByLabel('辅助任务类型').selectOption('summary');
  const original = await page.getByLabel('草稿教育说明').inputValue();
  const path = '**/api/v1/editorial/assistant/ingredients/shan-zha/generate';
  await page.route(path, async (route) => { const response = await route.fetch(); const result = await response.json(); result.citations[0].ingredientId = 'other-food'; await route.fulfill({ response, json: result }); });
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('辅助结果格式或引用关联无效');
  await expect(page.getByLabel('有来源的摘要段落')).toHaveCount(0); await expect(page.getByLabel('编辑修改建议')).toHaveCount(0); await expect(page.getByLabel('草稿教育说明')).toHaveValue(original);
  await page.unroute(path); await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click();
  await page.getByRole('button', { name: '预览修改差异', exact: true }).click(); await page.getByLabel('我已核对修改差异与原文依据，确认采用所选建议').check();
  const current = await (await context.request.get('/api/v1/editorial/ingredients/shan-zha')).json(); const session = await (await context.request.get('/api/v1/auth/me')).json();
  const saved = await context.request.put('/api/v1/editorial/ingredients/shan-zha', { headers: { Origin: 'http://127.0.0.1:4312', 'X-CSRF-Token': session.csrfToken }, data: { content: { ...current.draft.content, educationText: '另一个页面保存的新说明' }, expectedLockVersion: current.draft.lockVersion } }); expect(saved.status()).toBe(200);
  await page.getByRole('button', { name: '采用所选修改（不自动保存）', exact: true }).click();
  await expect(page.getByRole('status', { name: '修改建议结果' })).toContainText('服务端草稿已变化'); await expect(page.getByLabel('草稿教育说明')).toHaveValue(original);
  expect((await (await context.request.get('/api/v1/editorial/ingredients/shan-zha')).json()).draft.content.educationText).toBe('另一个页面保存的新说明');
});

test('review shows source conflict and explicit gaps without adoption, draft changes or publication', async ({ page, context }) => {
  // Own actor and unused catalog entry keep this additive case from consuming
  // other suites' real login window or creating their assumed-empty draft.
  await login(page, 'assistant-review-editor');
  const before = await (await context.request.get('/api/v1/public/catalog')).json();
  await prepare(page, '麦芽'); await page.getByLabel('摘录原文定位').fill('检查来源甲');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await prepare(page, '麦芽'); await page.getByLabel('摘录原文定位').fill('检查来源乙');
  await page.getByLabel('原文摘录文本').fill('另一测试来源记载所列部位为叶。');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('选择摘录 检查来源甲').check(); await page.getByLabel('选择摘录 检查来源乙').check();
  await page.getByLabel('辅助任务类型').selectOption('review');
  const generate = page.getByRole('button', { name: '检查资料缺口与来源分歧', exact: true }); await expect(generate).toBeDisabled();
  const draftBefore = await (await context.request.get('/api/v1/editorial/ingredients/mai-ya')).json();
  const quotaBefore = await (await context.request.get('/api/v1/editorial/assistant/quota')).json();
  const originalInput = await page.getByLabel('草稿教育说明').inputValue();
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/ingredients/mai-ya/generate') && response.request().method() === 'POST');
  await generate.click(); const response = await responsePromise; expect(response.status()).toBe(200); const result = await response.json();
  const findings = page.getByLabel('资料缺口与来源分歧检查结果');
  await expect(findings).toContainText('身份 · 信息缺口'); await expect(findings).toContainText('实际食用部位 · 来源分歧');
  await expect(findings).toContainText('资料 1、资料 2'); await expect(findings).toContainText('加工形态 · 信息缺口');
  await expect(page.getByRole('button', { name: /填入编辑输入/ })).toHaveCount(0);
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(originalInput);
  expect(result.mode).toBe('review'); expect(result.publicationEnabled).toBe(false); expect(result.professionalReviewState).toBe('pending');
  expect(new Set(result.citations.map((item: { sourceId: string }) => item.sourceId)).size).toBe(2);
  expect((await (await context.request.get('/api/v1/editorial/assistant/quota')).json()).usedByActor).toBe(quotaBefore.usedByActor + 1);
  expect((await (await context.request.get('/api/v1/editorial/ingredients/mai-ya')).json()).draft.digest).toBe(draftBefore.draft.digest);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(before);
  await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: '有来源的编辑辅助' }).screenshot({ path: test.info().outputPath('assistant-review-mobile.png') });
  await page.getByLabel('辅助任务类型').selectOption('summary'); await expect(findings).toHaveCount(0);
  await expect(page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true })).not.toBeChecked();
});

test('failed summary preserves private draft and can retry with a fresh per-call confirmation', async ({ page, context }) => {
  await login(page, 'editor'); await prepare(page, '茯苓');
  await page.getByLabel('我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）').check();
  await page.getByRole('button', { name: '保存私有摘录', exact: true }).click(); await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('未发送给模型');
  await page.getByLabel('选择摘录 第 2 页身份与形态（测试）').check(); await page.getByLabel('辅助任务类型').selectOption('summary');
  const before = await (await context.request.get('/api/v1/editorial/ingredients/fu-ling')).json(); let reject = true;
  await page.route('**/api/v1/editorial/assistant/ingredients/fu-ling/generate', (route) => reject ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'unsupported_output', message: '摘要依据核对失败，未采用输出。' }) }) : route.continue());
  await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click();
  await expect(page.getByRole('status', { name: '摘录辅助结果' })).toContainText('摘要依据核对失败'); await expect(page.getByLabel('有来源的摘要段落')).toHaveCount(0);
  await expect(page.getByLabel('草稿教育说明')).toHaveValue(before.draft.content.educationText); await expect(page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true })).toBeDisabled();
  reject = false; await page.getByLabel('确认本次模拟整理（不调用外部模型）', { exact: true }).check(); await page.getByRole('button', { name: '生成有来源的摘要草稿', exact: true }).click();
  await expect(page.getByLabel('有来源的摘要段落')).toContainText('资料概括（测试模拟）'); expect((await (await context.request.get('/api/v1/editorial/ingredients/fu-ling')).json()).draft.digest).toBe(before.draft.digest);
});
