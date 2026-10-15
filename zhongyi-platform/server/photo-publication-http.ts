import type { Express } from 'express';
import { AccountError } from './auth.js';
import { currentAccount, writeAuthority } from './auth-http.js';
import { photoId } from '../shared/private-photos.js';
import type { PhotoPublicationService } from './photo-publication-service.js';
import type { PhotoDerivativeRegistry } from './photo-derivative-registry.js';

export function configurePhotoPublication(app: Express, service?: PhotoPublicationService, derivatives: PhotoDerivativeRegistry | undefined = service?.derivatives): void {
  app.use('/api/v1/private-photo-derivatives', (req, res, next) => {
    currentAccount(res.locals); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method !== 'GET' || Object.keys(req.query).length || req.get('Sec-Fetch-Site') === 'cross-site' ||
      Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) throw new AccountError(400, 'invalid_photo_derivative_request', '展示图请求格式无效。');
    if (!derivatives) throw new AccountError(503, 'photo_publication_disabled', '展示图尚未配置。');
    next();
  });
  const derivative = (id: string) => {
    const value = photoId(id) ? derivatives?.metadata(id) : undefined;
    if (!value) throw new AccountError(404, 'not_found', '当前候选尚无展示图。');
    return value;
  };
  app.get('/api/v1/private-photo-derivatives/:id', (req, res) => { res.json(derivative(req.params.id)); });
  app.get('/api/v1/private-photo-derivatives/:id/image', (req, res) => {
    derivative(req.params.id); const bytes = derivatives!.asset(req.params.id);
    if (!bytes) throw new AccountError(404, 'not_found', '展示图不可用。');
    res.type('image/jpeg').send(bytes);
  });
  app.use('/api/v1/editorial/photo-publications', (req, res, next) => {
    currentAccount(res.locals); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!['GET', 'POST'].includes(req.method) || Object.keys(req.query).length || req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.method === 'GET' && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'])) ||
      (req.method === 'POST' && !req.is('application/json'))) throw new AccountError(400, 'invalid_photo_publication_request', '图片发布请求格式无效。');
    if (!service) throw new AccountError(503, 'photo_publication_disabled', '图片发布尚未配置。');
    next();
  });
  app.get('/api/v1/editorial/photo-publications/:id', async (req, res) => {
    if (!photoId(req.params.id) || req.params.id.length > 80) throw new AccountError(404, 'not_found', '未找到食材。');
    res.json(await service!.history(req.params.id));
  });
  app.post('/api/v1/editorial/photo-publications/:id', async (req, res) => {
    const authority = writeAuthority(res.locals);
    if (!authority || authority.account.role !== 'admin') throw new AccountError(403, 'forbidden', '图片发布需要管理员权限。');
    if (!photoId(req.params.id) || req.params.id.length > 80) throw new AccountError(404, 'not_found', '未找到食材。');
    res.status(201).json(await service!.publish(req.params.id, req.body, authority));
  });
}
