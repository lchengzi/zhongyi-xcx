import type { DatabaseSync } from 'node:sqlite';
import { AuthRepository } from './auth.js';
import { PhotoSubmissionRepository } from './photo-submissions.js';
import { ownPhotoRights, requirePhotoRightsReviewer, nextPhotoRights, photoRightsDetail, type PhotoRightsStore } from './photo-rights-service.js';
import { PHOTO_RIGHTS_INSERT, photoRightsFrom, photoRightsValues } from './photo-rights-values.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from './stores.js';
export class PhotoRightsRepository implements PhotoRightsStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}
  private transaction<T>(write: boolean, work: () => T): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private facts(candidate: PrivatePhoto) {
    const basis = new PhotoSubmissionRepository(this.db).detailInTransaction(candidate);
    const history = this.db.prepare('SELECT * FROM photo_rights_reviews WHERE candidate_id = ? ORDER BY version DESC LIMIT 50').all(candidate.id).map(photoRightsFrom);
    const detail = photoRightsDetail(candidate, basis, history, new AuthRepository(this.db).users(), this.now());
    return { basis, detail };
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.transaction(false, () => this.facts(candidate).detail); }
  async review(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoRights(value, raw, authority);
    return this.transaction(true, () => {
      requirePhotoRightsReviewer(new AuthRepository(this.db).session(owned.authority.token)?.user, owned.authority);
      const { basis, detail } = this.facts(owned.candidate);
      const contributors = this.db.prepare('SELECT actor_id FROM photo_notes WHERE candidate_id = ? UNION SELECT actor_id FROM photo_submissions WHERE candidate_id = ?').all(owned.candidate.id, owned.candidate.id).map(row => String(row.actor_id));
      const item = nextPhotoRights(owned.candidate, basis, detail, contributors, owned.input, owned.authority.account, this.now());
      this.db.prepare(PHOTO_RIGHTS_INSERT).run(...photoRightsValues(item)); return item;
    });
  }
}
