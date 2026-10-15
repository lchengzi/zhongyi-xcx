import { Router, type Express, type RequestHandler } from 'express';
import type { PublicationSnapshot, PublicationSnapshotView } from '../shared/contracts.js';
import type { PublicationStore } from './stores.js';
import { currentAccount, currentSessionToken } from './auth-http.js';
import { fail } from './workflow.js';
import { validateActionInput, validateApprovalInput, validateControlInput, validateSnapshotInput } from './publication-values.js';

const parameter = (value: unknown): string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : fail(400, 'invalid_publication', '发布记录标识无效。');

export function publicationSnapshotView(item: PublicationSnapshot): PublicationSnapshotView {
  return { ...item, basis: { ...item.basis, qualifications: item.basis.qualifications.map((q) => ({
    userId: q.userId, revision: q.revision, accountRevision: q.accountRevision, profession: q.profession,
    status: q.status, evidenceKind: q.evidenceKind, validUntil: q.validUntil, digest: q.digest
  })) } };
}

export function configurePublication(app: Express, repo: PublicationStore, enabled = false): void {
  const router = Router();
  router.use((req, res, next) => {
    currentAccount(res.locals);
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(404).json({ error: 'not_found', message: '发布操作接口不存在。' }); return; }
    if (Object.keys(req.query).length || (req.method === 'GET' && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']))) fail(400, 'invalid_query', '发布操作不接受查询参数，读取不接受正文。');
    next();
  });
  const admin: RequestHandler = (_req, res, next) => {
    if (currentAccount(res.locals).role !== 'admin') fail(403, 'forbidden', '仅管理员可以批准、发布或变更冻结状态。');
    next();
  };
  router.get('/publication-controls', admin, async (_req, res) => {
    res.json({ enabled, items: await repo.controlHistory() });
  });
  router.post('/publication-controls', admin, async (req, res) => {
    res.status(201).json(await repo.control(validateControlInput(req.body), currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.get('/publications/:id', async (req, res) => {
    const workspace = await repo.workspace(parameter(req.params.id), enabled);
    res.json({ ...workspace, snapshots: workspace.snapshots.map(publicationSnapshotView) });
  });
  router.get('/publications/:id/versions/:version', async (req, res) => {
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(version) || version < 1 || String(version) !== req.params.version) fail(400, 'invalid_publication', '固定快照版本无效。');
    const workspace = await repo.workspace(parameter(req.params.id), enabled, version);
    res.json({ ...workspace, snapshots: workspace.snapshots.map(publicationSnapshotView) });
  });
  router.get('/publications/:id/snapshots/:snapshotId', async (req, res) => {
    res.json(publicationSnapshotView(await repo.snapshot(parameter(req.params.id), parameter(req.params.snapshotId))));
  });
  router.post('/publications/:id/snapshots', async (req, res) => {
    const actor = currentAccount(res.locals);
    if (actor.role === 'reviewer') fail(403, 'forbidden', '审阅账号不能整理发布快照。');
    const item = await repo.createSnapshot(parameter(req.params.id), validateSnapshotInput(req.body), actor, currentSessionToken(res.locals));
    res.status(201).json(publicationSnapshotView(item));
  });
  router.post('/publications/:id/approvals', admin, async (req, res) => {
    res.status(201).json(await repo.approve(parameter(req.params.id), validateApprovalInput(req.body), currentAccount(res.locals), currentSessionToken(res.locals)));
  });
  router.post('/publications/:id/actions', admin, async (req, res) => {
    res.status(201).json(await repo.action(parameter(req.params.id), validateActionInput(req.body), currentAccount(res.locals), currentSessionToken(res.locals), enabled));
  });
  // Scope the router: unrelated editorial routes keep their existing contracts.
  app.use('/api/v1/editorial', (req, res, next) => {
    if (/^\/(?:publications|publication-controls)(?:\/|$)/.test(req.path)) router(req, res, next);
    else next();
  });
}
