import type { DatabaseSync } from 'node:sqlite';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { AuthRepository } from './auth.js';
import { ownPhotoProfessional, requirePhotoProfessionalReviewer, photoProfessionalDetail, nextPhotoProfessional, type PhotoProfessionalStore } from './photo-professional-policy.js';
import { photoProfessionalData, requirePhotoProfessionalHistory } from './photo-professional-data.js';
import { PHOTO_PROFESSIONAL_INSERT, photoProfessionalValues } from './photo-professional-values.js';
import type { WriteAuthority } from './stores.js';

export class PhotoProfessionalRepository implements PhotoProfessionalStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}
  private transaction<T>(write: boolean, work: () => T): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private data(candidate: PrivatePhoto, now: number) {
    return photoProfessionalData(candidate, {
      notes: this.db.prepare('SELECT * FROM photo_notes WHERE candidate_id = ? ORDER BY version DESC').all(candidate.id),
      submissions: this.db.prepare('SELECT * FROM photo_submissions WHERE candidate_id = ? ORDER BY version DESC').all(candidate.id),
      rights: this.db.prepare('SELECT * FROM photo_rights_reviews WHERE candidate_id = ? ORDER BY version DESC').all(candidate.id),
      reviews: this.db.prepare('SELECT * FROM photo_professional_reviews WHERE candidate_id = ? ORDER BY version DESC LIMIT 10001').all(candidate.id),
      qualifications: this.db.prepare('SELECT * FROM professional_qualifications ORDER BY user_id, revision DESC').all()
    }, new AuthRepository(this.db).users(), !!this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(candidate.ingredientId), now);
  }
  async detail(value: PrivatePhoto) {
    const candidate = parsePrivatePhoto(value);
    return this.transaction(false, () => { const now = this.now(); return photoProfessionalDetail(this.data(candidate, now).facts, now); });
  }
  async review(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoProfessional(value, raw, authority);
    return this.transaction(true, () => {
      requirePhotoProfessionalReviewer(new AuthRepository(this.db).session(owned.authority.token)?.user, owned.authority);
      const now = this.now(), { facts, history } = this.data(owned.candidate, now);
      const item = nextPhotoProfessional(facts, owned.input, owned.authority.account, now);
      requirePhotoProfessionalHistory({ ...history, reviews: [item, ...history.reviews] });
      this.db.prepare(PHOTO_PROFESSIONAL_INSERT).run(...photoProfessionalValues(item)); return item;
    });
  }
}
