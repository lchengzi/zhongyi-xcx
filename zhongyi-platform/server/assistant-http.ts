import { Router, type Express } from 'express';
import type { RepositoryBundle } from './stores.js';
import type { AssistantProvider } from './assistant-provider.js';
import { providerFromEnv } from './assistant-provider.js';
import { AssistantService } from './assistant-service.js';
import { currentAccount, currentSessionToken } from './auth-http.js';
import { exact, fail } from './workflow.js';
import { validateExcerpt } from './assistant-values.js';
import { limitsFromEnv } from './assistant-limits.js';
import type { AssistantLimits, AssistantMode } from '../shared/contracts.js';
import { isAssistantMode } from '../shared/assistant-tasks.js';

export function configureAssistant(app: Express, stores: RepositoryBundle, provider: AssistantProvider = providerFromEnv(), limits: AssistantLimits = limitsFromEnv()): void {
  const router = Router(); const service = new AssistantService(stores, provider, limits);
  router.use((_req, res, next) => { currentAccount(res.locals); next(); });
  router.get('/config', (_req, res) => { res.json(provider.config); });
  router.get('/quota', async (_req, res) => { res.json(await stores.assistant.quota(currentAccount(res.locals).id, limits)); });
  router.put('/excerpts/:id/permission', async (req, res) => {
    if (!exact(req.body, ['allowExternal', 'expectedRevision']) || typeof req.body.allowExternal !== 'boolean' || !Number.isSafeInteger(req.body.expectedRevision) || (req.body.expectedRevision as number) < 0) fail(400, 'invalid_permission', '许可需明确布尔值和当前修订号。');
    res.json(await stores.assistant.permission(req.params.id, req.body.allowExternal, req.body.expectedRevision as number, currentAccount(res.locals), currentSessionToken(res.locals)!));
  });
  router.get('/events', async (_req, res) => {
    if (currentAccount(res.locals).role !== 'admin') fail(403, 'forbidden', '仅管理员可查看辅助调用记录。');
    res.json({ items: await stores.assistant.events() });
  });
  router.get('/ingredients/:id/excerpts', async (req, res) => {
    if (Object.keys(req.query).some((key) => key !== 'q' || typeof req.query[key] !== 'string')) fail(400, 'invalid_query', '摘录检索参数无效。');
    const q = String(req.query.q || '').trim(); if (q.length > 80) fail(400, 'invalid_query', '检索最多 80 字。');
    if (!await stores.catalog.ingredient(req.params.id)) fail(404, 'not_found', '食材不存在。');
    res.json({ items: await stores.assistant.excerpts(req.params.id, q), limit: 50 });
  });
  router.post('/ingredients/:id/excerpts', async (req, res) => {
    const input = validateExcerpt(req.body);
    res.status(201).json(await stores.assistant.saveExcerpt(req.params.id, input, currentAccount(res.locals), currentSessionToken(res.locals)!));
  });
  router.get('/ingredients/:id/excerpts/:excerptId', async (req, res) => {
    if (Object.keys(req.query).length) fail(400, 'invalid_query', '固定摘录读取不接受额外参数。');
    const excerpt = await stores.assistant.excerpt(req.params.excerptId);
    if (!excerpt || excerpt.ingredientId !== req.params.id) fail(404, 'not_found', '摘录不存在。');
    res.json(excerpt);
  });
  router.post('/ingredients/:id/generate', async (req, res) => {
    const hasMode = req.body && Object.hasOwn(req.body, 'mode');
    if (!exact(req.body, hasMode ? ['evidenceIds', 'confirmExternalTransfer', 'mode'] : ['evidenceIds', 'confirmExternalTransfer']) ||
      (hasMode && !isAssistantMode(req.body.mode)) || !Array.isArray(req.body.evidenceIds) || req.body.evidenceIds.length > 6 ||
      req.body.evidenceIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) || new Set(req.body.evidenceIds).size !== req.body.evidenceIds.length ||
      typeof req.body.confirmExternalTransfer !== 'boolean') fail(400, 'invalid_assistant_request', '请选择最多 6 条唯一原文摘录，并明确本次发送许可；不接受自由医疗问题。');
    const ids = req.body.evidenceIds.slice() as string[]; const consent = req.body.confirmExternalTransfer; const mode: AssistantMode = hasMode ? req.body.mode as AssistantMode : 'extract';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    const cancelled = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancelled);
    try { res.json(await service.generate(req.params.id, ids, consent, currentAccount(res.locals), currentSessionToken(res.locals)!, controller.signal, mode)); }
    finally { clearTimeout(timer); res.off('close', cancelled); }
  });
  app.use('/api/v1/editorial/assistant', router);
}
