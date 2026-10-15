import { photoNoteDetail, requirePhotoEditor } from './photo-note-service.js';
import { photoNoteFrom } from './photo-note-values.js';
import { nextPhotoSubmission, ownPhotoSubmission, photoSubmissionDetail, type PhotoSubmissionStore } from './photo-submission-service.js';
import { PHOTO_SUBMISSION_INSERT, photoSubmissionFrom, photoSubmissionValues } from './photo-submission-values.js';
import { sessionIn, type PostgresContext, type PostgresRuntime } from './postgres-runtime.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import type { WriteAuthority } from './stores.js';

export class PostgresPhotoSubmissions implements PhotoSubmissionStore {
  constructor(private readonly runtime: PostgresRuntime, private readonly now: () => number = Date.now) {}
  async detailInTransaction(context: PostgresContext, candidate: PrivatePhoto) {
    const exists = !!await context.get('SELECT id FROM ingredients WHERE id = $1', [candidate.ingredientId]);
    const notes = photoNoteDetail(candidate, (await context.all<Record<string, unknown>>('SELECT * FROM photo_notes WHERE candidate_id = $1 ORDER BY version DESC LIMIT 50', [candidate.id])).map(photoNoteFrom), exists);
    const history = (await context.all<Record<string, unknown>>('SELECT * FROM photo_submissions WHERE candidate_id = $1 ORDER BY version DESC LIMIT 50', [candidate.id])).map(photoSubmissionFrom);
    return photoSubmissionDetail(candidate, notes, history);
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.runtime.read(context => this.detailInTransaction(context, candidate)); }
  async submit(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoSubmission(value, raw, authority);
    return this.runtime.write(async context => {
      requirePhotoEditor((await sessionIn(context, owned.authority.token))?.user, owned.authority);
      const item = nextPhotoSubmission(owned.candidate, await this.detailInTransaction(context, owned.candidate), owned.input, owned.authority.account, this.now());
      let parameter = 0;
      await context.run(PHOTO_SUBMISSION_INSERT.replace(/\?/g, () => `$${++parameter}`), photoSubmissionValues(item));
      return item;
    });
  }
}
