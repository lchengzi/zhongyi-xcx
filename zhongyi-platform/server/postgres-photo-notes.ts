import { nextPhotoNote, ownPhotoNoteWrite, photoNoteDetail, requirePhotoEditor, type PhotoNoteStore } from './photo-note-service.js';
import { PHOTO_NOTE_INSERT, photoNoteFrom, photoNoteValues } from './photo-note-values.js';
import { sessionIn, type PostgresContext, type PostgresRuntime } from './postgres-runtime.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from './stores.js';

export class PostgresPhotoNotes implements PhotoNoteStore {
  constructor(private readonly runtime: PostgresRuntime, private readonly now: () => number = Date.now) {}
  private async detailIn(context: PostgresContext, candidate: PrivatePhoto) {
    const exists = !!await context.get('SELECT id FROM ingredients WHERE id = $1', [candidate.ingredientId]);
    const history = (await context.all<Record<string, unknown>>('SELECT * FROM photo_notes WHERE candidate_id = $1 ORDER BY version DESC LIMIT 50', [candidate.id])).map(photoNoteFrom);
    return photoNoteDetail(candidate, history, exists);
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.runtime.read(context => this.detailIn(context, candidate)); }
  async save(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoNoteWrite(value, raw, authority);
    return this.runtime.write(async context => {
      requirePhotoEditor((await sessionIn(context, owned.authority.token))?.user, owned.authority);
      const item = nextPhotoNote(owned.candidate, await this.detailIn(context, owned.candidate), owned.input, owned.authority.account, this.now());
      let parameter = 0;
      await context.run(PHOTO_NOTE_INSERT.replace(/\?/g, () => `$${++parameter}`), photoNoteValues(item));
      return item;
    });
  }
}
