import { readSecretFile } from './secret-file.js';
import { assertNoLinks } from './demo-secrets.js';
import { backupKey } from './backup-key.js';

export type ContainerDatabaseCommand = 'server' | 'bootstrap' | 'init' | 'migrate' | 'backup' | 'runtime-role';
const credentialKinds = { server: 'runtime', bootstrap: 'runtime', init: 'owner', migrate: 'owner', backup: 'owner', 'runtime-role': 'owner' } as const;

// Never copy this server-side secret into argv, logs or a Docker build layer.
export function containerEnvironment(env: NodeJS.ProcessEnv = process.env, command: ContainerDatabaseCommand = 'server'): NodeJS.ProcessEnv {
  if (!Object.hasOwn(credentialKinds, command) || env.DATABASE_URL) throw new Error('Invalid container database credential configuration');
  const runtimeFile = env.DATABASE_RUNTIME_URL_FILE, ownerFile = env.DATABASE_OWNER_URL_FILE;
  const separated = !!runtimeFile || !!ownerFile || env.NODE_ENV === 'production';
  let filename: string | undefined;
  if (separated) {
    const runtime = credentialKinds[command] === 'runtime';
    filename = runtime ? runtimeFile : ownerFile;
    if (!filename || env.DATABASE_URL_FILE || (runtime ? ownerFile : runtimeFile)) {
      throw new Error('Mount only the credential required by this container command');
    }
  } else filename = env.DATABASE_URL_FILE;
  if (!filename) throw new Error('An absolute command-specific database secret is required');
  assertNoLinks(filename);
  const value = readSecretFile(filename, 8192).toString('utf8').trim();
  if (/[\r\n\0]/.test(value) || !value.length || value.length > 8192) throw new Error('Invalid database secret');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error('Invalid database secret');
  let encryptionKey: string | undefined;
  if (command === 'backup') {
    if (!env.BACKUP_ENCRYPTION_KEY_FILE || env.BACKUP_ENCRYPTION_KEY) throw new Error('A separate backup key file is required');
    assertNoLinks(env.BACKUP_ENCRYPTION_KEY_FILE);
    const bytes = readSecretFile(env.BACKUP_ENCRYPTION_KEY_FILE, 128);
    try { encryptionKey = bytes.toString('utf8').trim(); const decoded = backupKey(encryptionKey); decoded.fill(0); }
    finally { bytes.fill(0); }
  } else if (env.BACKUP_ENCRYPTION_KEY_FILE || env.BACKUP_ENCRYPTION_KEY || env.BACKUP_INPUT_DIRECTORY || env.BACKUP_OUTPUT_DIRECTORY) {
    throw new Error('Backup credentials and archive mounts belong only to the backup command');
  }
  return { ...env, DATABASE_URL: value, DATABASE_URL_FILE: undefined, DATABASE_RUNTIME_URL_FILE: undefined, DATABASE_OWNER_URL_FILE: undefined,
    BACKUP_ENCRYPTION_KEY: encryptionKey, BACKUP_ENCRYPTION_KEY_FILE: undefined };
}
