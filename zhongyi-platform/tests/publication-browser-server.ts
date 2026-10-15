// Test-only, localhost-only engineering simulation. Never imported by production.
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { publicationFixture } from './publication-fixture.js';
import { fixturePassword } from './migration-fixture.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import type { RepositoryBundle } from '../server/stores.js';
import { browserDiagnostics } from './browser-diagnostics.js';

const port = Number(process.env.PORT);
if (![4313, 4315].includes(port)) throw new Error('Only the fixed owned publication browser fixture ports are supported');
if (process.env.PG_TEST_DATABASE_URL && !/^[a-f0-9]{32}$/.test(process.env.PG_TEST_NONCE || '')) throw new Error('Owned PostgreSQL browser controller nonce required; no SQLite fallback');
const fixture = await publicationFixture();
let postgres: RepositoryBundle | undefined;
try {
  fixture.resume(); const first = fixture.snapshot(); fixture.approve(first.id); fixture.action(first.id);
  fixture.publication.control({ action: 'freeze', expectedVersion: 1, confirmed: true, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment: '浏览器夹具起始冻结，不能自动恢复旧批准。' }, fixture.admin);
  await fixture.advance('ENGINEERING_SIMULATION_NOT_REAL：浏览器测试第二版。'); fixture.snapshot();
  await fixture.advance('ENGINEERING_SIMULATION_NOT_REAL：浏览器测试第三版。');
  for (const role of ['admin', 'editor', 'reviewer'] as const) await fixture.auth.createUser(`publication-ui-${role}`, fixturePassword, role, 'engineering-simulation');
  if (process.env.PG_TEST_DATABASE_URL) {
    const schema = `publication_browser_${randomUUID().replaceAll('-', '')}`;
    const pool = createPostgresPool(process.env.PG_TEST_DATABASE_URL);
    try { await migrateSqliteToPostgres(pool, schema, fixture.read(), fixture.seed); }
    finally { await pool.end(); }
    postgres = await openPostgresStore(process.env.PG_TEST_DATABASE_URL, schema, fixture.seed);
  }
  const diagnostics = browserDiagnostics(port);
  const server = createApp(postgres || fixture.catalog, { mode: 'accounts', allowedOrigins: [`http://127.0.0.1:${port}`] }, resolve('dist'), { publicationEnabled: true, ...diagnostics.options }).listen(port, '127.0.0.1');
  console.log(`Isolated publication UI fixture: ${postgres ? 'real PostgreSQL' : 'SQLite'}; simulated evidence only; no external publication.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => {
    void Promise.resolve(postgres?.close()).then(() => { fixture.close(); diagnostics.close(); process.exitCode = 0; });
  }));
} catch (error) { await postgres?.close(); fixture.close(); throw error; }
