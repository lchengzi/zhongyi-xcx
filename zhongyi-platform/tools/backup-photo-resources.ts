import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { backupKey } from '../server/backup-key.js';
import { photoFile, photoPath } from '../server/photo-files.js';
import { capturePhotoResources, decryptPhotoResources, encryptPhotoResources, MAX_PHOTO_BACKUP_BYTES, restorePhotoResources, writeNewPhotoFile } from '../server/photo-resource-backup.js';
import { parsePhotoBackupArguments } from '../server/photo-backup-command.js';

let key: Buffer | undefined;
try {
  const command = parsePhotoBackupArguments(process.argv.slice(2)), { action } = command;
  if (process.env.PHOTO_RESOURCE_BACKUP_KEY && process.env.PHOTO_RESOURCE_BACKUP_KEY_FILE) throw new Error('Ambiguous key source');
  key = backupKey(process.env.PHOTO_RESOURCE_BACKUP_KEY_FILE ? photoFile(process.env.PHOTO_RESOURCE_BACKUP_KEY_FILE, 128).toString('utf8').trim() : process.env.PHOTO_RESOURCE_BACKUP_KEY);
  const databaseArchiveSha256 = `sha256:${createHash('sha256').update(photoFile(command.databaseBackup, 48 * 1024 * 1024)).digest('hex')}`;
  if (command.action === 'export') {
    const backup = capturePhotoResources({ ...command, databaseArchiveSha256 });
    photoPath(dirname(command.output), true); writeNewPhotoFile(command.output, encryptPhotoResources(backup, key));
    console.log(JSON.stringify({ action, files: backup.files.length, digest: backup.digest, databaseArchiveSha256, encrypted: true, databaseIncluded: false, publicationEnabled: false }));
  } else {
    const backup = decryptPhotoResources(photoFile(command.input, MAX_PHOTO_BACKUP_BYTES), key);
    if (backup.databaseArchiveSha256 !== databaseArchiveSha256) throw new Error('Database association mismatch');
    if (command.action === 'restore') {
      const restored = restorePhotoResources(backup, command.targetParent, databaseArchiveSha256);
      console.log(JSON.stringify({ action, directory: restored.directory, files: backup.files.length, digest: backup.digest, encrypted: true, databaseIncluded: false, publicationEnabled: false }));
    } else console.log(JSON.stringify({ action, files: backup.files.length, digest: backup.digest, encrypted: true, databaseIncluded: false, publicationEnabled: false }));
  }
} catch { console.error('图片资源备份命令失败。请核对明确的绝对路径、独立密钥、关联数据库归档和维护状态；未覆盖原目录。'); process.exitCode = 1; }
finally { key?.fill(0); }
