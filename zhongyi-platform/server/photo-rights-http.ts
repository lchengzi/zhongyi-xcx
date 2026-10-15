import type { Express } from 'express';
import { currentAccount, writeAuthority } from './auth-http.js';
import { AccountError } from './auth.js';
import type { PhotoRightsStore } from './photo-rights-service.js';
import type { PrivatePhotoRegistry } from './private-photos.js';
import { photoId } from '../shared/private-photos.js';

export function configurePhotoRights(app: Express, store: PhotoRightsStore, registry?: PrivatePhotoRegistry): void {
  app.use('/api/v1/private-photo-rights', (req, res, next) => {
    currentAccount(res.locals); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!['GET', 'POST'].includes(req.method) || Object.keys(req.query).length || req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.method === 'GET' && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'])) ||
      (req.method === 'POST' && !req.is('application/json'))) throw new AccountError(400, 'invalid_photo_rights_request', '图片权利审核请求格式无效。');
    next();
  });
  const candidate = (id: string) => {
    const photo = photoId(id) ? registry?.candidate(id) : undefined;
    if (!photo) throw new AccountError(404, 'photo_unavailable', '该候选不可用，请重新读取图片资料。');
    return photo;
  };
  app.get('/api/v1/private-photo-rights/:id', async (req, res) => { res.json(await store.detail(candidate(req.params.id))); });
  app.post('/api/v1/private-photo-rights/:id', async (req, res) => {
    const authority = writeAuthority(res.locals);
    if (!authority || !['admin', 'reviewer'].includes(authority.account.role)) throw new AccountError(403, 'forbidden', '当前账号只能查看图片权利审核。');
    res.status(201).json(await store.review(candidate(req.params.id), req.body, authority));
  });
}
