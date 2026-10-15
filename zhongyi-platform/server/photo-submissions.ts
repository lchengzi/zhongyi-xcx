import type { DatabaseSync } from 'node:sqlite';
import { AuthRepository } from './auth.js';
import { photoNoteDetail, requirePhotoEditor } from './photo-note-service.js';
import { photoNoteFrom } from './photo-note-values.js';
import { nextPhotoSubmission, ownPhotoSubmission, photoSubmissionDetail, type PhotoSubmissionStore } from './photo-submission-service.js';
import { PHOTO_SUBMISSION_INSERT, photoSubmissionFrom, photoSubmissionValues } from './photo-submission-values.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from './stores.js';

export class PhotoSubmissionRepository implements PhotoSubmissionStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}
  private transaction<T>(write: boolean, work: () => T): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  detailInTransaction(candidate: PrivatePhoto) {
    const exists = !!this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(candidate.ingredientId);
    const notes = photoNoteDetail(candidate, this.db.prepare('SELECT * FROM photo_notes WHERE candidate_id = ? ORDER BY version DESC LIMIT 50').all(candidate.id).map(photoNoteFrom), exists);
    const history = this.db.prepare('SELECT * FROM photo_submissions WHERE candidate_id = ? ORDER BY version DESC LIMIT 50').all(candidate.id).map(photoSubmissionFrom);
    return photoSubmissionDetail(candidate, notes, history);
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.transaction(false, () => this.detailInTransaction(candidate)); }
  async submit(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoSubmission(value, raw, authority);
    // Native synchronous transaction: authorization, both heads and insert are atomic.
    return this.transaction(true, () => {
      requirePhotoEditor(new AuthRepository(this.db).session(owned.authority.token)?.user, owned.authority);
      const item = nextPhotoSubmission(owned.candidate, this.detailInTransaction(owned.candidate), owned.input, owned.authority.account, this.now());
      this.db.prepare(PHOTO_SUBMISSION_INSERT).run(...photoSubmissionValues(item));
      return item;
    });
  }
}
