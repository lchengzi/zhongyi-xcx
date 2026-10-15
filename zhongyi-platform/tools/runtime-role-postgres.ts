import { createPostgresPool } from '../server/postgres-migration.js';
import { MigrationError } from '../server/migration-snapshot.js';
import { configurePostgresRuntimePermissions, runtimePermissionStatements } from '../server/postgres-permissions.js';

async function main() {
  const [mode, schemaFlag, schema, roleFlag, role, ...extra] = process.argv.slice(2);
  if (!['--verify', '--apply'].includes(mode) || schemaFlag !== '--schema' || roleFlag !== '--role' || !schema || !role || extra.length) {
    throw new MigrationError('invalid_arguments', '显式指定 --verify 或 --apply --schema 专用名称 --role 已建立运行角色；不接受密码参数。');
  }
  runtimePermissionStatements(schema, role);
  if (!process.env.DATABASE_URL) throw new MigrationError('missing_connection', '需要迁移所有者连接；连接不通过命令参数传递。');
  const pool = createPostgresPool(process.env.DATABASE_URL);
  try { console.log(JSON.stringify(await configurePostgresRuntimePermissions(pool, schema, role, mode === '--apply'), null, 2)); }
  finally { await pool.end(); }
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof MigrationError ? error.code : 'permissions_failed',
    message: '运行角色权限检查未通过；未自动撤权或改动共享默认权限，连接和数据库原始错误不输出。' }));
  process.exitCode = 1;
});
