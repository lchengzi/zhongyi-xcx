import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function photoPath(path: string, directory: boolean): string {
  if (!isAbsolute(path) || dirname(path) === path) throw new Error('Explicit photo path required');
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    const stat = lstatSync(cursor), actual = realpathSync(cursor);
    const same = process.platform === 'win32' ? actual.toLowerCase() === cursor.toLowerCase() : actual === cursor;
    if (stat.isSymbolicLink() || !same || (cursor === resolve(path) ? (directory ? !stat.isDirectory() : !stat.isFile()) : !stat.isDirectory())) throw new Error('Ordinary photo path required');
    if (dirname(cursor) === cursor) break;
  }
  return resolve(path);
}
export function photoFile(path: string, maximum: number): Buffer {
  photoPath(path, false); const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error('Photo file limit');
    const bytes = Buffer.alloc(stat.size + 1); let offset = 0, count = 0;
    do { count = readSync(fd, bytes, offset, bytes.length - offset, null); offset += count; } while (count && offset < bytes.length);
    if (offset !== stat.size) throw new Error('Photo file changed');
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
