// Explicit test-only server. Fixture passwords never enter production bootstrap/index.
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createApp } from '../server/app.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { browserPostgresStore } from './postgres-browser-fixture.js';
import type { RepositoryBundle } from '../server/stores.js';
import { fixtureAssistant } from './assistant-fixture.js';
import { browserDiagnostics } from './browser-diagnostics.js';

const mode = process.argv[2];
if (mode !== 'accounts' && mode !== 'local-key') throw new Error('Test auth mode required');
const port = Number(process.env.PORT);
const seed = JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'));
let repo: CatalogRepository | RepositoryBundle;
if (process.env.PG_TEST_DATABASE_URL) {
  repo = await browserPostgresStore(process.env.PG_TEST_DATABASE_URL, seed, mode === 'accounts');
  console.log('Browser fixture uses real PostgreSQL; working databases are not opened.');
} else {
  const filename = mode === 'accounts' ? ':memory:' : resolve(process.env.DB_PATH!);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  repo = new CatalogRepository(filename, seed);
  if (mode === 'accounts') {
    const auth = new AuthRepository(repo.db);
    for (const role of ['admin', 'editor', 'reviewer'] as const) await auth.createUser(`browser-${role}`, `test-only-${role}-password-2026`, role, 'test-fixture');
    await auth.createUser('browser-recovery-admin', 'test-only-recovery-admin-password-2026', 'admin', 'test-fixture');
    await auth.createUser('browser-source-admin', 'test-only-source-admin-password-2026', 'admin', 'test-fixture');
    await auth.createUser('browser-assistant-review-editor', 'test-only-assistant-review-editor-password-2026', 'editor', 'test-fixture');
    await auth.createUser('browser-assistant-proposal-editor', 'test-only-assistant-proposal-editor-password-2026', 'editor', 'test-fixture');
    await auth.createUser('browser-response-editor', 'test-only-response-editor-password-2026', 'editor', 'test-fixture');
    await auth.createUser('browser-response-reviewer', 'test-only-response-reviewer-password-2026', 'reviewer', 'test-fixture');
    await auth.createUser('browser-auth-editor', 'test-only-auth-editor-password-2026', 'editor', 'test-fixture');
    await auth.createUser('browser-auth-reviewer', 'test-only-auth-reviewer-password-2026', 'reviewer', 'test-fixture');
    await auth.createUser('browser-assistant-response-editor', 'test-only-assistant-response-editor-password-2026', 'editor', 'test-fixture');
  }
}
const diagnostics = browserDiagnostics(port);
const server = createApp(repo, { mode, token: 'browser-test-editor-key-is-for-test-only-123', allowedOrigins: [`http://127.0.0.1:${port}`] }, resolve('dist'), { assistantProvider: fixtureAssistant(), ...diagnostics.options })
  .listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { void Promise.resolve(repo.close()).then(() => { diagnostics.close(); process.exitCode = 0; }); }));
