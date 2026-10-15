import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import { createPostgresPool } from '../server/postgres-migration.js';
import { identifier } from '../server/migration-snapshot.js';
import { configurePostgresRuntimePermissions, verifyCurrentPostgresRuntimePermissions, POSTGRES_RUNTIME_POLICY } from '../server/postgres-permissions.js';
import { openConfiguredStore } from '../server/store-config.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { ciEnvironment } from '../tools/ci-core.js';
import { fixtureApplicationWrapper, fixtureApplicationCompletion } from '../tools/fixture-application.js';
import { noteInput, notePhoto } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';
import type { PhotoProfessionalInput } from '../shared/photo-professional.js';

await import('./postgres-tls.test.js');
const original = process.env.PG_TEST_DATABASE_URL;
if (!original || !process.connected) throw new Error('Live isolated PostgreSQL controller required');
const execute = promisify(execFile);
const suffix = randomBytes(8).toString('hex');
const owner = `owner_${suffix}`, role = `runtime_${suffix}`, fresh = `fresh_${suffix}`, database = `permissions_${suffix}`;
const schema = 'food_workspace', target = identifier(schema);
const ownerPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex');
const bootstrapPassword = randomBytes(24).toString('hex');
const urlFor = (user: string, password: string) => {
  const url = new URL(original); url.username = user; url.password = password; url.pathname = `/${database}`; return url.toString();
};
const ownerUrl = urlFor(owner, ownerPassword), runtimeUrl = urlFor(role, runtimePassword);
let admin: Pool, migration: Pool, runtime: Pool;
const noSqlite = resolve('.local/postgres-tests', `permissions-${suffix}-must-not-exist.sqlite`);
const env = (url: string) => ({ ...ciEnvironment(process.env, noSqlite), DATABASE_PROVIDER: 'postgres', DATABASE_SCHEMA: schema, DATABASE_URL: url, BOOTSTRAP_PASSWORD: bootstrapPassword });
let secretDirectory: string | undefined, ownerFile = '', runtimeFile = '';
const containerEnv = (runtimeCredential: boolean) => ({ ...env(runtimeCredential ? runtimeUrl : ownerUrl), DATABASE_URL: '',
  DATABASE_OWNER_URL_FILE: runtimeCredential ? '' : ownerFile, DATABASE_RUNTIME_URL_FILE: runtimeCredential ? runtimeFile : '' });
const cli = (entry: 'init-postgres' | 'runtime-role-postgres' | 'bootstrap-account', args: string[], url = ownerUrl) => {
  const commands = { 'init-postgres': 'init', 'runtime-role-postgres': 'runtime-role', 'bootstrap-account': 'bootstrap' };
  return execute(process.execPath, ['build/tools/container-entrypoint.js', commands[entry], ...args], {
    env: { ...containerEnv(url === runtimeUrl), ...(entry === 'init-postgres' ? { PG_INITIALIZATION_DIAGNOSTICS: 'true' } : {}) }, windowsHide: true });
};
const unsafe = (error: unknown) => (error as { code?: string })?.code === 'unsafe_database_permissions';
const denied = (error: unknown) => (error as { code?: string })?.code === '42501';

describe('real PostgreSQL isolated non-superuser runtime/owner separation', { concurrency: false }, () => {
  before(async () => {
    secretDirectory = mkdtempSync(join(tmpdir(), 'food-permission-credentials-'));
    ownerFile = join(secretDirectory, 'owner-url.txt'); runtimeFile = join(secretDirectory, 'runtime-url.txt');
    writeFileSync(ownerFile, ownerUrl, { flag: 'wx', mode: 0o600 }); writeFileSync(runtimeFile, runtimeUrl, { flag: 'wx', mode: 0o600 });
    admin = createPostgresPool(original);
    // Hex-only random fixture secrets, never accepted from caller or printed.
    await admin.query(`CREATE ROLE ${identifier(owner)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${ownerPassword}'`);
    await admin.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${runtimePassword}'`);
    await admin.query(`CREATE ROLE ${identifier(fresh)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await admin.query(`CREATE DATABASE ${identifier(database)}`);
    // This brand-new fixture database is exclusively owned by this test.
    await admin.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(owner)}, ${identifier(role)}, ${identifier(fresh)}`);
    await admin.query(`GRANT CREATE ON DATABASE ${identifier(database)} TO ${identifier(owner)}`);
    migration = createPostgresPool(ownerUrl); runtime = createPostgresPool(runtimeUrl);
    const initialized = await cli('init-postgres', ['--schema', schema]);
    const report = JSON.parse(initialized.stdout); assert.equal(report.verified, true); assert.equal(report.rowCounts.ingredients, 106);
    const diagnostics = initialized.stderr.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.equal(diagnostics.length, 1); assert.equal(diagnostics[0].event, 'postgres_initialization');
    assert.equal(diagnostics[0].outcome, 'success'); assert.equal(diagnostics[0].code, null);
    assert.equal(diagnostics[0].phase, 'postgres-close'); assert.equal(diagnostics[0].rollback.outcome, 'not_started');
    assert.equal(diagnostics[0].cleanup.sqlite.outcome, 'completed'); assert.equal(diagnostics[0].cleanup.postgres.outcome, 'completed');
    for (const secret of [original, ownerUrl, runtimeUrl, ownerPassword, runtimePassword, bootstrapPassword, owner, role, database, ownerFile, runtimeFile]) assert.equal(initialized.stderr.includes(secret), false);
  });
  after(async () => {
    await Promise.all([runtime?.end(), migration?.end(), admin?.end()]); assert.equal(existsSync(noSqlite), false);
    if (secretDirectory) {
      assert.deepEqual(readdirSync(secretDirectory).sort(), ['owner-url.txt','runtime-url.txt']);
      assert.equal(lstatSync(secretDirectory).isSymbolicLink(), false); assert.equal(realpathSync(secretDirectory), resolve(secretDirectory));
      for (const file of [ownerFile, runtimeFile]) { assert.equal(lstatSync(file).isSymbolicLink(), false); assert(lstatSync(file).isFile()); assert.equal(realpathSync(file), resolve(file)); }
      unlinkSync(ownerFile); unlinkSync(runtimeFile); rmdirSync(secretDirectory);
    }
  });

  test('compiled container operator grants exact table policy using its owner-only secret, verifies it and safely reapplies it', async () => {
    await assert.rejects(configurePostgresRuntimePermissions(migration, schema, role), unsafe);
    await assert.rejects(runtime.query(`SELECT COUNT(*) FROM ${target}.ingredients`), denied);
    for (const mode of ['--apply', '--verify', '--apply']) {
      const result = await cli('runtime-role-postgres', [mode, '--schema', schema, '--role', role]);
      const report = JSON.parse(result.stdout); assert.equal(report.tables, 34); assert.equal(report.sequences, 3);
      assert.equal(report.action, mode === '--apply' ? 'granted' : 'verified');
      for (const secret of [original, ownerUrl, runtimeUrl, ownerPassword, runtimePassword, bootstrapPassword]) assert.equal((result.stdout + result.stderr).includes(secret), false);
    }
    const tls = (await runtime.query('SELECT current_user AS name, ssl, version, bits FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
    assert.equal(tls.name, role); assert.equal(tls.ssl, true); assert(['TLSv1.2','TLSv1.3'].includes(tls.version)); assert(tls.bits >= 128);
  });

  test('compiled container API and bootstrap use only the runtime secret, persist notes and draft history, audit and revoke sessions', async () => {
    await cli('bootstrap-account', ['permissions-admin'], runtimeUrl);
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as AddressInfo).port; await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', fixtureApplicationWrapper('container')], {
      windowsHide: true, env: { ...containerEnv(true), PORT: String(port), BIND_HOST: '127.0.0.1', ALLOWED_ORIGINS: origin }, stdio: ['ignore','pipe','pipe','ipc']
    });
    const completed = fixtureApplicationCompletion(child); let output = '';
    child.stdout!.on('data', (chunk) => { output += chunk; }); child.stderr!.on('data', (chunk) => { output += chunk; });
    let cookie = '', csrf = '';
    const api = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}/api/v1${path}`, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
    });
    try {
      const deadline = Date.now() + 30000;
      while (true) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Restricted runtime API exited before readiness');
        try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
        if (Date.now() >= deadline) throw new Error('Restricted runtime API readiness expired');
        await new Promise((done) => setTimeout(done, 100));
      }
      const logged = await api('/auth/login', 'POST', { username: 'permissions-admin', password: bootstrapPassword });
      assert.equal(logged.status, 200); cookie = logged.headers.get('set-cookie')!.split(';')[0]; csrf = (await logged.json() as { csrfToken: string }).csrfToken;
      assert.equal((await api('/ingredients/huang-qi/note', 'PUT', { text: 'private-permission-test', expectedRevision: 0 })).status, 200);
      const source = await api('/editorial/sources', 'POST', { title: '隔离工程测试', publisher: '测试', url: 'https://example.org/permissions-fixture' });
      assert.equal(source.status, 201); const ref = await source.json() as { id: string; revision: number };
      const drafted = await api('/editorial/ingredients/huang-qi', 'PUT', { expectedLockVersion: 0, content: { ediblePart: '工程测试', latinName: '', educationText: '私有测试，不发布。', safetyText: '未经审校。', sourceRefs: [{ id: ref.id, revision: ref.revision, locator: '测试位置' }] } });
      assert.equal(drafted.status, 200);
      const publicData = await (await api('/public/catalog')).text(); assert.equal(JSON.parse(publicData).items.length, 106); assert.equal(publicData.includes('private-permission-test'), false);
      assert.equal((await migration.query(`SELECT text FROM ${target}.editorial_notes WHERE ingredient_id='huang-qi'`)).rows[0].text, 'private-permission-test');
      for (const table of ['audit_events','security_events','workflow_events','content_revisions']) assert(Number((await migration.query(`SELECT COUNT(*) n FROM ${target}.${identifier(table)}`)).rows[0].n) > 0);
      assert.equal((await api('/auth/logout', 'POST')).status, 200);
      assert.equal((await api('/summary')).status, 401);
    } finally {
      if (child.exitCode === null && child.signalCode === null && child.connected) child.send('stop');
      const [code, signal] = await completed; assert.equal(code, 0); assert.equal(signal, null);
      for (const secret of [original, ownerUrl, runtimeUrl, ownerPassword, runtimePassword, bootstrapPassword]) assert.equal(output.includes(secret), false);
    }
  });

  test('compiled production container exports/restores with owner and independent key files; fresh restricted runtime rejects old sessions and preserves freeze/data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'food-container-recovery-'));
    const output = join(directory, 'output'), input = join(directory, 'input'); mkdirSync(output); mkdirSync(input);
    const keyFile = join(directory, 'key.txt'), restoredOwnerFile = join(directory, 'restored-owner.txt');
    const key = randomBytes(32).toString('base64'), wrongKey = randomBytes(32).toString('base64');
    const archive = join(output, 'business.zfbackup'), imported = join(input, 'business.zfbackup');
    const restoredDatabase = `recovery_${suffix}`, restoredSchema = 'restored_workspace';
    const recoveredUrl = (value: string) => { const url = new URL(value); url.pathname = `/${restoredDatabase}`; return url.toString(); };
    const recoveredOwner = recoveredUrl(ownerUrl), recoveredRuntime = recoveredUrl(runtimeUrl);
    writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 }); writeFileSync(restoredOwnerFile, recoveredOwner, { flag: 'wx', mode: 0o600 });
    const seed = JSON.parse(readFileSync('data/catalog.seed.json', 'utf8'));
    let oldToken = ''; const live = await openPostgresStore(runtimeUrl, schema, seed);
    try { oldToken = (await live.auth.login('permissions-admin', bootstrapPassword, 'container-backup-test')).token; }
    finally { await live.close(); }
    const restorePool = createPostgresPool(recoveredOwner);
    const run = async (restore: boolean, targetSchema = restoredSchema) => {
      const args = restore ? ['--restore','--input',imported,'--schema',targetSchema] : ['--schema',schema,'--output',archive];
      const options = { ...containerEnv(false), NODE_ENV:'production', DATABASE_OWNER_URL_FILE:restore?restoredOwnerFile:ownerFile,
        BACKUP_ENCRYPTION_KEY_FILE:keyFile, ...(restore?{BACKUP_INPUT_DIRECTORY:input}:{BACKUP_OUTPUT_DIRECTORY:output}) };
      const secrets = [original,ownerUrl,runtimeUrl,recoveredOwner,recoveredRuntime,key,wrongKey,bootstrapPassword,oldToken,'private-permission-test'];
      const check = (result: { stdout?: string; stderr?: string }) => { for(const secret of secrets) assert.equal(`${result.stdout || ''}${result.stderr || ''}`.includes(secret),false); };
      try { const result=await execute(process.execPath,['build/tools/container-entrypoint.js','backup',...args],{env:options,windowsHide:true}); check(result); return result; }
      catch(error) { check(error as {stdout:string;stderr:string}); throw error; }
    };
    try {
      await admin.query(`CREATE DATABASE ${identifier(restoredDatabase)}`);
      await admin.query(`REVOKE ALL ON DATABASE ${identifier(restoredDatabase)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${identifier(restoredDatabase)} TO ${identifier(owner)}, ${identifier(role)}`);
      await admin.query(`GRANT CREATE ON DATABASE ${identifier(restoredDatabase)} TO ${identifier(owner)}`);
      const saved=JSON.parse((await run(false)).stdout); assert.equal(saved.encrypted,true); assert.equal(saved.recoveryVerified,false); assert.equal(saved.businessTables, 32);
      const originalBytes=readFileSync(archive); assert.equal(originalBytes.includes(Buffer.from('private-permission-test')),false);
      await assert.rejects(run(false)); assert.deepEqual(readFileSync(archive),originalBytes);
      copyFileSync(archive,imported);
      writeFileSync(keyFile,wrongKey);
      await assert.rejects(run(true,'wrong_key_target'),(error:any)=>{assert.match(error.stderr,/backup_authentication_failed/);return true;});
      assert.equal((await restorePool.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',['wrong_key_target'])).rowCount,0);
      writeFileSync(keyFile,key);
      const restored=JSON.parse((await run(true)).stdout); assert.equal(restored.verified,true); assert(restored.sessionsRevoked>=1); assert.equal(restored.publicationFrozen,true);
      assert.equal(restored.publicationEnabled,false); assert.equal(restored.restoredSchema,restoredSchema);
      await assert.rejects(run(true),(error:any)=>{assert.match(error.stderr,/target_exists/);return true;});
      assert.deepEqual(readFileSync(imported),originalBytes); assert.deepEqual(readFileSync(archive),originalBytes);
      await assert.rejects(openPostgresStore(recoveredRuntime,restoredSchema,seed,true,true),unsafe);
      await configurePostgresRuntimePermissions(restorePool,restoredSchema,role,true);
      const stores=await openPostgresStore(recoveredRuntime,restoredSchema,seed,true,true);
      try {
        assert.equal(await stores.auth.session(oldToken),undefined);
        const login=await stores.auth.login('permissions-admin',bootstrapPassword,'recovered-container-test'); assert.equal(login.info.user.username,'permissions-admin');
        const photoNote = await stores.photoNotes.save(notePhoto(), noteInput(), { account: login.info.user, token: login.token });
        assert.equal(photoNote.version, 1); assert.equal(photoNote.candidate.publicationEligible, false);
        assert.deepEqual((await stores.photoNotes.detail(notePhoto())).history, [photoNote]);
        const submission = await stores.photoSubmissions.submit(notePhoto(), submissionInput(photoNote), { account: login.info.user, token: login.token });
        assert.equal(submission.version, 1); assert.equal(submission.noteDigest, photoNote.digest); assert.equal(submission.candidate.publicationEligible, false);
        assert.deepEqual((await stores.photoSubmissions.detail(notePhoto())).history, [submission]);
        const rightsReviewer = await stores.auth.createUser('permissions-rights-reviewer', bootstrapPassword, 'reviewer', 'engineering-test');
        const rightsLogin = await stores.auth.login(rightsReviewer.username, bootstrapPassword, 'rights-restricted-runtime');
        const rights = await stores.photoRights.review(notePhoto(), rightsInput(submission), { account: rightsLogin.info.user, token: rightsLogin.token });
        assert.equal(rights.version, 1); assert.equal(rights.actorId, rightsReviewer.id);
        const rightsDetail = await stores.photoRights.detail(notePhoto()); assert.equal(rightsDetail.state, 'recorded'); assert.equal(rightsDetail.publicationEligible, false); assert.deepEqual(rightsDetail.history, [rights]);
        const professional = await stores.auth.createUser('permissions-photo-professional', bootstrapPassword, 'reviewer', 'ENGINEERING_SIMULATION_NOT_REAL');
        const professionalLogin = await stores.auth.login(professional.username, bootstrapPassword, 'professional-restricted-runtime');
        const qualification = await stores.workflow.saveQualification(professional.id, credentialInput('pharmacist'), 0, login.info.user, login.token);
        const professionalInput: PhotoProfessionalInput = { bindingDigest: rights.bindingDigest, expectedVersion: 0, expectedSubmissionVersion: submission.version, submissionDigest: submission.digest,
          expectedNoteVersion: photoNote.version, noteDigest: photoNote.digest, expectedRightsVersion: rights.version, rightsDigest: rights.digest,
          profession: 'pharmacist', expectedQualificationRevision: qualification.revision, qualificationDigest: qualification.digest, decision: 'approve', identity: 'matches', part: 'matches', processing: 'matches',
          evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL:restricted-role', comment: '工程演练，不是真人批准。', verificationConfirmed: true };
        const opinion = await stores.photoProfessional.review(notePhoto(), professionalInput, { account: professionalLogin.info.user, token: professionalLogin.token });
        assert.equal(opinion.version, 1); assert.equal(opinion.actorId, professional.id);
        assert.deepEqual((await stores.photoProfessional.detail(notePhoto())).history, [opinion]); assert.equal((await stores.photoProfessional.detail(notePhoto())).publicationEligible, false);
        await stores.auth.logout(professionalLogin.token, professional.username);
        await stores.auth.logout(rightsLogin.token, rightsReviewer.username);
        const note=await stores.catalog.note('huang-qi'); assert.equal(note.text,'private-permission-test');
        const savedNote=await stores.catalog.saveNote('huang-qi','recovered-private-note',note.revision,'permissions-admin'); assert.equal(savedNote.revision,note.revision+1);
        assert.equal((await stores.catalog.publicSnapshot()).ingredients.length,106);
        await stores.auth.logout(login.token,'permissions-admin');
      } finally { await stores.close(); }
      assert.equal((await runtime.query('SELECT current_user AS name')).rows[0].name,role);
      assert.equal((await migration.query(`SELECT text FROM ${target}.editorial_notes WHERE ingredient_id='huang-qi'`)).rows[0].text,'private-permission-test');
    } finally {
      await restorePool.end();
      const files=[keyFile,restoredOwnerFile,...[archive,imported].filter(existsSync)];
      assert.deepEqual(readdirSync(directory).sort(),['input','key.txt','output','restored-owner.txt']);
      for(const [folder,file] of [[output,archive],[input,imported]]) assert.deepEqual(readdirSync(folder),existsSync(file)?['business.zfbackup']:[]);
      for(const path of [...files,input,output,directory]) { assert.equal(lstatSync(path).isSymbolicLink(),false); assert.equal(realpathSync(path),resolve(path)); }
      for(const file of files) { assert(lstatSync(file).isFile()); unlinkSync(file); } rmdirSync(input); rmdirSync(output); rmdirSync(directory);
    }
  });

  test('production store enforces read-only self audit for ambient and explicit environments without granting, repairing or accepting an owner', async () => {
    const seed = JSON.parse(readFileSync('data/catalog.seed.json', 'utf8'));
    await verifyCurrentPostgresRuntimePermissions(runtime, schema);
    let checkedReadOnlyPath = false;
    const observed = new Proxy(runtime, { get(pool, key) {
      if (key === 'connect') return async () => {
        const client = await pool.connect();
        // Simulate a role default putting a user schema before pg_catalog.
        await client.query('SET search_path TO public, pg_catalog');
        return new Proxy(client, { get(real, method) {
          if (method === 'query') return async (sql: string, values?: unknown[]) => {
            if (sql.includes('SELECT current_user AS name')) {
              assert.equal((await real.query('SHOW search_path')).rows[0].search_path, 'pg_catalog');
              assert.equal((await real.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
              checkedReadOnlyPath = true;
            }
            return real.query(sql, values);
          };
          if (method === 'release') return () => real.release(true);
          const value = Reflect.get(real, method); return typeof value === 'function' ? value.bind(real) : value;
        } });
      };
      const value = Reflect.get(pool, key); return typeof value === 'function' ? value.bind(pool) : value;
    } });
    await verifyCurrentPostgresRuntimePermissions(observed, schema); assert.equal(checkedReadOnlyPath, true);
    await assert.rejects(verifyCurrentPostgresRuntimePermissions(migration, schema), unsafe);
    const adminDb = createPostgresPool(urlFor(new URL(original).username, new URL(original).password));
    try {
      const session = await adminDb.connect();
      try {
        await session.query(`SET ROLE ${identifier(role)}`);
        // Keep this real session until RESET ROLE; the audit still performs its
        // normal BEGIN/ROLLBACK but must reject a privileged authenticated login.
        const borrowed = new Proxy(session, { get(client, key) { const value = Reflect.get(client, key);
          return key === 'release' ? () => {} : typeof value === 'function' ? value.bind(client) : value; } });
        const pool = new Proxy(adminDb, { get(real, key) { const value = Reflect.get(real, key);
          return key === 'connect' ? async () => borrowed : typeof value === 'function' ? value.bind(real) : value; } });
        await assert.rejects(verifyCurrentPostgresRuntimePermissions(pool, schema), unsafe);
      } finally { await session.query('RESET ROLE'); session.release(); }
    } finally { await adminDb.end(); }
    const explicit = await openConfiguredStore(seed, { ...env(runtimeUrl), NODE_ENV: 'production' });
    await explicit.close();
    await assert.rejects(openConfiguredStore(seed, { ...env(ownerUrl), NODE_ENV: 'production' }), unsafe);
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(openPostgresStore(ownerUrl, schema, seed, false, false), unsafe);
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
    const changes = [
      [`GRANT UPDATE ON ${target}.ingredients TO ${identifier(role)}`, `REVOKE UPDATE ON ${target}.ingredients FROM ${identifier(role)}`, 'ingredients', true],
      [`REVOKE UPDATE ON ${target}.editorial_notes FROM ${identifier(role)}`, `GRANT UPDATE ON ${target}.editorial_notes TO ${identifier(role)}`, 'editorial_notes', false]
    ] as const;
    for (const [change, undo, table, unchanged] of changes) {
      await migration.query(change);
      try {
        await assert.rejects(openConfiguredStore(seed, { ...env(runtimeUrl), NODE_ENV: 'production' }), unsafe);
        assert.equal((await migration.query('SELECT has_table_privilege($1,$2,\'UPDATE\') AS allowed', [role, `${schema}.${table}`])).rows[0].allowed, unchanged);
      } finally { await migration.query(undo); }
    }
    await verifyCurrentPostgresRuntimePermissions(runtime, schema);
  });

  test('runtime SQL cannot create/alter/drop/truncate, disable triggers, set owner role or reset audit sequences', async () => {
    for (const sql of [`CREATE TABLE ${target}.forbidden(id int)`, 'CREATE TEMP TABLE forbidden(id int)', 'CREATE SCHEMA forbidden',
      `ALTER TABLE ${target}.ingredients ADD COLUMN forbidden text`, `DROP TABLE ${target}.editorial_notes`,
      `ALTER TABLE ${target}.source_versions DISABLE TRIGGER ALL`, `TRUNCATE ${target}.sessions`,
      `SET ROLE ${identifier(owner)}`, `SELECT setval('${schema}.audit_events_id_seq', 1)`]) await assert.rejects(runtime.query(sql), denied);
    assert.equal(Number((await migration.query(`SELECT COUNT(*) n FROM ${target}.ingredients`)).rows[0].n), 106);
  });

  test('runtime SQL cannot rewrite catalog, migration or append-only history even using empty updates or column grants', async () => {
    for (const [table, allowed] of Object.entries(POSTGRES_RUNTIME_POLICY)) {
      const columns = (await migration.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position LIMIT 1', [schema, table])).rows;
      const column = identifier(columns[0].column_name);
      if (!(allowed as readonly string[]).includes('UPDATE')) await assert.rejects(runtime.query(`UPDATE ${target}.${identifier(table)} SET ${column}=${column} WHERE false`), denied);
      if (!(allowed as readonly string[]).includes('DELETE')) await assert.rejects(runtime.query(`DELETE FROM ${target}.${identifier(table)} WHERE false`), denied);
      await assert.rejects(runtime.query(`TRUNCATE ${target}.${identifier(table)}`), denied);
    }
  });

  test('effective privilege drift, PUBLIC/column/grant-option access and SET ROLE membership are refused without silently repairing them', async () => {
    const changes = [
      [`ALTER ROLE ${identifier(role)} INHERIT`, `ALTER ROLE ${identifier(role)} NOINHERIT`],
      [`GRANT ${identifier(owner)} TO ${identifier(role)}`, `REVOKE ${identifier(owner)} FROM ${identifier(role)}`],
      [`GRANT UPDATE (name) ON ${target}.ingredients TO ${identifier(role)}`, `REVOKE UPDATE (name) ON ${target}.ingredients FROM ${identifier(role)}`],
      [`GRANT UPDATE ON ${target}.ingredients TO PUBLIC`, `REVOKE UPDATE ON ${target}.ingredients FROM PUBLIC`],
      [`GRANT SELECT ON ${target}.ingredients TO ${identifier(role)} WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR SELECT ON ${target}.ingredients FROM ${identifier(role)}`]
    ];
    const adminDb = createPostgresPool(urlFor(new URL(original).username, new URL(original).password));
    try {
      for (const [change, undo] of changes) {
        await adminDb.query(change);
        try { await assert.rejects(configurePostgresRuntimePermissions(migration, schema, role, true), unsafe); }
        finally { await adminDb.query(undo); }
        assert.equal((await configurePostgresRuntimePermissions(migration, schema, role)).action, 'verified');
      }
      for (const flag of ['SUPERUSER','CREATEDB','CREATEROLE','REPLICATION','BYPASSRLS']) {
        await adminDb.query(`ALTER ROLE ${identifier(role)} ${flag}`);
        try { await assert.rejects(configurePostgresRuntimePermissions(migration, schema, role, true), unsafe); }
        finally { await adminDb.query(`ALTER ROLE ${identifier(role)} NO${flag}`); }
      }
    } finally { await adminDb.end(); }
  });

  test('a failure after real partial GRANTs rolls back all permissions, including schema access', async () => {
    let grants = 0;
    // Only inject a transport failure; every preceding SQL operation uses the
    // actual server/client/transaction, not a fake permission catalog.
    const faulted = new Proxy(migration, { get(pool, key) {
      if (key === 'connect') return async () => {
        const client = await pool.connect();
        return new Proxy(client, { get(realClient, method) {
          if (method === 'query') return async (sql: string, values?: unknown[]) => {
            if (sql.startsWith('GRANT ') && ++grants === 3) throw new Error('private-transport-fixture');
            return realClient.query(sql, values);
          };
          const value = Reflect.get(realClient, method); return typeof value === 'function' ? value.bind(realClient) : value;
        } });
      };
      const value = Reflect.get(pool, key); return typeof value === 'function' ? value.bind(pool) : value;
    } });
    await assert.rejects(configurePostgresRuntimePermissions(faulted, schema, fresh, true), (error: Error) => unsafe(error) && !error.message.includes('private-transport-fixture'));
    assert.equal(grants, 3);
    assert.equal((await migration.query('SELECT has_schema_privilege($1,$2,\'USAGE\') AS allowed', [fresh, schema])).rows[0].allowed, false);
    assert.equal((await migration.query(`SELECT has_table_privilege($1,'${schema}.migrations','SELECT') AS allowed`, [fresh])).rows[0].allowed, false);
  });

  test('unsafe database defaults and an unreviewed new table fail before granting anything to a fresh runtime role', async () => {
    await admin.query(`GRANT TEMPORARY ON DATABASE ${identifier(database)} TO PUBLIC`);
    try { await assert.rejects(configurePostgresRuntimePermissions(migration, schema, fresh, true), unsafe); }
    finally { await admin.query(`REVOKE TEMPORARY ON DATABASE ${identifier(database)} FROM PUBLIC`); }
    await migration.query(`CREATE TABLE ${target}.unreviewed_table(id integer)`);
    await assert.rejects(configurePostgresRuntimePermissions(migration, schema, fresh, true), unsafe);
    assert.equal((await migration.query('SELECT has_schema_privilege($1,$2,\'USAGE\') AS allowed', [fresh, schema])).rows[0].allowed, false);
    assert.equal((await migration.query(`SELECT has_table_privilege($1,'${schema}.ingredients','SELECT') AS allowed`, [fresh])).rows[0].allowed, false);
    // Retain the drifted fixture for evidence, never erase its table to turn it green.
  });
});
