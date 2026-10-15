import { identifier, MigrationError } from './migration-snapshot.js';

export function parseBackupArguments(input: readonly string[]) {
  const args = [...input]; const restore = args[0] === '--restore'; if (restore) args.shift();
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--schema', restore ? '--input' : '--output'].includes(args[i]) || !args[i + 1] || values[args[i]]) {
      throw new MigrationError('invalid_arguments', '备份：--schema 已有目标 --output 全新文件；恢复：--restore --input 加密文件 --schema 全新目标。凭据与密钥只用安全配置。');
    }
    values[args[i]] = args[i + 1];
  }
  if (!values['--schema'] || !values[restore ? '--input' : '--output']) throw new MigrationError('invalid_arguments', '必须显式指定schema和文件；不选择默认工作库。');
  identifier(values['--schema']);
  return { restore, schema: values['--schema'], filename: values[restore ? '--input' : '--output'] };
}
