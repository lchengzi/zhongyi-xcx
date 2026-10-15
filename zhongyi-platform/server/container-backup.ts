import { lstatSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertNoLinks } from './demo-secrets.js';
import { parseBackupArguments } from './backup-command.js';

// Container-only archive boundary. The ordinary CLI keeps its explicit-path
// contract; this wrapper additionally requires the command's dedicated mount.
export function validateContainerBackup(input: readonly string[], env: NodeJS.ProcessEnv) {
  const command = parseBackupArguments(input);
  const directory = command.restore ? env.BACKUP_INPUT_DIRECTORY : env.BACKUP_OUTPUT_DIRECTORY;
  const opposite = command.restore ? env.BACKUP_OUTPUT_DIRECTORY : env.BACKUP_INPUT_DIRECTORY;
  if (!directory || !isAbsolute(directory) || opposite || !isAbsolute(command.filename)) throw new Error('Explicit one-purpose archive mount required');
  assertNoLinks(directory);
  if (!lstatSync(directory).isDirectory()) throw new Error('Existing archive directory required');
  const root = resolve(directory), filename = resolve(command.filename), child = relative(root, filename);
  if (!child || child !== basename(filename) || isAbsolute(child) || child === '..') throw new Error('Archive file must stay directly within its dedicated mount');
  for (const secret of [env.BACKUP_ENCRYPTION_KEY_FILE, env.DATABASE_OWNER_URL_FILE, env.DATABASE_URL_FILE]) {
    if (!secret) continue;
    const distance = relative(root, resolve(secret));
    if (!distance || (distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance))) throw new Error('Credentials must remain outside the archive mount');
  }
  // Link checks and exclusive write/authenticated read are repeated by the
  // shared backup tool at the actual operation, not inferred from this check.
  return command;
}
