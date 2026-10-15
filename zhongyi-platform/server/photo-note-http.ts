import type { Express } from 'express';
import { currentAccount, writeAuthority } from './auth-http.js';
import { AccountError } from './auth.js';
import type { PhotoNoteStore } from './photo-note-service.js';
import type { PrivatePhotoRegistry } from './private-photos.js';
import { photoId } from '../shared/private-photos.js';

// Separate namespace: the original-byte and candidate-list routes remain GET-only.
export function configurePhotoNotes(app: Express, store: PhotoNoteStore, registry?: PrivatePhotoRegistry): void {
  app.use('/api/v1/private-photo-notes', (req, res, next) => {
    currentAccount(res.locals);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!['GET', 'POST'].includes(req.method) || Object.keys(req.query).length || req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.method === 'GET' && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'])) ||
      (req.method === 'POST' && !req.is('application/json'))) {
      throw new AccountError(400, 'invalid_photo_note_request', '核对记录请求格式无效。');
    }
    next();
  });
  const candidate = (id: string) => {
    const photo = photoId(id) ? registry?.candidate(id) : undefined;
    if (!photo) throw new AccountError(404, 'photo_unavailable', '该候选不可用，请重新读取图片资料。');
    return photo;
  };
  app.get('/api/v1/private-photo-notes/:id', async (req, res) => { res.json(await store.detail(candidate(req.params.id))); });
  app.post('/api/v1/private-photo-notes/:id', async (req, res) => {
    const authority = writeAuthority(res.locals);
    if (!authority || !['admin', 'editor'].includes(authority.account.role)) throw new AccountError(403, 'forbidden', '当前账号只能查看图片核对记录。');
    res.status(201).json(await store.save(candidate(req.params.id), req.body, authority));
  });
}
