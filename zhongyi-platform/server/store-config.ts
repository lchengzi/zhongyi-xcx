import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CatalogRepository } from './database.js';
import { AuthRepository } from './auth.js';
import { WorkflowRepository } from './workflow.js';
import { AssistantRepository } from './assistant-repository.js';
import { PublicationRepository } from './publication.js';
import { PhotoNoteRepository } from './photo-notes.js';
import { PhotoSubmissionRepository } from './photo-submissions.js';
import { PhotoRightsRepository } from './photo-rights.js';
import { PhotoProfessionalRepository } from './photo-professional.js';
import { openPostgresStore } from './postgres-store.js';
import { identifier, MigrationError } from './migration-snapshot.js';
import type { RepositoryBundle } from './stores.js';

export type StoreConfig = { engine: 'sqlite'; filename: string } | { engine: 'postgres'; databaseUrl: string; schema: string };
export function storeConfig(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const engine = env.DATABASE_PROVIDER || 'sqlite';
  if (engine === 'sqlite') return { engine, filename: resolve(env.DB_PATH || '.local/editorial.sqlite') };
  if (engine !== 'postgres') throw new MigrationError('invalid_provider', 'DATABASE_PROVIDER 只能为 sqlite 或 postgres。');
  if (!env.DATABASE_URL || !env.DATABASE_SCHEMA) throw new MigrationError('missing_configuration', 'PostgreSQL 模式需明确配置 DATABASE_URL 和 DATABASE_SCHEMA，不会回退 SQLite。');
  identifier(env.DATABASE_SCHEMA);
  return { engine, databaseUrl: env.DATABASE_URL, schema: env.DATABASE_SCHEMA };
}
export async function openConfiguredStore(seed: unknown, env: NodeJS.ProcessEnv = process.env): Promise<RepositoryBundle> {
  const config = storeConfig(env);
  if (config.engine === 'postgres') return openPostgresStore(config.databaseUrl, config.schema, seed, env.NODE_ENV === 'production', env.NODE_ENV === 'production');
  mkdirSync(dirname(config.filename), { recursive: true });
  const catalog = new CatalogRepository(config.filename, seed);
  const workflow = new WorkflowRepository(catalog.db);
  return { engine: 'sqlite', catalog, auth: new AuthRepository(catalog.db), workflow, assistant: new AssistantRepository(catalog.db), publication: new PublicationRepository(catalog.db, workflow), photoNotes: new PhotoNoteRepository(catalog.db), photoSubmissions: new PhotoSubmissionRepository(catalog.db), photoRights: new PhotoRightsRepository(catalog.db), photoProfessional: new PhotoProfessionalRepository(catalog.db), close: () => catalog.close() };
}
