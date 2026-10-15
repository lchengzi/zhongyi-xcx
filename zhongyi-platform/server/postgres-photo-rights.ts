import type { Account } from '../shared/contracts.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { PostgresPhotoSubmissions } from './postgres-photo-submissions.js';
import { ownPhotoRights, requirePhotoRightsReviewer, nextPhotoRights, photoRightsDetail, type PhotoRightsStore } from './photo-rights-service.js';
import { PHOTO_RIGHTS_INSERT, photoRightsFrom, photoRightsValues } from './photo-rights-values.js';
import { accountColumns, toAccount, sessionIn, type StoredAccount, type PostgresContext, type PostgresRuntime } from './postgres-runtime.js';
import type { WriteAuthority } from './stores.js';
export class PostgresPhotoRights implements PhotoRightsStore {
  constructor(private readonly runtime: PostgresRuntime, private readonly now: () => number = Date.now) {}
  private async facts(context: PostgresContext, candidate: PrivatePhoto) {
    const basis = await new PostgresPhotoSubmissions(this.runtime).detailInTransaction(context, candidate);
    const history = (await context.all<Record<string, unknown>>('SELECT * FROM photo_rights_reviews WHERE candidate_id = $1 ORDER BY version DESC LIMIT 50', [candidate.id])).map(photoRightsFrom);
    const users: Account[] = (await context.all<StoredAccount>(`SELECT ${accountColumns} FROM users`)).map(toAccount);
    return { basis, detail: photoRightsDetail(candidate, basis, history, users, this.now()) };
  }
  async detail(value: PrivatePhoto) { const candidate = parsePrivatePhoto(value); return this.runtime.read(async context => (await this.facts(context, candidate)).detail); }
  async review(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
    const owned = ownPhotoRights(value, raw, authority);
    return this.runtime.write(async context => {
      requirePhotoRightsReviewer((await sessionIn(context, owned.authority.token))?.user, owned.authority);
      const { basis, detail } = await this.facts(context, owned.candidate);
      const contributors = (await context.all<{ actor_id: string }>('SELECT actor_id FROM photo_notes WHERE candidate_id = $1 UNION SELECT actor_id FROM photo_submissions WHERE candidate_id = $1', [owned.candidate.id])).map(row => row.actor_id);
      const item = nextPhotoRights(owned.candidate, basis, detail, contributors, owned.input, owned.authority.account, this.now());
      let parameter = 0; await context.run(PHOTO_RIGHTS_INSERT.replace(/\?/g, () => `$${++parameter}`), photoRightsValues(item)); return item;
    });
  }
}
