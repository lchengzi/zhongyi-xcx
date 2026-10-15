import { migrationFixture } from './migration-fixture.js';
import { openConfiguredStore } from '../server/store-config.js';
import { prepareRights, rightsInput } from './photo-rights-fixture.js';
import { notePhoto } from './photo-note-fixture.js';
import type { PhotoRightsWorkspace } from '../web/photo-rights-api.js';

// Owned SQLite engineering records, not real image approvals.
export async function rightsResponseFixture() {
  const f = await migrationFixture(undefined, false);
  const stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  try {
    const prepared = await prepareRights(stores), photo = notePhoto(), input = rightsInput(prepared.submission);
    const saved = await stores.photoRights.review(photo, input, prepared.reviewAuthority);
    const workspace = async (): Promise<PhotoRightsWorkspace> => ({ detail: await stores.photoRights.detail(photo),
      submissions: { detail: await stores.photoSubmissions.detail(photo), notes: await stores.photoNotes.detail(photo) } });
    return { stores, photo, input, saved, prepared, session: (await stores.auth.session(prepared.reviewAuthority.token))!, workspace,
      async close() { await stores.close(); f.dispose(); } };
  } catch (error) { await stores.close(); f.dispose(); throw error; }
}
