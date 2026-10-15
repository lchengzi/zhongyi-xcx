import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from '../server/demo-secrets.js';
import { instrumentLoginDatabase } from './login-timing.js';

async function main() {
  if (process.argv.length !== 2) throw new Error('No arguments accepted');
  const base = resolve('.local/login-profiles'); assertNoLinks(base); mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(base, 'run-')); const filename = join(directory, 'fixture.sqlite');
  writeFileSync(filename, '', { flag: 'wx', mode: 0o600 });
  const { CatalogRepository } = await import(pathToFileURL(resolve('build/server/database.js')).href) as typeof import('../server/database.js');
  const { AuthRepository } = await import(pathToFileURL(resolve('build/server/auth.js')).href) as typeof import('../server/auth.js');
  const seed = JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8'));
  const repo = new CatalogRepository(filename, seed); const password = `test-only-${randomUUID()}`;
  const report = { schemaVersion: 1, kind: 'isolated-compiled-sqlite-login-profile', startedAt: new Date().toISOString(),
    finishedAt: null as string | null, status: 'running', databaseClosed: false, sourceWorkingDatabaseModified: false,
    productionApplicationStarted: false, databaseSettingsModified: false, deploymentVerified: false, realModelCalls: 0,
    journalMode: String(repo.db.prepare('PRAGMA journal_mode').get()?.journal_mode),
    synchronous: Number(repo.db.prepare('PRAGMA synchronous').get()?.synchronous),
    busyTimeoutMs: Number(repo.db.prepare('PRAGMA busy_timeout').get()?.timeout),
    samples: [] as Array<ReturnType<ReturnType<typeof instrumentLoginDatabase>['finish']>> };
  try {
    await new AuthRepository(repo.db).createUser('profile-test-admin', password, 'admin', 'profile-fixture', true);
    for (let index = 0; index < 6; index++) {
      const timing = instrumentLoginDatabase(repo.db);
      const result = await new AuthRepository(timing.database).login('profile-test-admin', password, 'profile-loopback');
      const sample = timing.finish(); assert.equal(sample.dropped, 0);
      assert.equal(sample.records.some((r) => r.stage === 'other' || r.failed), false);
      assert.equal(result.info.user.role, 'admin'); report.samples.push(sample);
    }
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n, 6);
    assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE attempts = 6').get()?.n, 2);
    report.status = 'passed';
  } finally {
    repo.close(); report.databaseClosed = true; report.finishedAt = new Date().toISOString();
    if (report.status !== 'passed') report.status = 'failed';
    const serialized = JSON.stringify(report, null, 2); assert.equal(serialized.includes(password), false);
    const target = join(directory, 'report.json'); assertNoLinks(target); writeFileSync(target, serialized + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, report: target, databaseClosed: report.databaseClosed,
      samples: report.samples.map(({ durationMs, sqlMs, nonSqlMs, passwordCheckGapMs }) => ({ durationMs, sqlMs, nonSqlMs, passwordCheckGapMs })) }));
  }
}
main().catch(() => { console.error('Isolated login profiling failed; no credentials or raw errors are printed.'); process.exitCode = 1; });
