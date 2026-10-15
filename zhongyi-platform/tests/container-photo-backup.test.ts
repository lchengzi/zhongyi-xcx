import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { parsePhotoBackupArguments } from '../server/photo-backup-command.js';
import { rejectContainerPhotoBackupSettings, validateContainerPhotoBackup } from '../server/container-photo-backup.js';
import { ciEnvironment } from '../tools/ci-core.js';

function fixture() {
  const parent = resolve('.local/container-photo-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(resolve(parent, 'run-')), key = randomBytes(32), keyFile = resolve(root, 'test-key.txt');
  const directories = Object.fromEntries(['database', 'input', 'output', 'restore', 'originals', 'derivatives', 'journal'].map(name => {
    const path = resolve(root, name); mkdirSync(path); return [name, path];
  }));
  writeFileSync(keyFile, key.toString('base64'), { flag: 'wx', mode: 0o600 });
  const env: NodeJS.ProcessEnv = { PHOTO_RESOURCE_BACKUP_KEY_FILE: keyFile, PHOTO_BACKUP_DATABASE_DIRECTORY: directories.database,
    PHOTO_BACKUP_INPUT_DIRECTORY: directories.input };
  const args = ['verify', '--input', resolve(directories.input, 'resources.json'), '--database-backup', resolve(directories.database, 'database.json')];
  return { root, key, keyFile, directories, env, args, close() {
    assert.equal(dirname(keyFile), root); assert(lstatSync(keyFile).isFile() && !lstatSync(keyFile).isSymbolicLink());
    assert.equal(readFileSync(keyFile, 'utf8'), key.toString('base64')); unlinkSync(keyFile); key.fill(0);
  } };
}

test('photo backup parser is shared, immutable and rejects missing confirmation, relative or extra arguments', () => {
  const f = fixture();
  try {
    const before = [...f.args]; assert.equal(parsePhotoBackupArguments(f.args).action, 'verify'); assert.deepEqual(f.args, before);
    const restore = ['restore', ...f.args.slice(1), '--target-parent', f.directories.restore, '--confirm-maintenance'];
    assert.equal(parsePhotoBackupArguments(restore).action, 'restore');
    for (const args of [[], ['unknown'], [...f.args, '--ignored'], ['verify', '--input', 'relative', ...f.args.slice(3)],
      restore.slice(0, -1), ['verify', '--database-backup', f.directories.database, '--input', f.directories.input]]) assert.throws(() => parsePhotoBackupArguments(args));
  } finally { f.close(); }
});

test('photo file operator isolates every mount, forbids SQL/inline credentials and rejects settings on ordinary containers', () => {
  const f = fixture();
  try {
    assert.equal(validateContainerPhotoBackup(f.args, f.env).action, 'verify');
    for (const name of ['DATABASE_URL', 'DATABASE_URL_FILE', 'DATABASE_OWNER_URL_FILE', 'DATABASE_RUNTIME_URL_FILE', 'BACKUP_ENCRYPTION_KEY',
      'BACKUP_ENCRYPTION_KEY_FILE', 'BACKUP_INPUT_DIRECTORY', 'BACKUP_OUTPUT_DIRECTORY', 'PHOTO_RESOURCE_BACKUP_KEY', 'PHOTO_BACKUP_UNRECOGNIZED',
      'PHOTO_BACKUP_OUTPUT_DIRECTORY', 'PHOTO_BACKUP_RESTORE_DIRECTORY', 'PHOTO_BACKUP_ORIGINALS_DIRECTORY']) {
      assert.throws(() => validateContainerPhotoBackup(f.args, { ...f.env, [name]: f.keyFile }));
    }
    for (const patch of [{ PHOTO_RESOURCE_BACKUP_KEY_FILE: '' }, { PHOTO_RESOURCE_BACKUP_KEY_FILE: 'relative' },
      { PHOTO_RESOURCE_BACKUP_KEY_FILE: resolve(f.directories.input, 'hidden-key') }, { PHOTO_RESOURCE_BACKUP_KEY_FILE: f.root },
      { PHOTO_BACKUP_INPUT_DIRECTORY: f.directories.database }, { PHOTO_BACKUP_INPUT_DIRECTORY: f.root },
      { PHOTO_BACKUP_INPUT_DIRECTORY: resolve(f.root, 'missing') }, { ENABLE_PHOTO_PUBLICATION: 'true' }, { AI_EXTERNAL_ENABLED: 'true' }]) {
      assert.throws(() => validateContainerPhotoBackup(f.args, { ...f.env, ...patch }));
    }
    for (const input of [f.directories.input, resolve(f.directories.output, 'escape'), resolve(f.directories.input, '../escape'), resolve(f.directories.input, 'nested/child')]) {
      assert.throws(() => validateContainerPhotoBackup(['verify', '--input', input, ...f.args.slice(3)], f.env));
    }
    const restoreArgs = ['restore', ...f.args.slice(1), '--target-parent', f.directories.restore, '--confirm-maintenance'];
    assert.equal(validateContainerPhotoBackup(restoreArgs, { ...f.env, PHOTO_BACKUP_RESTORE_DIRECTORY: f.directories.restore }).action, 'restore');
    assert.throws(() => validateContainerPhotoBackup(restoreArgs, { ...f.env, PHOTO_BACKUP_RESTORE_DIRECTORY: f.directories.output }));
    const exportArgs = ['export', '--originals-root', f.directories.originals, '--manifest', resolve(f.directories.originals, 'manifest.json'),
      '--derivatives-root', f.directories.derivatives, '--journal-root', f.directories.journal, '--database-backup', f.args[4], '--output', resolve(f.directories.output, 'backup.json'), '--confirm-maintenance'];
    const exportEnv = { ...f.env, PHOTO_BACKUP_INPUT_DIRECTORY: '', PHOTO_BACKUP_OUTPUT_DIRECTORY: f.directories.output,
      PHOTO_BACKUP_ORIGINALS_DIRECTORY: f.directories.originals, PHOTO_BACKUP_DERIVATIVES_DIRECTORY: f.directories.derivatives, PHOTO_BACKUP_JOURNAL_DIRECTORY: f.directories.journal };
    assert.equal(validateContainerPhotoBackup(exportArgs, exportEnv).action, 'export');
    assert.throws(() => validateContainerPhotoBackup([...exportArgs.slice(0, 2), f.root, ...exportArgs.slice(3)], exportEnv));
    for (const settings of [{ PHOTO_BACKUP_INPUT_DIRECTORY: f.directories.input }, { PHOTO_RESOURCE_BACKUP_KEY_FILE: f.keyFile }, { PHOTO_RESOURCE_BACKUP_KEY: f.key.toString('base64') }]) {
      assert.throws(() => rejectContainerPhotoBackupSettings(settings));
    }
    rejectContainerPhotoBackupSettings({ PHOTO_RESOURCE_BACKUP_KEY_FILE: '', DATABASE_URL: 'untouched' });
    const inherited: NodeJS.ProcessEnv = { ...f.env, PHOTO_BACKUP_UNKNOWN_FUTURE: 'private', ENABLE_PHOTO_PUBLICATION: 'true' };
    const clean = ciEnvironment(inherited, resolve(f.root, 'not-created.sqlite'));
    assert.equal(clean.ENABLE_PHOTO_PUBLICATION, 'false'); assert(!Object.keys(clean).some(name => name.startsWith('PHOTO_BACKUP_') || name.startsWith('PHOTO_RESOURCE_BACKUP_')));
    assert.equal(inherited.PHOTO_RESOURCE_BACKUP_KEY_FILE, f.keyFile);
    for (const path of Object.values(f.directories)) assert.deepEqual(readdirSync(path), []);
  } finally { f.close(); }
});

test('photo Compose has three file-only operators with no network/SQL secrets, explicit mount permissions and safe defaults', () => {
  const doc = parseDocument(readFileSync('compose.photos.yaml', 'utf8'), { uniqueKeys: true, merge: true }); assert.deepEqual(doc.errors, []);
  const config = doc.toJS(); assert.deepEqual(Object.keys(config.services), ['photo-export', 'photo-verify', 'photo-restore']);
  const services: Record<string, { image: string; network_mode: string; ports?: unknown; read_only: boolean; cap_drop: string[]; security_opt: string[];
    secrets: string[]; profiles: string[]; healthcheck: { disable: boolean }; logging: { driver: string }; command: string[]; environment: Record<string, string>;
    volumes: { type: string; bind: { create_host_path: boolean }; read_only?: boolean; target: string }[] }> = config.services;
  for (const [name, service] of Object.entries(services)) {
    assert.equal(service.image, 'food-education-demo:local'); assert.equal(service.network_mode, 'none'); assert.equal(service.ports, undefined);
    assert.equal(service.read_only, true); assert.deepEqual(service.cap_drop, ['ALL']); assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(service.secrets, ['photo_resource_backup_key']); assert.deepEqual(service.profiles, ['photo-operations']);
    assert.equal(service.healthcheck.disable, true); assert.equal(service.logging.driver, 'none'); assert.deepEqual(service.command, ['photo-backup', name.slice(6)]);
    assert.equal(service.environment.PHOTO_RESOURCE_BACKUP_KEY_FILE, '/run/secrets/photo_resource_backup_key');
    for (const [variable, value] of Object.entries(service.environment)) {
      assert(!variable.startsWith('DATABASE_') && !variable.startsWith('BACKUP_')); assert(!variable.includes('URL'));
      if (['ENABLE_PHOTO_PUBLICATION', 'EDUCATION_PUBLICATION_ENABLED', 'AI_EXTERNAL_ENABLED'].includes(variable)) assert.equal(value, 'false');
    }
    for (const volume of service.volumes) {
      assert.equal(volume.type, 'bind'); assert.equal(volume.bind.create_host_path, false);
      assert.equal(volume.read_only === true, !['/photo-journal', '/photo-archive-output', '/photo-recovery'].includes(volume.target));
    }
    assert.equal(service.volumes.length, name === 'photo-export' ? 5 : name === 'photo-verify' ? 2 : 3);
  }
  assert.match(config.secrets.photo_resource_backup_key.file, /\$\{CONTAINER_PHOTO_BACKUP_KEY_FILE:\?/);
  assert.match(readFileSync('Dockerfile', 'utf8'), /COPY --from=build \/app\/zhongyi-platform\/build\/tools\/backup-photo-resources.js/);
});

test('actual compiled container entrypoint rejects unsafe photo commands and ordinary-command key mounts before writing or logging secrets', async () => {
  const f = fixture(), execute = promisify(execFile);
  try {
    const environment = { ...ciEnvironment(process.env, resolve(f.root, 'must-not-exist.sqlite')), ...f.env, NODE_ENV: 'production' };
    for (const [args, patch] of [
      [['photo-backup'], {}], [['photo-backup', ...f.args], { DATABASE_OWNER_URL_FILE: 'sensitive-owner-path' }],
      [['photo-backup', ...f.args], { PHOTO_RESOURCE_BACKUP_KEY: f.key.toString('base64') }],
      [['photo-backup', 'verify', '--input', resolve(f.directories.output, 'escape'), ...f.args.slice(3)], {}],
      ...['server', 'bootstrap', 'init', 'migrate', 'backup', 'runtime-role'].map(command => [[command], {}] as const)
    ] as const) {
      await assert.rejects(execute(process.execPath, [resolve('build/tools/container-entrypoint.js'), ...args], { env: { ...environment, ...patch }, windowsHide: true }), (error: unknown) => {
        assert(error && typeof error === 'object' && 'code' in error && 'stderr' in error && 'stdout' in error);
        assert.equal(error.code, 1); assert.match(String(error.stderr), /Container command failed/);
        const output = `${error.stdout}${error.stderr}`; assert(!output.includes(f.key.toString('base64')) && !output.includes('sensitive-owner-path')); return true;
      });
    }
    for (const path of Object.values(f.directories)) assert.deepEqual(readdirSync(path), []);
    assert(!readdirSync(f.root).some(name => name.endsWith('.sqlite')));
  } finally { f.close(); }
});
