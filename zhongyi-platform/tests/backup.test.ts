import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync, unlinkSync, symlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { backupKey, decryptBackup, encryptBackup, readBackupFile, writeBackupFile, validatePostgresBackup, restorePostgresBackup } from '../server/postgres-backup.js';
import { migrationFixture, fixturePassword } from './migration-fixture.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';

test('backup AES-256-GCM roundtrip is randomized, authenticates every envelope field, and exposes no private plaintext', async () => {
  const fixture = await migrationFixture();
  try {
    const backup = unitBackup(fixture.read()); const key = randomBytes(32);
    const first = encryptBackup(backup, key); const second = encryptBackup(backup, key);
    assert.notDeepEqual(first, second); assert.deepEqual(decryptBackup(first, key, fixture.seed), backup);
    assert.deepEqual(backupKey(key.toString('base64')), key);
    for (const secret of [fixturePassword, fixture.token, '第四版私有备注', '私有测试草稿', key.toString('base64'), backup.data.tables.users[0].password_hash as string]) assert.equal(first.toString().includes(secret), false);
    assert.throws(() => decryptBackup(first, randomBytes(32), fixture.seed), (e: any) => e.code === 'backup_authentication_failed');
    for (const field of ['iv', 'tag', 'ciphertext', 'algorithm', 'format', 'version', 'extra']) {
      const envelope = JSON.parse(first.toString());
      if (['iv', 'tag', 'ciphertext'].includes(field)) { const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1; envelope[field] = bytes.toString('base64'); }
      else envelope[field] = 'tampered';
      assert.throws(() => decryptBackup(Buffer.from(JSON.stringify(envelope)), key, fixture.seed), (e: any) => e.code === 'backup_authentication_failed', field);
    }
    for (const invalid of [undefined, '', 'a'.repeat(44), randomBytes(31).toString('base64'), key.toString('hex'), key.toString('base64') + '\n']) assert.throws(() => backupKey(invalid));
    assert.throws(() => encryptBackup(backup, Buffer.alloc(31)));
  } finally { fixture.dispose(); }
});

test('backup validation rejects modified data, rehashed unknown fields, incomplete histories and inconsistent source versions', async () => {
  const fixture = await migrationFixture();
  try {
    const original = unitBackup(fixture.read()); assert.deepEqual(validatePostgresBackup(original, fixture.seed), original);
    const changed = structuredClone(original); changed.data.tables.editorial_notes[0].text = 'changed';
    assert.throws(() => validatePostgresBackup(changed, fixture.seed), (e: any) => e.code === 'backup_changed');
    const mutations: ((backup: any) => void)[] = [
      (b) => { b.extra = 'unknown'; }, (b) => { b.data.extra = []; }, (b) => { b.data.tables.unknown = []; },
      (b) => { b.data.postgresMigrations[0].checksum = 'sha256:' + '0'.repeat(64); },
      (b) => { b.data.postgresMigrations.pop(); }, (b) => { b.data.migrationRuns = [null]; },
      (b) => { b.data.migrationRuns[0].row_counts.unknown = 1; },
      (b) => { b.data.sqliteSchemaVersion = 3; }, (b) => { b.data.sequences.security_events = 0; }
    ];
    for (const mutate of mutations) { const bad = structuredClone(original); mutate(bad); rehashBackup(bad); assert.throws(() => validatePostgresBackup(bad, fixture.seed)); }
  } finally { fixture.dispose(); }
});

test('backup files are explicit exclusive regular files; existing files, directories, missing parents and linked ancestors are refused', async () => {
  const fixture = await migrationFixture(); const filename = join(fixture.directory, 'owned.zfbackup'); const link = join(fixture.directory, 'linked-parent');
  let linked = false; let written = false;
  try {
    const encrypted = encryptBackup(unitBackup(fixture.read()), randomBytes(32));
    writeBackupFile(filename, encrypted); written = true; assert.deepEqual(readBackupFile(filename), encrypted);
    assert.throws(() => writeBackupFile(filename, Buffer.from('must-not-overwrite')), (e: any) => e.code === 'EEXIST');
    assert.deepEqual(readBackupFile(filename), encrypted);
    assert.throws(() => readBackupFile(fixture.directory), (e: any) => e.code === 'unsafe_backup_path');
    assert.throws(() => writeBackupFile(join(fixture.directory, 'missing', 'file'), encrypted));
    symlinkSync(fixture.directory, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
    assert.throws(() => readBackupFile(join(link, 'owned.zfbackup')), (e: any) => e.code === 'unsafe_backup_path');
    assert.throws(() => writeBackupFile(join(link, 'new.zfbackup'), encrypted), (e: any) => e.code === 'unsafe_backup_path');
  } finally {
    // Only this known test link and known regular file; never recursive cleanup.
    if (linked) { assert(lstatSync(link).isSymbolicLink()); if (process.platform === 'win32') rmdirSync(link); else unlinkSync(link); }
    if (written) { assert(lstatSync(filename).isFile()); assert(!lstatSync(filename).isSymbolicLink()); assert.equal(realpathSync(filename), filename); unlinkSync(filename); }
    fixture.dispose();
  }
});

test('invalid recovery payload is rejected before a destination connection is acquired', async () => {
  const fixture = await migrationFixture(); let connections = 0;
  const pool = { connect: async () => { connections++; throw new Error('Destination must not be touched'); } };
  try {
    const backup = unitBackup(fixture.read()); backup.data.tables.editorial_notes[0].text = 'unauthenticated change';
    await assert.rejects(restorePostgresBackup(pool as any, 'unit_recovery', backup, fixture.seed), (e: any) => e.code === 'backup_changed');
    assert.equal(connections, 0);
  } finally { fixture.dispose(); }
});
