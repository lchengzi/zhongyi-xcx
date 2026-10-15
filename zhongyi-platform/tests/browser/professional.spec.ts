import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Account, ContentRevision, ProfessionalDetail, ProfessionalKind, SessionInfo } from '../../shared/contracts';

const origin = 'http://127.0.0.1:4312';
const password = 'test-only-professional-password-2026';
test.use({ baseURL: origin });

async function login(page: Page, username: string, secret: string) {
  await page.goto('/'); await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('textbox', { name: '搜索食材' })).toBeVisible();
}
async function panel(page: Page) {
  await page.getByRole('button', { name: '内容协作', exact: true }).click();
  await page.getByRole('button', { name: '专业审校记录', exact: true }).click();
}
async function session(context: BrowserContext) {
  const response = await context.request.get('/api/v1/auth/me'); expect(response.status()).toBe(200);
  const info: SessionInfo = await response.json();
  return { info, headers: { Origin: origin, 'X-CSRF-Token': info.csrfToken } };
}
async function account(context: BrowserContext, username: string, role: 'editor' | 'reviewer' = 'reviewer') {
  const { headers } = await session(context);
  const response = await context.request.post('/api/v1/users', { headers, data: { username, password, role } });
  expect(response.status()).toBe(201); return await response.json() as Account;
}
async function grant(page: Page, person: Account, profession: ProfessionalKind) {
  await page.getByLabel('资格所属账号', { exact: true }).selectOption(person.id);
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toBeEnabled();
  await page.getByLabel('专业类别', { exact: true }).selectOption(profession);
  await page.getByLabel('资格依据类型', { exact: true }).selectOption('test-fixture');
  await page.getByLabel('内部核验依据编号', { exact: true }).fill(`browser-fixture-${person.username}`);
  await page.getByLabel('核验有效截止时间UTC', { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  await page.getByLabel('资格核验说明', { exact: true }).fill('工程测试资格，不代表真实身份、执业证或医学审校。');
  await expect(page.getByRole('button', { name: '保存资格记录', exact: true })).toBeDisabled();
  await page.getByLabel('确认已核对资格依据', { exact: true }).check();
  await page.getByRole('button', { name: '保存资格记录', exact: true }).click();
  await expect(page.getByRole('status', { name: '资格保存结果' })).toContainText('已保存工程测试资格');
  await expect(page.getByLabel('确认已核对资格依据', { exact: true })).not.toBeChecked();
}
async function ingredient(page: Page, name: string) {
  await page.getByLabel('搜索待专业审校食材', { exact: true }).fill(name);
  await page.getByRole('button', { name: `查看${name}专业审校`, exact: true }).click();
  await expect(page.getByLabel('专业审校状态', { exact: true })).toBeVisible();
}
async function acceptedDraft(browser: Browser, admin: BrowserContext, id: string, text: string, twoSources = false) {
  // Own accounts avoid consuming other suites' login windows or contributor IDs.
  const author = await account(admin, `pro-author-${Date.now()}`, 'editor');
  const editorReviewer = await account(admin, `pro-editorial-${Date.now()}`);
  const editor = await browser.newContext({ baseURL: origin });
  const reviewer = await browser.newContext({ baseURL: origin });
  try {
    for (const [owned, person] of [[editor, author], [reviewer, editorReviewer]] as const) {
      const response = await owned.request.post('/api/v1/auth/login', { headers: { Origin: origin }, data: { username: person.username, password } });
      expect(response.status()).toBe(200);
    }
    const { headers } = await session(editor);
    const source = await editor.request.post('/api/v1/editorial/sources', { headers, data: { title: `专业审校浏览器测试来源-${id}`, publisher: '工程测试机构', url: `https://example.org/professional-browser-fixture-${id}` } });
    expect(source.status()).toBe(201); const fixed = await source.json();
    const sourceRefs = [{ id: fixed.id, revision: 1, locator: '测试原文第 1 页' }];
    if (twoSources) {
      const extra = await editor.request.post('/api/v1/editorial/sources', { headers, data: { title: `第二测试来源-${id}`, publisher: '第二工程测试机构', url: `https://example.org/second-source-${id}` } });
      expect(extra.status()).toBe(201); const second = await extra.json();
      sourceRefs.push({ id: second.id, revision: 1, locator: '第二来源第 2 页\n仅用于工程测试' });
    }
    const draft = await editor.request.put(`/api/v1/editorial/ingredients/${id}`, { headers, data: { expectedLockVersion: 0, content: { ediblePart: '测试部位', latinName: '', educationText: text, safetyText: '工程测试，不用于诊断或食用指导。', sourceRefs } } });
    expect(draft.status()).toBe(200); const content = await draft.json();
    const submit = await editor.request.post(`/api/v1/editorial/ingredients/${id}/submit`, { headers, data: { expectedLockVersion: content.lockVersion } });
    expect(submit.status()).toBe(200); const task = await submit.json();
    const reviewSession = await session(reviewer);
    const accepted = await reviewer.request.post(`/api/v1/editorial/tasks/${task.task.id}/decision`, { headers: reviewSession.headers, data: { decision: 'accept', comment: '工程测试编辑审阅；非专业批准。', expectedLockVersion: task.draft.lockVersion } });
    expect(accepted.status()).toBe(200);
  } finally { await editor.close(); await reviewer.close(); }
}

test('real UI records two independent fixture qualifications and fixed opinions; refresh/revocation never changes the public catalog', async ({ page, browser, context }) => {
  test.setTimeout(60000);
  const publicBefore = await (await context.request.get('/api/v1/public/catalog')).json();
  await login(page, 'browser-admin', 'test-only-admin-password-2026');
  const physician = await account(context, `pro-doctor-${Date.now()}`);
  const pharmacist = await account(context, `pro-pharmacist-${Date.now()}`);
  await panel(page); await grant(page, physician, 'tcm_physician'); await grant(page, pharmacist, 'pharmacist');
  const contexts: BrowserContext[] = [];
  try {
    await acceptedDraft(browser, context, 'bai-he', '百合工程测试说明；并非已核实的教育资料。');
    for (const [index, person] of [physician, pharmacist].entries()) {
      const professional = await browser.newContext({ baseURL: origin }); contexts.push(professional);
      const review = await professional.newPage(); await login(review, person.username, password); await panel(review); await ingredient(review, '百合');
      await expect(review.getByText('百合工程测试说明；并非已核实的教育资料。', { exact: true })).toBeVisible();
      await expect(review.getByText('专业审校浏览器测试来源-bai-he · 版本 1', { exact: true })).toBeVisible();
      await expect(review.getByLabel('固定来源 1', { exact: true })).toContainText('发布机构：工程测试机构');
      await expect(review.getByLabel('固定来源 1', { exact: true })).toContainText('录入：');
      await expect(review.getByText('以下为正文绑定的固定来源登记，不代表当前来源核验已通过；录入时间不是原文发布日期。', { exact: true })).toBeVisible();
      await review.getByLabel('专业审校意见', { exact: true }).fill(`第 ${index + 1} 类工程测试意见，非真实专业批准。`);
      if (index === 0) {
        await expect(review.getByRole('button', { name: '记录专业通过（不发布）', exact: true })).toBeEnabled();
        await review.route('**/api/v1/editorial/professional/bai-he', async route => {
          const response = await route.fetch(); const value: ProfessionalDetail = await response.json();
          await route.fulfill({ json: { ...value, draft: { ...value.draft, sources: [] } } });
        });
        review.once('dialog', dialog => dialog.accept()); await review.getByRole('button', { name: '刷新专业审校', exact: true }).click();
        await expect(review.getByLabel('固定来源 1', { exact: true }).getByRole('alert')).toBeVisible();
        await review.getByLabel('专业审校意见', { exact: true }).fill('来源缺失时不得记录专业通过；仅测试。');
        await expect(review.getByRole('button', { name: '记录专业通过（不发布）', exact: true })).toBeDisabled();
        await expect(review.getByRole('button', { name: '退回专业审校', exact: true })).toBeEnabled();
        await review.unroute('**/api/v1/editorial/professional/bai-he');
        review.once('dialog', dialog => dialog.accept()); await review.getByRole('button', { name: '刷新专业审校', exact: true }).click();
        await review.getByLabel('专业审校意见', { exact: true }).fill(`第 ${index + 1} 类工程测试意见，非真实专业批准。`);
      }
      await review.getByRole('button', { name: '记录专业通过（不发布）', exact: true }).click();
      await expect(review.getByRole('status', { name: '专业审校结果' })).toContainText('未发布任何内容');
      await expect(review.getByLabel('专业审校意见', { exact: true })).toHaveValue('');
      await review.reload(); await panel(review); await ingredient(review, '百合');
      await expect(review.getByText(`第 ${index + 1} 类工程测试意见，非真实专业批准。`, { exact: true })).toBeVisible();
      if (index === 1) {
        await expect(review.getByLabel('专业审校状态', { exact: true })).toContainText('条件仍未齐备');
        await expect(review.getByText('包含工程测试意见，不能作为真实专业批准。', { exact: true })).toBeVisible();
        await review.screenshot({ path: test.info().outputPath('professional-fixture-desktop.png'), fullPage: true });
        await review.setViewportSize({ width: 390, height: 844 });
        expect(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await review.screenshot({ path: test.info().outputPath('professional-fixture-mobile.png'), fullPage: true });
      }
    }
    await ingredient(page, '百合'); await page.getByLabel('审校专业', { exact: true }).selectOption('pharmacist');
    await page.getByLabel('专业审校意见', { exact: true }).fill('管理员撤销工程测试意见，不删除原有历史。');
    await page.getByRole('button', { name: '撤销该专业意见', exact: true }).click();
    await expect(page.getByRole('status', { name: '专业审校结果' })).toContainText('未发布任何内容');
    const after = await (await context.request.get('/api/v1/editorial/professional/bai-he')).json();
    expect(after.reviewVersion).toBe(3); expect(after.latestReviews.find((item: { profession: string }) => item.profession === 'pharmacist').decision).toBe('revoke');
    expect(after.visibility).toBe('private'); expect(after.publicationEnabled).toBe(false);
    expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(publicBefore);
  } finally { for (const owned of contexts.reverse()) await owned.close(); }
});

test('both review views bind source metadata and locators by pinned ID and revision, not response order', async ({ page, context, browser }) => {
  await login(page, 'browser-admin', 'test-only-admin-password-2026');
  const publicBefore = await (await context.request.get('/api/v1/public/catalog')).json();
  await acceptedDraft(browser, context, 'shan-zhu-yu', '山茱萸固定来源显示工程测试，不是医学审校。', true);
  const response = await context.request.get('/api/v1/editorial/professional/shan-zhu-yu'); expect(response.status()).toBe(200);
  const fixed: ProfessionalDetail = await response.json(); expect(fixed.draft?.sources).toHaveLength(2);
  const sources = fixed.draft!.sources, refs = fixed.draft!.content.sourceRefs;
  let writes = 0; page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes++; });
  // Fault injection changes only transport ordering, not the stored revision or public content.
  await page.route('**/api/v1/editorial/professional/shan-zhu-yu', route => route.fulfill({ json: { ...fixed, draft: { ...fixed.draft, sources: [...sources].reverse() } } }));
  await panel(page); await ingredient(page, '山茱萸');
  async function verifyCards() {
    for (const [index, ref] of refs.entries()) {
      const source = sources.find(source => source.id === ref.id && source.revision === ref.revision)!;
      const card = page.getByLabel(`固定来源 ${index + 1}`, { exact: true });
      await expect(card.getByRole('link')).toHaveText(`${source.title} · 版本 ${ref.revision}`);
      await expect(card.getByRole('link')).toHaveAttribute('href', source.url);
      await expect(card).toContainText(`发布机构：${source.publisher}`);
      await expect(card).toContainText(`记录人：${source.recordedBy}`);
      await expect(card).toContainText(`原文定位：${ref.locator}`);
      await expect(card).toContainText('录入：');
    }
  }
  await verifyCards();
  await page.getByRole('button', { name: '编辑审阅任务', exact: true }).click();
  await page.getByLabel('筛选审阅任务', { exact: true }).selectOption('accepted');
  await page.route('**/api/v1/editorial/ingredients/shan-zhu-yu/revisions/1', async route => {
    const response = await route.fetch(); const revision: ContentRevision = await response.json();
    await route.fulfill({ json: { ...revision, sources: [...revision.sources].reverse() } });
  });
  await page.getByRole('button', { name: '审阅山茱萸修订1', exact: true }).click(); await verifyCards();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('fixed-source-editorial-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '专业审校记录', exact: true }).click(); await ingredient(page, '山茱萸'); await verifyCards();
  await page.screenshot({ path: test.info().outputPath('fixed-source-professional-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/editorial/professional/shan-zhu-yu');
  await page.route('**/api/v1/editorial/professional/shan-zhu-yu', route => route.fulfill({ json: { ...fixed, draft: { ...fixed.draft, sources: [sources[1]] } } }));
  await page.getByRole('button', { name: '刷新专业审校', exact: true }).click();
  await expect(page.getByLabel('固定来源 1', { exact: true }).getByRole('alert')).toContainText('无法唯一匹配');
  await expect(page.getByLabel('固定来源 1', { exact: true }).getByRole('link')).toHaveCount(0);
  await expect(page.getByLabel('固定来源 1', { exact: true })).toContainText(refs[0].locator);
  expect(writes).toBe(0); expect(await (await context.request.get('/api/v1/editorial/professional/shan-zhu-yu')).json()).toEqual(fixed);
  expect(await (await context.request.get('/api/v1/public/catalog')).json()).toEqual(publicBefore);
});

test('qualification write errors and stale versions retain input; dirty navigation can be cancelled and editors cannot grant or approve', async ({ page, context, browser }) => {
  await login(page, 'browser-admin', 'test-only-admin-password-2026');
  const person = await account(context, `pro-conflict-${Date.now()}`); await panel(page);
  await page.getByLabel('资格所属账号', { exact: true }).selectOption(person.id);
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toBeEnabled();
  await page.getByLabel('资格依据类型', { exact: true }).selectOption('test-fixture');
  await page.getByLabel('内部核验依据编号', { exact: true }).fill('需要保留的工程测试输入');
  await page.getByLabel('核验有效截止时间UTC', { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  await page.getByLabel('资格核验说明', { exact: true }).fill('工程测试，网络失败不能丢失输入。');
  await page.getByLabel('确认已核对资格依据', { exact: true }).check();
  page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: '来源登记', exact: true }).click();
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('需要保留的工程测试输入');
  await page.route(`**/api/v1/editorial/qualifications/${person.id}`, (route) => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByRole('button', { name: '保存资格记录', exact: true }).click();
  await expect(page.getByRole('status', { name: '资格保存结果' })).toContainText('无法确认提交结果');
  await expect(page.getByRole('status', { name: '资格保存结果' })).toContainText('先重新读取核对');
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('需要保留的工程测试输入');
  await page.unroute(`**/api/v1/editorial/qualifications/${person.id}`);
  await expect(page.getByRole('button', { name: '保存资格记录', exact: true })).toBeDisabled();
  // Unknown transport outcome requires an explicit successful read first;
  // the subsequent independent write still exercises a real stale-version 409.
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('');
  await page.getByLabel('资格依据类型', { exact: true }).selectOption('test-fixture');
  await page.getByLabel('内部核验依据编号', { exact: true }).fill('需要保留的工程测试输入');
  await page.getByLabel('核验有效截止时间UTC', { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  await page.getByLabel('资格核验说明', { exact: true }).fill('工程测试，并发冲突不能丢失输入。');
  await page.getByLabel('确认已核对资格依据', { exact: true }).check();
  const { headers } = await session(context);
  const saved = await context.request.post(`/api/v1/editorial/qualifications/${person.id}`, { headers, data: { expectedRevision: 0, qualification: { profession: 'tcm_physician', status: 'verified', evidenceKind: 'test-fixture', evidenceReference: '另一个窗口工程测试', validUntil: new Date(Date.now() + 30 * 86400000).toISOString(), comment: '工程测试并发操作。', verificationConfirmed: true } } });
  expect(saved.status()).toBe(201);
  await page.getByRole('button', { name: '保存资格记录', exact: true }).click();
  await expect(page.getByRole('status', { name: '资格保存结果' })).toContainText('资格已被修改');
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('需要保留的工程测试输入');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: '刷新资格记录', exact: true }).click();
  await expect(page.getByLabel('内部核验依据编号', { exact: true })).toHaveValue('另一个窗口工程测试');
  await page.getByLabel('资格状态', { exact: true }).selectOption('revoked');
  await page.getByLabel('资格核验说明', { exact: true }).fill('撤销工程测试资格记录。');
  await page.getByRole('button', { name: '保存资格记录', exact: true }).click();
  await expect(page.getByRole('status', { name: '资格保存结果' })).toContainText('已保存工程测试资格');
  await expect(page.getByText('修订 2 · 中医师 · 已撤销', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('确认已核对资格依据', { exact: true })).toHaveCSS('width', '16px');
  await page.screenshot({ path: test.info().outputPath('professional-qualification-mobile.png'), fullPage: true });
  const editor = await browser.newContext({ baseURL: origin });
  try {
    await acceptedDraft(browser, context, 'yi-yi-ren', '独立的编辑权限工程测试说明。');
    const edit = await editor.newPage(); await login(edit, 'browser-editor', 'test-only-editor-password-2026'); await panel(edit);
    await expect(edit.getByRole('heading', { name: '我的资格记录', exact: true })).toBeVisible();
    await expect(edit.getByRole('button', { name: '保存资格记录', exact: true })).toHaveCount(0);
    await ingredient(edit, '薏苡仁'); await edit.getByLabel('专业审校意见', { exact: true }).fill('编辑账号不能专业签审。');
    await expect(edit.getByRole('button', { name: '记录专业通过（不发布）', exact: true })).toBeDisabled();
    expect((await editor.request.get(`/api/v1/editorial/qualifications/${person.id}`)).status()).toBe(403);
  } finally { await editor.close(); }
});
