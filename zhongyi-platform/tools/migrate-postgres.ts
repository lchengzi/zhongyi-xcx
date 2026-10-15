import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSeed } from '../server/seed.js';
import { identifier, MigrationError, readSqliteSnapshot } from '../server/migration-snapshot.js';
import { createPostgresPool, migrateSqliteToPostgres, verifyImportedPostgres } from '../server/postgres-migration.js';
import { upgradePostgres } from '../server/postgres-upgrades.js';

async function main() {
  const args = process.argv.slice(2); const verify = args[0] === '--verify'; const upgrade = args[0] === '--upgrade'; if (verify || upgrade) args.shift();
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--schema'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new MigrationError('invalid_arguments', '用法：db:migrate:postgres -- --source 源库.sqlite --schema 全新目标；验证使用 --verify --schema 目标，结构升级使用 --upgrade --schema 目标。');
    values[args[i]] = args[i + 1];
  }
  if (!values['--schema'] || (!verify && !upgrade && !values['--source']) || ((verify || upgrade) && values['--source'])) throw new MigrationError('invalid_arguments', '迁移必须显式指定源库和全新 schema；验证/升级只指定已迁移 schema。');
  identifier(values['--schema']);
  if (!process.env.DATABASE_URL) throw new MigrationError('missing_connection', '请通过环境变量 DATABASE_URL 配置目标连接，不在参数中传密码。');
  const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
  const snapshot = verify || upgrade ? null : readSqliteSnapshot(resolve(values['--source']), seed);
  const pool = createPostgresPool(process.env.DATABASE_URL);
  try {
    const report = upgrade ? await upgradePostgres(pool, values['--schema']) : verify ? await verifyImportedPostgres(pool, values['--schema'], seed) : await migrateSqliteToPostgres(pool, values['--schema'], snapshot!, seed);
    console.log(JSON.stringify(report, null, 2));
  } finally { await pool.end(); }
}

main().catch((error) => {
  // Never print raw connection errors, credentials, query parameters or rows.
  console.error(JSON.stringify({ ok: false, code: error instanceof MigrationError ? error.code : 'migration_failed',
    message: error instanceof MigrationError ? error.message : '迁移未通过，请检查连接、源库版本与目标权限；不会覆盖现有目标。' }));
  process.exitCode = 1;
});
