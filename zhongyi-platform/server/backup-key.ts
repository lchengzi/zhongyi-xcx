import { MigrationError } from './migration-snapshot.js';

export function backupKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new MigrationError('missing_backup_key', '通过安全配置提供32字节随机密钥的标准Base64，不放在参数或聊天中。');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) { key.fill(0); throw new MigrationError('invalid_backup_key', '备份密钥格式无效。'); }
  return key;
}
