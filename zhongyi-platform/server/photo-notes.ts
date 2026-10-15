import type { DatabaseSync } from 'node:sqlite';
import { nextPhotoNote, ownPhotoNoteWrite, photoNoteDetail, requirePhotoEditor, type PhotoNoteStore } from './photo-note-service.js';
import { AuthRepository } from './auth.js';
import { PHOTO_NOTE_INSERT, photoNoteFrom, photoNoteValues } from './photo-note-values.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from './stores.js';

export class PhotoNoteRepository implements PhotoNoteStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}
  private inTransaction<T>(write: boolean, work: () => T): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private detailIn(candidate: PrivatePhoto) {
    const exists = !!this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(candidate.ingredientId);
    const history = this.db.prepare('SELECT * FROM photo_notes WHERE candidate_id = ? ORDER BY version DESC LIMIT 50').all(candidate.id).map(photoNoteFrom);
    return photoNoteDetail(candidate, history, exists);
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.inTransaction(false, () => this.detailIn(candidate)); }
  async save(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoNoteWrite(value, raw, authority);
    // No awaits or thenables while the shared synchronous connection is locked.
    return this.inTransaction(true, () => {
      const session = new AuthRepository(this.db).session(owned.authority.token), actor = owned.authority.account;
      requirePhotoEditor(session?.user, owned.authority);
      const item = nextPhotoNote(owned.candidate, this.detailIn(owned.candidate), owned.input, actor, this.now());
      this.db.prepare(PHOTO_NOTE_INSERT).run(...photoNoteValues(item));
      return item;
    });
  }
}
