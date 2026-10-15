import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { parsePhotoBackupArguments } from './photo-backup-command.js';
import { photoFile, photoPath } from './photo-files.js';
import { backupKey } from './backup-key.js';

const prefix = 'PHOTO_BACKUP_';
export function rejectContainerPhotoBackupSettings(env: NodeJS.ProcessEnv): void {
  if (Object.entries(env).some(([key, value]) => value && (key.startsWith(prefix) || key === 'PHOTO_RESOURCE_BACKUP_KEY' || key === 'PHOTO_RESOURCE_BACKUP_KEY_FILE'))) throw new Error('Photo backup settings belong only to photo-backup');
}
const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
function inside(parent: string, path: string): boolean {
  const distance = relative(normalized(parent), normalized(path));
  return !distance || distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}
function directFile(root: string, path: string): void {
  const distance = relative(normalized(root), normalized(path));
  if (!distance || distance !== basename(normalized(path)) || !inside(root, path)) throw new Error('Archive must be a direct file within its dedicated mount');
}
/** File-only operator. Never reads a database connection or starts a server. */
export function validateContainerPhotoBackup(args: readonly string[], env: NodeJS.ProcessEnv) {
  const command = parsePhotoBackupArguments(args);
  for (const name of ['DATABASE_URL', 'DATABASE_URL_FILE', 'DATABASE_RUNTIME_URL_FILE', 'DATABASE_OWNER_URL_FILE',
    'BACKUP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY_FILE', 'BACKUP_INPUT_DIRECTORY', 'BACKUP_OUTPUT_DIRECTORY', 'PHOTO_RESOURCE_BACKUP_KEY']) {
    if (env[name]) throw new Error('Photo file operator must not receive SQL credentials or inline keys');
  }
  if (env.ENABLE_PHOTO_PUBLICATION === 'true' || env.EDUCATION_PUBLICATION_ENABLED === 'true' || env.AI_EXTERNAL_ENABLED === 'true') throw new Error('Publication and external AI must remain disabled');
  const allowed = ['DATABASE_DIRECTORY', ...(command.action === 'export' ? ['ORIGINALS_DIRECTORY', 'DERIVATIVES_DIRECTORY', 'JOURNAL_DIRECTORY', 'OUTPUT_DIRECTORY'] : ['INPUT_DIRECTORY']),
    ...(command.action === 'restore' ? ['RESTORE_DIRECTORY'] : [])].map(name => `${prefix}${name}`);
  for (const [name, value] of Object.entries(env)) if (value && name.startsWith(prefix) && !allowed.includes(name)) throw new Error('Unexpected photo backup mount');
  const roots = new Map<string, string>();
  for (const name of allowed) {
    const path = env[name]; if (!path) throw new Error('Explicit photo backup mounts required');
    roots.set(name, photoPath(path, true));
  }
  const root = (name: string) => { const value = roots.get(`${prefix}${name}`); if (!value) throw new Error('Missing mount'); return value; };
  const values = [...roots.values()];
  for (const [index, left] of values.entries()) for (const right of values.slice(index + 1)) if (inside(left, right) || inside(right, left)) throw new Error('Photo backup mounts must be disjoint');
  const keyFile = env.PHOTO_RESOURCE_BACKUP_KEY_FILE;
  if (!keyFile || !isAbsolute(keyFile) || values.some(directory => inside(directory, keyFile))) throw new Error('Independent photo backup key file required outside all resource mounts');
  const bytes = photoFile(keyFile, 128);
  try { const key = backupKey(bytes.toString('utf8').trim()); key.fill(0); } finally { bytes.fill(0); }
  directFile(root('DATABASE_DIRECTORY'), command.databaseBackup);
  if (command.action === 'export') {
    for (const [name, value] of [['ORIGINALS_DIRECTORY', command.originalsRoot], ['DERIVATIVES_DIRECTORY', command.derivativesRoot], ['JOURNAL_DIRECTORY', command.journalRoot]]) {
      if (normalized(root(name)) !== normalized(value)) throw new Error('Export must use the exact source mounts');
    }
    directFile(root('ORIGINALS_DIRECTORY'), command.manifest); directFile(root('OUTPUT_DIRECTORY'), command.output);
  } else {
    directFile(root('INPUT_DIRECTORY'), command.input);
    if (command.action === 'restore' && normalized(root('RESTORE_DIRECTORY')) !== normalized(command.targetParent)) throw new Error('Restore must use the exact new-directory parent mount');
  }
  return command;
}
