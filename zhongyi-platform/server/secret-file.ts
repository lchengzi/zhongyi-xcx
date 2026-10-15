import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function readSecretFile(filename: string, maximumBytes: number): Buffer {
  if (!isAbsolute(filename) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 65536) throw new Error('Invalid secret file configuration');
  const before = lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > BigInt(maximumBytes)) throw new Error('Invalid secret file');
  const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    // Windows path-stat reports dev=0; descriptor-stat reports the volume ID.
    const sameDevice = opened.dev === before.dev || (process.platform === 'win32' && before.dev === 0n);
    if (!opened.isFile() || !sameDevice || opened.ino !== before.ino || opened.size !== before.size) throw new Error('Secret file changed');
    const buffer = Buffer.alloc(maximumBytes + 1); let length = 0;
    while (length < buffer.length) { const count = readSync(descriptor, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (length > maximumBytes || BigInt(length) !== opened.size) throw new Error('Secret file changed');
    return buffer.subarray(0, length);
  } finally { closeSync(descriptor); }
}
