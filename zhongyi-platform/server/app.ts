import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { CatalogRepository, RevisionConflict } from './database.js';
import { actorName, configureAuth, requireEditor, writeAuthority, type AuthOptions } from './auth-http.js';
import { AccountError, AuthRepository } from './auth.js';
import { configureWorkflow } from './workflow-http.js';
import { configurePublicCatalog } from './public-catalog.js';
import { WorkflowRepository } from './workflow.js';
import { AssistantRepository } from './assistant-repository.js';
import { PublicationRepository } from './publication.js';
import { configurePublication } from './publication-http.js';
import { configureAssistant } from './assistant-http.js';
import type { AssistantProvider } from './assistant-provider.js';
import type { RepositoryBundle } from './stores.js';
import type { AssistantLimits } from '../shared/contracts.js';
import { requestDiagnostics, type RequestLogSink } from './request-log.js';
import { reportRequestFailure, type FailureSink } from './failure-diagnostics.js';
import { configurePrivatePhotos, type PrivatePhotoRegistry } from './private-photos.js';
import { PhotoNoteRepository } from './photo-notes.js';
import { PhotoSubmissionRepository } from './photo-submissions.js';
import { PhotoRightsRepository } from './photo-rights.js';
import { PhotoProfessionalRepository } from './photo-professional.js';
import { configurePhotoNotes } from './photo-note-http.js';
import { configurePhotoSubmissions } from './photo-submission-http.js';
import { configurePhotoRights } from './photo-rights-http.js';
import { configurePhotoProfessional } from './photo-professional-http.js';
import { configurePhotoPublication } from './photo-publication-http.js';
import { PhotoPublicationService } from './photo-publication-service.js';
import type { PhotoDerivativeRegistry } from './photo-derivative-registry.js';
import type { PhotoPublicationJournal } from './photo-publication-journal.js';
import { configureEditorialReferences, type EditorialReferenceRegistry } from './editorial-references.js';

export function createApp(input: CatalogRepository | RepositoryBundle, authentication: AuthOptions | string, staticRoot?: string, options: { assistantProvider?: AssistantProvider; assistantLimits?: AssistantLimits; publicationEnabled?: boolean; requestLog?: RequestLogSink; failureLog?: FailureSink; privatePhotos?: PrivatePhotoRegistry; privateDerivatives?: PhotoDerivativeRegistry; editorialReferences?: EditorialReferenceRegistry; photoPublication?: { derivatives: PhotoDerivativeRegistry; journal: PhotoPublicationJournal; enabled: boolean } } = {}) {
  if (options.privatePhotos && (typeof authentication === 'string' || authentication.mode !== 'accounts')) throw new Error('Private photos require account authentication');
  options.privatePhotos?.assertStaticIsolation(staticRoot);
  if (options.editorialReferences) {
    if (typeof authentication === 'string' || authentication.mode !== 'accounts') throw new Error('Research references require account authentication');
    if (staticRoot) options.editorialReferences.assertIsolation(staticRoot);
  }
  const privateDerivatives = options.privateDerivatives ?? options.photoPublication?.derivatives;
  if (privateDerivatives) {
    if (typeof authentication === 'string' || authentication.mode !== 'accounts' || privateDerivatives.originals !== options.privatePhotos ||
      (options.privateDerivatives && options.photoPublication && options.privateDerivatives !== options.photoPublication.derivatives)) throw new Error('Private display photos require one bound account-only library');
    if (staticRoot) privateDerivatives.assertIsolation(staticRoot);
  }
  if (options.photoPublication) {
    if (typeof authentication === 'string' || authentication.mode !== 'accounts' || options.photoPublication.derivatives.originals !== options.privatePhotos || typeof options.photoPublication.enabled !== 'boolean') throw new Error('Photo publication requires explicit private account configuration');
    if (staticRoot) {
      options.photoPublication.derivatives.assertIsolation(staticRoot);
      const paths = [resolve(staticRoot).toLowerCase(), resolve(options.photoPublication.journal.root).toLowerCase()];
      for (const [i, path] of paths.entries()) if (path === paths[1 - i] || path.startsWith(paths[1 - i] + sep)) throw new Error('Photo journal overlaps static hosting');
    }
  }
  if (options.publicationEnabled !== undefined && typeof options.publicationEnabled !== 'boolean') throw new Error('Publication enablement must be an explicit boolean');
  const publicationEnabled = options.publicationEnabled === true;
  if (publicationEnabled && (typeof authentication === 'string' || authentication.mode !== 'accounts')) throw new Error('Publication requires account authentication');
  const sqliteWorkflow = input instanceof CatalogRepository ? new WorkflowRepository(input.db) : undefined;
  const stores: RepositoryBundle = input instanceof CatalogRepository ? {
    engine: 'sqlite', catalog: input, auth: new AuthRepository(input.db), workflow: sqliteWorkflow!, assistant: new AssistantRepository(input.db), publication: new PublicationRepository(input.db, sqliteWorkflow!), photoNotes: new PhotoNoteRepository(input.db), photoSubmissions: new PhotoSubmissionRepository(input.db), photoRights: new PhotoRightsRepository(input.db), photoProfessional: new PhotoProfessionalRepository(input.db), close: () => input.close()
  } : input;
  const repo = stores.catalog;
  const photos = options.photoPublication && new PhotoPublicationService(stores, options.photoPublication.derivatives, options.photoPublication.journal, options.photoPublication.enabled);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', requestDiagnostics(options.requestLog, options.failureLog));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // No forwarded-header trust is enabled. Only an actual TLS socket qualifies.
    if (req.secure && process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=86400');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:${options.privatePhotos || options.editorialReferences ? ' blob:' : ''}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    next();
  });
  app.get('/api/health', (_req, res) => { res.json({ ok: true, mode: 'local_editorial_demo' }); });
  app.get('/api/ready', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || Object.keys(req.query).length || Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) {
      res.status(400).json({ ok: false }); return;
    }
    try { await repo.publicSnapshot(); res.json({ ok: true }); }
    catch (error) { reportRequestFailure(error, 503); res.status(503).json({ ok: false }); }
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1/editorial', express.json({ limit: '32kb' }));
  // Rights plans have four bounded text fields; their valid UTF-8 payload can
  // exceed the general 8kb editor limit. Keep this allowance route-specific.
  app.use('/api/v1/private-photo-rights', express.json({ limit: '16kb' }));
  app.use('/api', express.json({ limit: '8kb' }));
  configurePublicCatalog(app, repo, { store: stores.publication, enabled: publicationEnabled }, photos);
  configureAuth(app, stores.auth, typeof authentication === 'string' ? { mode: 'local-key', token: authentication } : authentication);
  configurePrivatePhotos(app, options.privatePhotos);
  configureEditorialReferences(app, options.editorialReferences);
  configurePhotoNotes(app, stores.photoNotes, options.privatePhotos);
  configurePhotoSubmissions(app, stores.photoSubmissions, options.privatePhotos);
  configurePhotoRights(app, stores.photoRights, options.privatePhotos);
  configurePhotoProfessional(app, stores.photoProfessional, options.privatePhotos);
  configurePhotoPublication(app, photos, privateDerivatives);
  configureAssistant(app, stores, options.assistantProvider, options.assistantLimits);
  configurePublication(app, stores.publication, publicationEnabled);
  configureWorkflow(app, repo, stores.workflow);
  app.get('/api/v1/summary', async (_req, res) => { res.json(await repo.summary()); });
  app.get('/api/v1/events', async (_req, res) => { res.json({ items: await repo.events() }); });
  app.get('/api/v1/ingredients', async (req, res) => {
    const keys = Object.keys(req.query);
    if (keys.some((key) => !['q', 'page', 'pageSize'].includes(key)) ||
      keys.some((key) => typeof req.query[key] !== 'string')) {
      res.status(400).json({ error: 'invalid_query', message: '查询参数无效。' }); return;
    }
    const q = String(req.query.q || '').trim();
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 12);
    if (q.length > 80 || !Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      res.status(400).json({ error: 'invalid_query', message: '搜索最多 80 字，分页范围无效。' }); return;
    }
    res.json(await repo.list(q, page, pageSize));
  });
  app.get('/api/v1/ingredients/:id', async (req, res) => {
    const item = await repo.ingredient(req.params.id);
    if (!item) { res.status(404).json({ error: 'not_found', message: '未找到食材。' }); return; }
    res.json({ ingredient: item, note: await repo.note(item.id) });
  });
  app.put('/api/v1/ingredients/:id/note', requireEditor, async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
      typeof body.text !== 'string' || body.text.trim().length > 1200 || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
      res.status(400).json({ error: 'invalid_note', message: '备注最多 1200 字，并需携带当前修订号。' }); return;
    }
    if (!await repo.ingredient(id)) { res.status(404).json({ error: 'not_found', message: '未找到食材。' }); return; }
    try { res.json(await repo.saveNote(id, body.text.trim(), body.expectedRevision, actorName(res.locals), writeAuthority(res.locals))); }
    catch (error) {
      if (error instanceof RevisionConflict) { res.status(409).json({ error: 'revision_conflict', message: '另一窗口已修改备注，请先重新加载；当前输入尚未保存。' }); return; }
      throw error;
    }
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'not_found', message: '接口不存在。' }); });
  if (staticRoot && existsSync(resolve(staticRoot, 'index.html'))) app.use(express.static(staticRoot, { dotfiles: 'deny' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AccountError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) reportRequestFailure(error, status);
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_body', message: status === 500 ? '服务暂时不可用。' : '请求内容无效或过大。' });
  };
  app.use(errors);
  return app;
}
