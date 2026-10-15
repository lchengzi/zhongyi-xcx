import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSeed } from '../server/seed.js';
import { MigrationError } from '../server/migration-snapshot.js';
import { parseBackupArguments } from '../server/backup-command.js';
import { createPostgresPool } from '../server/postgres-migration.js';
import { backupKey, capturePostgresBackup, decryptBackup, encryptBackup, readBackupFile, restorePostgresBackup, writeBackupFile, backupReport } from '../server/postgres-backup.js';

async function main() {
  const { restore, schema, filename } = parseBackupArguments(process.argv.slice(2));
  const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY);
  try {
    if (!process.env.DATABASE_URL) throw new MigrationError('missing_connection', '请通过安全环境配置 DATABASE_URL，不放命令行参数。');
    const seed = validateSeed(JSON.parse(readFileSync(resolve('data/catalog.seed.json'), 'utf8')));
    const backup = restore ? decryptBackup(readBackupFile(filename), key, seed) : undefined;
    const pool = createPostgresPool(process.env.DATABASE_URL);
    try {
      if (restore) console.log(JSON.stringify(await restorePostgresBackup(pool, schema, backup, seed), null, 2));
      else { const captured = await capturePostgresBackup(pool, schema, seed); writeBackupFile(filename, encryptBackup(captured, key)); console.log(JSON.stringify({ ...backupReport(captured), encrypted: true, recoveryVerified: false }, null, 2)); }
    } finally { await pool.end(); }
  } finally { key.fill(0); }
}
main().catch((error) => {
  // Never disclose database errors/queries, private rows, plaintext or key/URL.
  console.error(JSON.stringify({ ok: false, code: error instanceof MigrationError ? error.code : 'backup_failed', message: error instanceof MigrationError ? error.message : '备份或恢复未通过。不会覆盖已有目标；不完整加密文件保留，请检查后另选全新文件。' }));
  process.exitCode = 1;
});
