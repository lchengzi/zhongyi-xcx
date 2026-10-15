import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { parseBackupArguments } from '../server/backup-command.js';
import { containerEnvironment, type ContainerDatabaseCommand } from '../server/container-secrets.js';
import { validateContainerBackup } from '../server/container-backup.js';
import { ciEnvironment } from '../tools/ci-core.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'food-container-backup-'));
  const output = join(directory, 'output'), input = join(directory, 'input'); mkdirSync(output); mkdirSync(input);
  const keyFile = join(directory, 'key.txt'), ownerFile = join(directory, 'owner.txt');
  const key = Buffer.alloc(32, 7).toString('base64');
  writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 });
  writeFileSync(ownerFile, 'postgresql://owner:test-only-password@localhost:1/unreachable', { flag: 'wx', mode: 0o600 });
  const env = { NODE_ENV: 'production', DATABASE_OWNER_URL_FILE: ownerFile, BACKUP_ENCRYPTION_KEY_FILE: keyFile };
  const dispose = () => {
    const files: string[] = [], directories: string[] = [];
    const inspect = (path: string) => {
      assert(path === directory || path.startsWith(`${directory}${sep}`)); assert.equal(lstatSync(path).isSymbolicLink(), false); assert.equal(realpathSync(path), resolve(path));
      if (lstatSync(path).isDirectory()) { for (const name of readdirSync(path)) inspect(join(path, name)); directories.push(path); }
      else { assert(lstatSync(path).isFile()); files.push(path); }
    };
    inspect(directory); assert(files.length <= 10 && directories.length <= 4);
    for (const file of files) unlinkSync(file); for (const folder of directories) rmdirSync(folder);
  };
  return { directory, output, input, key, keyFile, ownerFile, env, dispose };
}

test('shared backup argument parser requires explicit schema and exactly the selected input/output mode without mutation', () => {
  const args = ['--schema', 'food_workspace', '--output', 'archive.zfbackup'];
  assert.deepEqual(parseBackupArguments(args), { restore: false, schema: 'food_workspace', filename: 'archive.zfbackup' }); assert.equal(args.length, 4);
  assert.equal(parseBackupArguments(['--restore','--input','archive.zfbackup','--schema','restored_workspace']).restore, true);
  for (const bad of [[], ['--schema','food_workspace'], [...args,'--schema','again'], [...args,'--key','never'],
    ['--restore',...args], ['--schema','food_workspace','--input','archive.zfbackup'], ['--schema','bad;schema','--output','a']]) assert.throws(() => parseBackupArguments(bad));
});

test('container backup accepts only its independent bounded canonical key file and denies keys/archive configuration to every other command', () => {
  const f = fixture();
  try {
    const result = containerEnvironment(f.env, 'backup'); assert.equal(result.BACKUP_ENCRYPTION_KEY, f.key);
    assert.equal(result.BACKUP_ENCRYPTION_KEY_FILE, undefined); assert.equal(Object.hasOwn(f.env,'BACKUP_ENCRYPTION_KEY'), false);
    for (const patch of [{ BACKUP_ENCRYPTION_KEY: f.key }, { BACKUP_ENCRYPTION_KEY_FILE: '' }, { BACKUP_ENCRYPTION_KEY_FILE: 'relative' },
      { BACKUP_ENCRYPTION_KEY_FILE: f.directory }, { BACKUP_ENCRYPTION_KEY_FILE: join(f.directory,'missing') }]) assert.throws(() => containerEnvironment({ ...f.env,...patch }, 'backup'));
    for (const value of ['', 'x'.repeat(129), f.key + '\nsecond', Buffer.alloc(31).toString('base64'), f.key.slice(0,-2)+'B=']) {
      writeFileSync(f.keyFile,value); assert.throws(() => containerEnvironment(f.env,'backup'));
    }
    writeFileSync(f.keyFile,f.key+'\n'); assert.equal(containerEnvironment(f.env,'backup').BACKUP_ENCRYPTION_KEY,f.key);
    for (const command of ['server','bootstrap','init','migrate','runtime-role'] as ContainerDatabaseCommand[]) {
      const runtime = ['server','bootstrap'].includes(command);
      const connection = { NODE_ENV:'production', [runtime ? 'DATABASE_RUNTIME_URL_FILE' : 'DATABASE_OWNER_URL_FILE']:f.ownerFile };
      for (const extra of [{ BACKUP_ENCRYPTION_KEY_FILE:f.keyFile },{ BACKUP_ENCRYPTION_KEY:f.key },{ BACKUP_INPUT_DIRECTORY:f.input },{ BACKUP_OUTPUT_DIRECTORY:f.output }]) {
        assert.throws(() => containerEnvironment({ ...connection,...extra },command));
      }
    }
  } finally { f.dispose(); }
});

test('container archive selection is absolute, one-purpose and bounded to one direct file with all credentials outside it', () => {
  const f = fixture();
  try {
    const filename=join(f.output,'business.zfbackup'), args=['--schema','food_workspace','--output',filename];
    const env={...f.env,BACKUP_OUTPUT_DIRECTORY:f.output}; assert.equal(validateContainerBackup(args,env).filename,filename);
    assert.equal(validateContainerBackup(['--restore','--schema','restored_workspace','--input',join(f.input,'business.zfbackup')],{...f.env,BACKUP_INPUT_DIRECTORY:f.input}).restore,true);
    for (const name of [f.output,join(f.input,'escape.zfbackup'),join(f.output,'..','escape.zfbackup'),join(f.output,'nested','child.zfbackup'),'relative.zfbackup']) {
      assert.throws(() => validateContainerBackup(['--schema','food_workspace','--output',name],env));
    }
    for (const patch of [{BACKUP_OUTPUT_DIRECTORY:''},{BACKUP_OUTPUT_DIRECTORY:'relative'},{BACKUP_OUTPUT_DIRECTORY:f.keyFile},
      {BACKUP_INPUT_DIRECTORY:f.input},{BACKUP_ENCRYPTION_KEY_FILE:join(f.output,'..secret')},{DATABASE_OWNER_URL_FILE:join(f.output,'owner.txt')}]) {
      assert.throws(() => validateContainerBackup(args,{...env,...patch}));
    }
  } finally { f.dispose(); }
});

test('backup Compose extension mounts a key only on one-shot operators, exports writable and restores read-only without auto creating host paths', () => {
  const doc=parseDocument(readFileSync('compose.backup.yaml','utf8'),{uniqueKeys:true}); assert.deepEqual(doc.errors,[]); const config=doc.toJS();
  assert.deepEqual(Object.keys(config.services).sort(),['backup-export','backup-restore']);
  for (const [name,profile,target,readOnly,variable] of [
    ['backup-export','backup','/archive-output',false,'BACKUP_OUTPUT_DIRECTORY'],['backup-restore','restore','/archive-input',true,'BACKUP_INPUT_DIRECTORY']
  ] as const) {
    const service=config.services[name]; assert.deepEqual(service.profiles,[profile]); assert.equal(service.read_only,true);
    assert.deepEqual(service.secrets,['owner_database_url','database_ca','backup_encryption_key']); assert.equal(service.ports,undefined);
    assert.equal(service.environment.BACKUP_ENCRYPTION_KEY,undefined); assert.equal(service.environment.BACKUP_ENCRYPTION_KEY_FILE,'/run/secrets/backup_encryption_key');
    assert.equal(service.environment[variable],target); assert.equal(service.environment.DATABASE_RUNTIME_URL_FILE,undefined);
    assert.equal(service.environment.EDUCATION_PUBLICATION_ENABLED,'false'); assert.equal(service.environment.AI_EXTERNAL_ENABLED,'false');
    assert.equal(service.volumes.length,1); assert.equal(service.volumes[0].target,target); assert.equal(service.volumes[0].read_only===true,readOnly);
    assert.equal(service.volumes[0].bind.create_host_path,false); assert.equal(service.logging.driver,'none');
    assert.deepEqual(service.command,name==='backup-export'?['backup']:['backup','--restore']);
  }
  const base=parseDocument(readFileSync('compose.restricted.yaml','utf8'),{merge:true}).toJS();
  for(const name of ['app','operator','bootstrap']) assert.equal(base.services[name].secrets.includes('backup_encryption_key'),false);
});

test('real container CLI rejects escaping archive paths and missing/conflicting key files before connecting or writing', async () => {
  const f=fixture(), execute=promisify(execFile);
  try {
    const args=['backup','--schema','food_workspace','--output',join(f.output,'business.zfbackup')];
    const base={...ciEnvironment(process.env,join(f.directory,'must-not-exist.sqlite')),...f.env,BACKUP_OUTPUT_DIRECTORY:f.output};
    for(const [input,patch] of [[['backup'],{}],[['backup','--schema','food_workspace','--output',join(f.input,'escape.zfbackup')],{}],
      [args,{BACKUP_ENCRYPTION_KEY_FILE:''}],[args,{BACKUP_ENCRYPTION_KEY:f.key}],[args,{BACKUP_INPUT_DIRECTORY:f.input}]] as const) {
      await assert.rejects(execute(process.execPath,['--import','tsx','tools/container-entrypoint.ts',...input],{env:{...base,...patch},windowsHide:true}), (error:any)=>{
        assert.equal(error.code,1); assert.match(error.stderr,/Container command failed/); for(const secret of [f.key,'test-only-password']) assert.equal(`${error.stdout}${error.stderr}`.includes(secret),false); return true;
      });
    }
    assert.deepEqual(readdirSync(f.output),[]); assert.deepEqual(readdirSync(f.input),[]);
  } finally { f.dispose(); }
});
