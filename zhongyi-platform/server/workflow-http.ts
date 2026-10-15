import { Router, type Express, type RequestHandler } from 'express';
import type { ReviewTask } from '../shared/contracts.js';
import type { CatalogStore, WorkflowStore } from './stores.js';
import { currentAccount, currentSessionToken } from './auth-http.js';
import { exact, fail, validateContent, validateSource, version } from './workflow.js';
import { validateProfessionalDecision, validateQualification } from './professional-values.js';
import { validateSourceCheck } from './source-check-values.js';

function pagination(query: Record<string, unknown>, extras: string[] = []) {
  if (Object.keys(query).some((key) => !['page', 'pageSize', ...extras].includes(key) || typeof query[key] !== 'string')) fail(400, 'invalid_query', '查询参数无效。');
  const page = Number(query.page ?? 1); const pageSize = Number(query.pageSize ?? 12);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) fail(400, 'invalid_query', '分页范围无效。');
  return { page, pageSize };
}
export function configureWorkflow(app: Express, catalog: CatalogStore, repo: WorkflowStore): void {
  const router = Router();
  router.use((_req, res, next) => { currentAccount(res.locals); next(); });
  router.get('/source-checks/:id/:revision', async (req, res) => {
    const revision = Number(req.params.revision);
    if (Object.keys(req.query).length || !version(revision)) fail(400, 'invalid_query', '来源固定版本无效，不接受查询参数。');
    res.json(await repo.sourceCheck(req.params.id, revision));
  });
  router.post('/source-checks/:id', async (req, res) => {
    if (!exact(req.body, ['check', 'expectedVersion']) || !version(req.body.expectedVersion, true)) fail(400, 'invalid_source_check', '请携带核验信息和当前协作版本。');
    res.status(201).json(await repo.saveSourceCheck(req.params.id, validateSourceCheck(req.body.check), req.body.expectedVersion, currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.get('/publication-preflight/:id', async (req, res) => {
    if (Object.keys(req.query).length) fail(400, 'invalid_query', '发布前检查不接受查询参数。');
    res.json(await repo.publicationPreflight(req.params.id));
  });
  router.get('/qualifications/:userId', async (req, res) => {
    const actor = currentAccount(res.locals);
    if (actor.role !== 'admin' && actor.id !== req.params.userId) fail(403, 'forbidden', '仅管理员和本人可以读取资格依据记录。');
    if (Object.keys(req.query).length) fail(400, 'invalid_query', '资格历史不接受查询参数。');
    res.json({ userId: req.params.userId, items: await repo.qualificationHistory(req.params.userId) });
  });
  router.post('/qualifications/:userId', async (req, res) => {
    if (currentAccount(res.locals).role !== 'admin') fail(403, 'forbidden', '仅管理员可以登记资格核验或撤销。');
    if (!exact(req.body, ['qualification', 'expectedRevision']) || !version(req.body.expectedRevision, true)) fail(400, 'invalid_qualification', '请携带资格信息和当前修订号。');
    res.status(201).json(await repo.saveQualification(req.params.userId, validateQualification(req.body.qualification), req.body.expectedRevision, currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.get('/professional/:id', async (req, res) => {
    if (Object.keys(req.query).length) fail(400, 'invalid_query', '审校详情不接受查询参数。');
    res.json(await repo.professionalDetail(req.params.id));
  });
  router.post('/professional/:id', async (req, res) => {
    res.json(await repo.recordProfessionalReview(req.params.id, validateProfessionalDecision(req.body), currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  const editor: RequestHandler = (_req, res, next) => {
    if (currentAccount(res.locals).role === 'reviewer') fail(403, 'forbidden', '审阅账号不能修改来源或草稿。');
    next();
  };
  router.get('/sources', async (req, res) => {
    const { page, pageSize } = pagination(req.query, ['q']); const q = String(req.query.q || '').trim();
    if (q.length > 80) fail(400, 'invalid_query', '搜索最多 80 字。');
    res.json(await repo.sources(q, page, pageSize));
  });
  router.get('/sources/:id', async (req, res) => {
    const keys = Object.keys(req.query);
    const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
    if (keys.some((key) => key !== 'revision' || typeof req.query[key] !== 'string') || (revision !== undefined && !version(revision))) fail(400, 'invalid_query', '来源版本无效。');
    const source = await repo.source(req.params.id, revision);
    if (!source) fail(404, 'not_found', '来源或版本不存在。');
    res.json(source);
  });
  router.post('/sources', editor, async (req, res) => {
    res.status(201).json(await repo.saveSource(validateSource(req.body), currentAccount(res.locals), undefined, 0, currentSessionToken(res.locals)));
  });
  router.put('/sources/:id', editor, async (req, res) => {
    if (!exact(req.body, ['source', 'expectedRevision']) || !version(req.body.expectedRevision)) fail(400, 'invalid_source', '请携带来源内容和当前修订号。');
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    res.json(await repo.saveSource(validateSource(req.body.source), currentAccount(res.locals), id, req.body.expectedRevision, currentSessionToken(res.locals)));
  });
  router.get('/ingredients/:id', async (req, res) => {
    if (!await catalog.ingredient(req.params.id)) fail(404, 'not_found', '食材不存在。');
    res.json(await repo.detail(req.params.id));
  });
  router.get('/ingredients/:id/revisions/:revision', async (req, res) => {
    const revision = Number(req.params.revision);
    if (!version(revision)) fail(400, 'invalid_query', '内容修订号无效。');
    const item = await repo.revision(req.params.id, revision);
    if (!item) fail(404, 'not_found', '内容修订不存在。');
    res.json(item);
  });
  router.put('/ingredients/:id', editor, async (req, res) => {
    if (!exact(req.body, ['content', 'expectedLockVersion']) || !version(req.body.expectedLockVersion, true)) fail(400, 'invalid_content', '请携带草稿内容和当前协作版本。');
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    res.json(await repo.saveDraft(id, validateContent(req.body.content), req.body.expectedLockVersion, currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.post('/ingredients/:id/submit', editor, async (req, res) => {
    if (!exact(req.body, ['expectedLockVersion']) || !version(req.body.expectedLockVersion)) fail(400, 'invalid_content', '请携带当前协作版本。');
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    res.json(await repo.submit(id, req.body.expectedLockVersion, currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.get('/tasks', async (req, res) => {
    const { page, pageSize } = pagination(req.query, ['status']); const status = String(req.query.status || 'pending');
    if (!['pending', 'accepted', 'returned'].includes(status)) fail(400, 'invalid_query', '审阅任务状态无效。');
    res.json(await repo.tasks(status as ReviewTask['status'], page, pageSize));
  });
  router.get('/tasks/:id', async (req, res) => {
    const task = await repo.task(req.params.id);
    if (!task) fail(404, 'not_found', '审阅任务不存在。');
    res.json(task);
  });
  router.post('/tasks/:id/decision', async (req, res) => {
    if (!exact(req.body, ['decision', 'comment', 'expectedLockVersion']) || typeof req.body.decision !== 'string' || !['accept', 'return'].includes(req.body.decision) ||
      typeof req.body.comment !== 'string' || req.body.comment.length > 1000 || !req.body.comment.trim() || !version(req.body.expectedLockVersion)) fail(400, 'invalid_decision', '请提供审阅结果、意见和当前协作版本。');
    if (currentAccount(res.locals).role === 'editor') fail(403, 'forbidden', '编辑账号不能作出审阅决定。');
    res.json(await repo.decide(req.params.id, req.body.decision as 'accept' | 'return', req.body.comment, req.body.expectedLockVersion, currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.get('/events', async (req, res) => {
    if (Object.keys(req.query).length) fail(400, 'invalid_query', '操作记录不支持此查询参数。');
    res.json({ items: await repo.events() });
  });
  app.use('/api/v1/editorial', router);
}
