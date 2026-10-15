import { migrationFixture } from './migration-fixture.js';
import { openConfiguredStore } from '../server/store-config.js';
import { registerPhotoSubmissionHttpTests } from './photo-submission-http-fixture.js';

registerPhotoSubmissionHttpTests('real SQLite', async () => {
  const f = await migrationFixture(undefined, false);
  try {
    const stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
    return { stores, admin: f.admin, editor: f.editor, reviewer: f.reviewer, close: async () => { await stores.close(); f.dispose(); } };
  } catch (error) { f.dispose(); throw error; }
});
