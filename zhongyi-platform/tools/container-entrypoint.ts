import { containerEnvironment, type ContainerDatabaseCommand } from '../server/container-secrets.js';
import { validateContainerBackup } from '../server/container-backup.js';
import { rejectContainerPhotoBackupSettings, validateContainerPhotoBackup } from '../server/container-photo-backup.js';

const commands: Record<string, string> = {
  server: '../server/index.js', init: './init-postgres.js', bootstrap: './bootstrap-account.js',
  migrate: './migrate-postgres.js', backup: './backup-postgres.js', 'runtime-role': './runtime-role-postgres.js'
};
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'photo-backup') {
    validateContainerPhotoBackup(args, process.env);
    process.argv = [process.argv[0], process.argv[1], ...args];
    await import('./backup-photo-resources.js');
    return;
  }
  rejectContainerPhotoBackupSettings(process.env);
  if (!Object.hasOwn(commands, command || '') || (command === 'server' && args.length)) throw new Error('Invalid container command');
  if (command === 'backup') validateContainerBackup(args, process.env);
  const environment = containerEnvironment(process.env, command as ContainerDatabaseCommand);
  process.env.DATABASE_URL = environment.DATABASE_URL;
  delete process.env.DATABASE_URL_FILE;
  delete process.env.DATABASE_RUNTIME_URL_FILE;
  delete process.env.DATABASE_OWNER_URL_FILE;
  if (environment.BACKUP_ENCRYPTION_KEY) process.env.BACKUP_ENCRYPTION_KEY = environment.BACKUP_ENCRYPTION_KEY;
  else delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_ENCRYPTION_KEY_FILE;
  // Same process, no shell: Docker's SIGTERM reaches the server directly.
  process.argv = [process.argv[0], process.argv[1], ...args];
  await import(new URL(commands[command], import.meta.url).href);
}
await main().catch(() => {
  console.error('Container command failed. Check command, secret mount and database configuration; credentials are not printed.');
  process.exitCode = 1;
});
