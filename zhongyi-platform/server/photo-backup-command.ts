import { isAbsolute, resolve } from 'node:path';

export type PhotoBackupCommand =
  | { action: 'export'; originalsRoot: string; manifest: string; derivativesRoot: string; journalRoot: string; databaseBackup: string; output: string }
  | { action: 'verify'; input: string; databaseBackup: string }
  | { action: 'restore'; input: string; databaseBackup: string; targetParent: string };

/** Shared by the host CLI and container preflight; no filesystem/secret reads. */
export function parsePhotoBackupArguments(input: readonly string[]): PhotoBackupCommand {
  const [action, ...args] = input;
  const names = action === 'export' ? ['originals-root', 'manifest', 'derivatives-root', 'journal-root', 'database-backup', 'output']
    : action === 'restore' ? ['input', 'database-backup', 'target-parent'] : action === 'verify' ? ['input', 'database-backup'] : [];
  const maintenance = action === 'export' || action === 'restore';
  if (!names.length || args.length !== names.length * 2 + (maintenance ? 1 : 0) || maintenance && args.at(-1) !== '--confirm-maintenance') throw new Error('Invalid photo backup command');
  const paths = new Map<string, string>();
  names.forEach((name, index) => {
    const value = args[index * 2 + 1];
    if (args[index * 2] !== `--${name}` || !value || !isAbsolute(value)) throw new Error('Explicit absolute photo backup paths required');
    paths.set(name, resolve(value));
  });
  const path = (name: string) => { const value = paths.get(name); if (!value) throw new Error('Missing photo backup path'); return value; };
  const databaseBackup = path('database-backup');
  if (action === 'export') return { action, originalsRoot: path('originals-root'), manifest: path('manifest'), derivativesRoot: path('derivatives-root'), journalRoot: path('journal-root'), databaseBackup, output: path('output') };
  if (action === 'verify') return { action, input: path('input'), databaseBackup };
  if (action === 'restore') return { action, input: path('input'), databaseBackup, targetParent: path('target-parent') };
  throw new Error('Invalid photo backup action');
}
