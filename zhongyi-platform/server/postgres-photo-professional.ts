import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { accountColumns, toAccount, sessionIn, type StoredAccount, type PostgresContext, type PostgresRuntime } from './postgres-runtime.js';
import { ownPhotoProfessional, requirePhotoProfessionalReviewer, photoProfessionalDetail, nextPhotoProfessional, type PhotoProfessionalStore } from './photo-professional-policy.js';
import { photoProfessionalData, requirePhotoProfessionalHistory } from './photo-professional-data.js';
import { PHOTO_PROFESSIONAL_INSERT, photoProfessionalValues } from './photo-professional-values.js';
import type { WriteAuthority } from './stores.js';

export class PostgresPhotoProfessional implements PhotoProfessionalStore {
  constructor(private readonly runtime: PostgresRuntime, private readonly now: () => number = Date.now) {}
  private async data(context: PostgresContext, candidate: PrivatePhoto, now: number) {
    const rows = {
      notes: await context.all<Record<string, unknown>>('SELECT * FROM photo_notes WHERE candidate_id = $1 ORDER BY version DESC', [candidate.id]),
      submissions: await context.all<Record<string, unknown>>('SELECT * FROM photo_submissions WHERE candidate_id = $1 ORDER BY version DESC', [candidate.id]),
      rights: await context.all<Record<string, unknown>>('SELECT * FROM photo_rights_reviews WHERE candidate_id = $1 ORDER BY version DESC', [candidate.id]),
      reviews: await context.all<Record<string, unknown>>('SELECT * FROM photo_professional_reviews WHERE candidate_id = $1 ORDER BY version DESC LIMIT 10001', [candidate.id]),
      qualifications: await context.all<Record<string, unknown>>('SELECT * FROM professional_qualifications ORDER BY user_id, revision DESC')
    };
    const users = (await context.all<StoredAccount>(`SELECT ${accountColumns} FROM users`)).map(toAccount);
    const exists = !!await context.get('SELECT id FROM ingredients WHERE id = $1', [candidate.ingredientId]);
    return photoProfessionalData(candidate, rows, users, exists, now);
  }
  async detail(value: PrivatePhoto) {
    const candidate = parsePrivatePhoto(value);
    return this.runtime.read(async context => { const now = this.now(); return photoProfessionalDetail((await this.data(context, candidate, now)).facts, now); });
  }
  async review(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoProfessional(value, raw, authority);
    return this.runtime.write(async context => {
      requirePhotoProfessionalReviewer((await sessionIn(context, owned.authority.token))?.user, owned.authority);
      const now = this.now(), { facts, history } = await this.data(context, owned.candidate, now);
      const item = nextPhotoProfessional(facts, owned.input, owned.authority.account, now);
      requirePhotoProfessionalHistory({ ...history, reviews: [item, ...history.reviews] });
      let parameter = 0;
      await context.run(PHOTO_PROFESSIONAL_INSERT.replace(/\?/g, () => `$${++parameter}`), photoProfessionalValues(item)); return item;
    });
  }
}
