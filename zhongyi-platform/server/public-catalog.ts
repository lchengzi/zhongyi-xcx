import type { Express } from 'express';
import type { CatalogSeed, PublishedEducation } from '../shared/contracts.js';
import type { CatalogStore, PublicationStore } from './stores.js';
import { reportRequestFailure } from './failure-diagnostics.js';
import { AccountError } from './auth.js';
import type { PhotoPublicationService } from './photo-publication-service.js';

// This is the already-public, imported historical reference, NOT the editorial store.
// New drafts, source registry entries and editorial decisions never enter this route.
export function publicCatalog(seed: CatalogSeed) {
  return {
    schemaVersion: 1 as const,
    purpose: 'historical_catalog_reference' as const,
    releaseId: seed.releaseId,
    releaseDigest: seed.releaseDigest,
    contentVersion: seed.contentVersion,
    sourceAsOf: seed.sourceAsOf,
    items: seed.ingredients.map((item) => ({
      id: item.id, name: item.name, pinyin: item.pinyin, aliases: item.aliases.slice(),
      batch: item.batch, latinName: item.latinName, ediblePart: item.ediblePart,
      identityState: item.identityState, professionalReviewState: item.professionalReviewState,
      restriction: item.restriction,
      sources: item.sources.map((source) => ({
        id: source.id, title: source.title, publisher: source.publisher, url: source.url,
        status: source.status, checkedAt: source.checkedAt
      }))
    }))
  };
}

function educationView(item: PublishedEducation): PublishedEducation {
  return { scope: item.scope, ingredientId: item.ingredientId, name: item.name,
    snapshotId: item.snapshotId, snapshotVersion: item.snapshotVersion, contentRevision: item.contentRevision,
    baseReleaseId: item.baseReleaseId, publishedAt: item.publishedAt, ediblePart: item.ediblePart, latinName: item.latinName,
    educationText: item.educationText, safetyText: item.safetyText, boundary: item.boundary,
    sources: item.sources.map((s) => ({ title: s.title, publisher: s.publisher, url: s.url, locator: s.locator, checkedAt: s.checkedAt, validUntil: s.validUntil })) };
}

export function configurePublicCatalog(app: Express, repo: CatalogStore, publication?: { store: PublicationStore; enabled: boolean }, photos?: PhotoPublicationService): void {
  // Mount BEFORE authentication, but fence the entire public namespace. There is
  // fixed historical GET plus an explicitly enabled education GET. No search,
  // profile parameters, private snapshots, history endpoints or public writes.
  app.use('/api/v1/public', async (req, res) => {
    const education = /^\/education\/([a-z0-9][a-z0-9-]{0,79})$/.exec(req.path);
    const gallery = /^\/photos\/([a-z0-9][a-z0-9-]{0,79})$/.exec(req.path);
    const asset = /^\/photos\/([a-z0-9][a-z0-9-]{0,79})\/([1-9][0-9]{0,4})\/([a-f0-9]{64})\.jpg$/.exec(req.path);
    const batch = /^\/photos\/batch\/([a-z0-9][a-z0-9-]{0,79}(?:,[a-z0-9][a-z0-9-]{0,79}){0,11})$/.exec(req.path);
    if ((req.path !== '/catalog' && !education && !gallery && !asset && !batch) || req.method !== 'GET') {
      res.status(404).json({ error: 'not_found', message: '公开接口不存在。' }); return;
    }
    if (Object.keys(req.query).length || Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) {
      res.status(400).json({ error: 'invalid_query', message: education ? '公开教育请求不接受查询参数或正文。' : '公开目录请求不接受查询参数或正文。' }); return;
    }
    if (gallery || asset || batch) {
      if (!photos) { res.status(503).json({ error: 'photo_publication_disabled', message: '图片暂不可用。' }); return; }
      try {
        if (batch) res.json(await photos.batch(batch[1].split(',')));
        else if (gallery) res.json(await photos.gallery(gallery[1]));
        else if (asset) res.type('image/jpeg').send(await photos.asset(asset[1], Number(asset[2]), asset[3]));
      } catch (error) {
        const status = error instanceof AccountError && [400, 404, 410, 503].includes(error.status) ? error.status : 503;
        if (status === 503) reportRequestFailure(error, status);
        res.status(status).type('application/json').json({ error: status === 503 ? 'photos_unavailable' : 'photo_unavailable', message: '图片暂不可用。' });
      }
      return;
    }
    if (education) {
      if (publication?.enabled !== true) {
        res.status(503).json({ error: 'publication_disabled', message: '教育发布能力未启用，请使用本地资料。' }); return;
      }
      try {
        const seed = await repo.publicSnapshot();
        const ingredient = seed.ingredients.find((item) => item.id === education[1]);
        if (!ingredient) { res.status(404).json({ error: 'not_found', message: '公开教育内容不可用。' }); return; }
        const item = await publication.store.published(ingredient.id, true);
        if (!item) { res.status(404).json({ error: 'not_found', message: '公开教育内容不可用。' }); return; }
        if (item.ingredientId !== ingredient.id || item.name !== ingredient.name || item.baseReleaseId !== seed.releaseId) throw new Error('Publication identity does not match the verified catalog');
        res.json(educationView(item));
      } catch (error) {
        reportRequestFailure(error, 503);
        res.status(503).json({ error: 'education_unavailable', message: '公开教育内容暂不可用，请使用本地资料。' });
      }
      return;
    }
    try { res.json(publicCatalog(await repo.publicSnapshot())); }
    catch (error) {
      reportRequestFailure(error, 503);
      // An out-of-band database edit must not silently become public content.
      res.status(503).json({ error: 'catalog_unavailable', message: '目录版本校验失败，请使用本地资料。' });
    }
  });
}
