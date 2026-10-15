import { closeSync, fsyncSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parsePhotoPublicationRecord, type PhotoPublicationRecord } from '../shared/photo-publications.js';
import { photoId } from '../shared/private-photos.js';
import { photoFile, photoPath } from './photo-files.js';
import { AccountError } from './auth.js';
import { withPhotoResourceLock } from './photo-resource-guard.js';

export function photoPublicationDigest(record: PhotoPublicationRecord): string {
  const { digest: _digest, ...payload } = parsePhotoPublicationRecord(record);
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
/** Append-only asset journal, separate from the SQL editorial database. A failed
 * or incomplete write stays visible as an integrity failure; it is never skipped. */
export class PhotoPublicationJournal {
  readonly root: string;
  constructor(directory: string) { this.root = photoPath(directory, true); }
  history(ingredientId: string): PhotoPublicationRecord[] {
    if (!photoId(ingredientId) || ingredientId.length > 80) throw new Error('Invalid publication identity');
    photoPath(this.root, true);
    const prefix = `${ingredientId}.`, files = readdirSync(this.root).filter(name => name.startsWith(prefix));
    if (files.length > 10000) throw new Error('Publication journal limit');
    const versions = files.map(name => {
      const suffix = name.slice(prefix.length);
      if (!/^[1-9][0-9]{0,4}\.json$/.test(suffix)) throw new Error('Unexpected publication artifact');
      return { name, version: Number(suffix.slice(0, -5)) };
    }).sort((a, b) => a.version - b.version);
    const history: PhotoPublicationRecord[] = [];
    for (const [index, file] of versions.entries()) {
      const item = parsePhotoPublicationRecord(JSON.parse(photoFile(resolve(this.root, file.name), 65536).toString('utf8')));
      const previous = history.at(-1);
      if (file.version !== index + 1 || item.version !== file.version || item.ingredientId !== ingredientId ||
          item.previousDigest !== (previous?.digest ?? null) || item.digest !== photoPublicationDigest(item) ||
          (previous && item.createdAt < previous.createdAt) || (item.action === 'publish' && item.validUntil <= item.createdAt)) throw new Error('Publication journal integrity failure');
      history.push(item);
    }
    return history.reverse();
  }
  append(record: PhotoPublicationRecord): PhotoPublicationRecord {
    return withPhotoResourceLock(this.root, () => this.appendLocked(record));
  }
  private appendLocked(record: PhotoPublicationRecord): PhotoPublicationRecord {
    const item = parsePhotoPublicationRecord(record), current = this.history(item.ingredientId)[0];
    if (item.version !== (current?.version ?? 0) + 1 || item.previousDigest !== (current?.digest ?? null)) throw new AccountError(409, 'photo_publication_conflict', '图片发布版本已变化，请重新读取。');
    if (item.version > 10000 || item.digest !== photoPublicationDigest(item) || (current && item.createdAt < current.createdAt) ||
      (item.action === 'publish' && item.validUntil <= item.createdAt)) throw new Error('Invalid publication record');
    let fd: number;
    try { fd = openSync(resolve(this.root, `${item.ingredientId}.${item.version}.json`), 'wx', 0o600); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new AccountError(409, 'photo_publication_conflict', '另一窗口已更新图片发布，请重新读取。');
      throw error;
    }
    try { writeFileSync(fd, `${JSON.stringify(item)}\n`, 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    return item;
  }
}
