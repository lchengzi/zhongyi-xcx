import { createPostgresPool } from './postgres-migration.js';
import { PostgresRuntime } from './postgres-runtime.js';
import { PostgresCatalog } from './postgres-catalog.js';
import { PostgresAuth } from './postgres-auth.js';
import { PostgresWorkflow, WorkflowView } from './postgres-workflow.js';
import { PostgresAssistant } from './postgres-assistant.js';
import { PostgresPublication } from './postgres-publication.js';
import { PostgresPhotoNotes } from './postgres-photo-notes.js';
import { PostgresPhotoSubmissions } from './postgres-photo-submissions.js';
import { PostgresPhotoRights } from './postgres-photo-rights.js';
import { PostgresPhotoProfessional } from './postgres-photo-professional.js';
import { validateSeed } from './seed.js';
import type { RepositoryBundle } from './stores.js';
import { verifyCurrentPostgresRuntimePermissions } from './postgres-permissions.js';

export async function openPostgresStore(databaseUrl: string, schema: string, seedInput: unknown, requireTls = false, requireRuntimePermissions = false): Promise<RepositoryBundle> {
  const seed = validateSeed(JSON.parse(JSON.stringify(seedInput)));
  const pool = createPostgresPool(databaseUrl, requireTls);
  // Do not crash on an idle connection error or disclose raw connection details.
  pool.on('error', () => { console.error('PostgreSQL idle connection unavailable; subsequent requests may fail.'); });
  try {
    if (requireRuntimePermissions || process.env.NODE_ENV === 'production') await verifyCurrentPostgresRuntimePermissions(pool, schema);
    const runtime = new PostgresRuntime(pool, schema);
    await runtime.validate(seed.digest);
    const catalog = new PostgresCatalog(runtime, seed);
    await catalog.publicSnapshot();
    return { engine: 'postgres', catalog, auth: new PostgresAuth(runtime), workflow: new PostgresWorkflow(runtime), assistant: new PostgresAssistant(runtime), publication: new PostgresPublication(runtime, (context) => new WorkflowView(context)), photoNotes: new PostgresPhotoNotes(runtime), photoSubmissions: new PostgresPhotoSubmissions(runtime), photoRights: new PostgresPhotoRights(runtime), photoProfessional: new PostgresPhotoProfessional(runtime), close: () => pool.end() };
  } catch (error) { await pool.end(); throw error; }
}
