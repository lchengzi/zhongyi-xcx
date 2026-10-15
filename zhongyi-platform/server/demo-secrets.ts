import { randomBytes } from 'node:crypto';
import { lstatSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function assertNoLinks(filename: string): void {
  if (!isAbsolute(filename)) throw new Error('Absolute path required');
  for (let current = resolve(filename); ; current = dirname(current)) {
    // existsSync follows the target and hides dangling links. Inspect the entry
    // itself so a missing target cannot bypass the no-linked-path boundary.
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Linked paths are not allowed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
}

export function prepareDemoSecrets(parent: string): string {
  assertNoLinks(parent);
  if (!lstatSync(parent).isDirectory()) throw new Error('Existing directory required');
  const directory = mkdtempSync(join(parent, 'setup-'));
  const password = randomBytes(32).toString('base64url');
  // Explicitly a fresh local demo, not the host's working database or admin.
  writeFileSync(join(directory, 'postgres-password.txt'), password, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'database-url.txt'), `postgresql://food_demo:${encodeURIComponent(password)}@postgres:5432/food_demo`, { flag: 'wx', mode: 0o600 });
  return directory;
}
