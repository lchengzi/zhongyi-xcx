import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { preparePhotoDerivative } from '../server/photo-derivative-preparation.js';
import { canvasPhotoTranscoder } from '../photo-processing/canvas.js';
import { PhotoDerivativeRegistry } from '../server/photo-derivative-registry.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';
import { PhotoPublicationJournal } from '../server/photo-publication-journal.js';
import { PhotoPublicationService } from '../server/photo-publication-service.js';
import { capturePhotoResources, decryptPhotoResources, encryptPhotoResources, parsePhotoResourceBackup, restorePhotoResources } from '../server/photo-resource-backup.js';
import { PHOTO_LOCK, PHOTO_RECOVERY, readPhotoRecovery, withPhotoResourceLock } from '../server/photo-resource-guard.js';
import { photoPublicationFiles } from '../server/photo-publication-config.js';
import { ciEnvironment } from '../tools/ci-core.js';
import { createApp } from '../server/app.js';
import { openConfiguredStore } from '../server/store-config.js';
import { migrationFixture, fixturePassword } from './migration-fixture.js';
import { notePhoto, noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput, rightsCode } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { parsePublicPhotoGallery, parsePublicPhotoBatch } from '../../packages/catalog-core/src/photos.js';
import type { ProfessionalKind, SessionInfo } from '../shared/contracts.js';
import type { WriteAuthority } from '../server/stores.js';

// Only synthetic colour blocks and isolated SQL accounts. Manual evidence here
// exercises branches; it never certifies a person or publishes a food candidate.
let browser: Browser, original: Buffer;
before(async () => {
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  const page = await browser.newPage();
  try { original = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 48;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#c08040'; context.fillRect(0, 0, 96, 48);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }), 'base64'); } finally { await page.close(); }
});
after(async () => { await browser?.close(); });

async function fixture(manual = true) {
  const f = await migrationFixture(undefined, false);
  const stores = await openConfiguredStore(f.seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: f.filename });
  const parent = resolve('.local/photo-publication-tests'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(resolve(parent, 'run-'));
  const source = resolve(root, 'originals'), display = resolve(root, 'derivatives'), journalRoot = resolve(root, 'journal');
  for (const directory of [source, display, journalRoot]) mkdirSync(directory);
  const photo = { ...notePhoto(), width: 96, height: 48, bytes: original.length, sha256: `sha256:${createHash('sha256').update(original).digest('hex')}` };
  const manifest = JSON.stringify({ schemaVersion: 'private-photo-preview.1', items: [{ ...photo, localPath: 'original.jpg' }] });
  writeFileSync(resolve(source, 'original.jpg'), original); writeFileSync(resolve(source, 'manifest.json'), manifest);
  const originals = new PrivatePhotoRegistry(source, resolve(source, 'manifest.json'));
  const prepared = await preparePhotoDerivative(photo, original, canvasPhotoTranscoder(browser), browser.version(), new AbortController().signal);
  writeFileSync(resolve(display, prepared.metadata.assetFilename), prepared.bytes);
  writeFileSync(resolve(display, 'bundle.json'), JSON.stringify({ schemaVersion: 'private-photo-derivative-bundle.1', preparedAt: prepared.metadata.preparedAt,
    encoderVersion: browser.version(), originalManifestDigest: createHash('sha256').update(manifest).digest('hex'), publicationEligible: false, items: [prepared.metadata] }));
  const derivatives = new PhotoDerivativeRegistry(display, originals), journal = new PhotoPublicationJournal(journalRoot);
  const service = new PhotoPublicationService(stores, derivatives, journal, true);
  async function login(username: string): Promise<WriteAuthority> {
    const value = await stores.auth.login(username, fixturePassword, username); return { account: value.info.user, token: value.token };
  }
  const admin = await login('migration-admin'), editor = await login('migration-editor'), rights = await login('migration-reviewer');
  await stores.publication.control({ action: 'resume', expectedVersion: 0, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程测试，非公开服务。', confirmed: true }, admin.account, admin.token);
  const note = await stores.photoNotes.save(photo, noteInput(0, photo), editor);
  const submission = await stores.photoSubmissions.submit(photo, submissionInput(note), editor);
  await stores.photoRights.review(photo, { ...rightsInput(submission), evidenceKind: manual ? 'manual-verification' : 'test-fixture' }, rights);
  const people = new Map<ProfessionalKind, WriteAuthority>();
  for (const [profession, username] of [['tcm_physician', 'synthetic-physician'], ['pharmacist', 'synthetic-pharmacist']] as const) {
    const actor = await stores.auth.createUser(username, fixturePassword, 'reviewer', 'ENGINEERING_SYNTHETIC_ONLY');
    await stores.workflow.saveQualification(actor.id, { ...credentialInput(profession), evidenceKind: manual ? 'manual-verification' : 'test-fixture' }, 0, admin.account, admin.token);
    const authority = await login(username); people.set(profession, authority);
    const q = (await stores.workflow.qualificationHistory(actor.id))[0]; assert(q);
    const detail = await stores.photoProfessional.detail(photo);
    assert(detail.submissionDigest && detail.noteDigest && detail.rightsDigest);
    await stores.photoProfessional.review(photo, {
      bindingDigest: detail.bindingDigest, expectedVersion: detail.version, expectedSubmissionVersion: detail.submissionVersion, submissionDigest: detail.submissionDigest,
      expectedNoteVersion: detail.noteVersion, noteDigest: detail.noteDigest, expectedRightsVersion: detail.rightsVersion, rightsDigest: detail.rightsDigest,
      profession, expectedQualificationRevision: q.revision, qualificationDigest: q.digest, decision: 'approve', identity: 'matches', part: 'matches', processing: 'matches',
      evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程模拟，非真人资格或食材鉴定。', verificationConfirmed: true
    }, authority);
  }
  const input = { expectedVersion: 0, action: 'publish', selections: [{ candidateId: photo.id, derivativeDigest: prepared.metadata.digest, professionalVersion: 2, rightsVersion: 1, submissionVersion: 1 }],
    displayReviewConfirmed: true, visualPrivacyConfirmed: true, reason: 'ENGINEERING_SYNTHETIC_ONLY' };
  return { f, stores, root, photo, originals, derivatives, journal, service, prepared, input, admin, editor, rights, people,
    async close() { await stores.close(); f.dispose(); } };
}

test('synthetic photo: authenticated HTTP → immutable journal → actual JPEG → strict mini contract; withdrawal survives restart', async () => {
  const f = await fixture(), origin = 'https://photo-publication.example.test';
  const server = createApp(f.stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, {
    privatePhotos: f.originals, photoPublication: { derivatives: f.derivatives, journal: f.journal, enabled: true }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const adminPath = `/api/v1/editorial/photo-publications/${f.photo.ingredientId}`, publicPath = `/api/v1/public/photos/${f.photo.ingredientId}`;
  try {
    assert.equal((await fetch(base + adminPath)).status, 401);
    const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.admin.account.username, password: fixturePassword }) });
    assert.equal(login.status, 200); const session: SessionInfo = await login.json();
    const headers = { Cookie: login.headers.get('set-cookie')!.split(';')[0], Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
    const displayPath = `/api/v1/private-photo-derivatives/${f.photo.id}`;
    assert.equal((await fetch(base + displayPath)).status, 401);
    assert.equal((await fetch(base + displayPath, { headers })).status, 200);
    assert.equal((await fetch(base + displayPath + '/image', { headers })).status, 200);
    for (const path of [displayPath + '?token=bad', displayPath + '/image?token=bad']) assert.equal((await fetch(base + path, { headers })).status, 400);
    assert.equal((await fetch(base + displayPath, { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await fetch(base + displayPath, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
    assert.equal((await fetch(base + publicPath)).status, 404);
    assert.equal((await fetch(base + adminPath, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'bad' }, body: JSON.stringify(f.input) })).status, 403);
    assert.equal((await fetch(base + adminPath, { method: 'POST', headers, body: JSON.stringify({ ...f.input, approved: true }) })).status, 400);
    const saved = await fetch(base + adminPath, { method: 'POST', headers, body: JSON.stringify(f.input) }); assert.equal(saved.status, 201);
    const read = await fetch(base + publicPath); assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store');
    const binding = { ingredientId: f.photo.ingredientId, name: f.f.seed.ingredients.find(item => item.id === f.photo.ingredientId)!.name, baseReleaseId: f.f.seed.releaseId };
    const gallery = parsePublicPhotoGallery(await read.json(), binding, Date.now()); assert.equal(gallery.photos.length, 1);
    const batchPath = '/api/v1/public/photos/batch/huang-qi,jiang';
    const batchRead = await fetch(base + batchPath); assert.equal(batchRead.status, 200); assert.equal(batchRead.headers.get('cache-control'), 'no-store');
    const batchBindings = [binding, { ingredientId: 'jiang', name: '姜', baseReleaseId: binding.baseReleaseId }];
    assert.deepEqual(parsePublicPhotoBatch(await batchRead.json(), batchBindings, Date.now()), [gallery]);
    assert.equal((await fetch(base + batchPath + '?profile=unwanted')).status, 400);
    assert.equal((await fetch(base + batchPath, { method: 'POST', headers, body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/api/v1/public/photos/batch/huang-qi,huang-qi')).status, 400);
    assert.equal((await fetch(base + '/api/v1/public/photos/batch/absent-ingredient')).status, 404);
    assert.equal((await fetch(base + '/api/v1/public/photos/batch/' + Array(13).fill('huang-qi').join(','))).status, 404);
    assert.equal(gallery.photos[0].sourceUrl, `${f.photo.sourcePage}?oldid=1`);
    const publicJson = JSON.stringify(gallery);
    for (const forbidden of ['candidateId', 'actorId', 'evidenceReference', 'localPath', f.root, 'accountRevision', 'qualificationDigest', 'controlEpoch']) assert(!publicJson.includes(forbidden));
    const assetPath = `${publicPath}/1/${f.prepared.metadata.sha256.slice(7)}.jpg`, image = await fetch(base + assetPath);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg'); assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), f.prepared.bytes);
    for (const path of [publicPath + '?token=unwanted', assetPath + '?v=1']) assert.equal((await fetch(base + path)).status, 400);
    assert.equal((await fetch(base + publicPath, { method: 'HEAD' })).status, 404);
    assert.equal((await fetch(base + '/api/v1/public/photos/private/history')).status, 404);
    const withdrawn = await fetch(base + adminPath, { method: 'POST', headers, body: JSON.stringify({ ...f.input, expectedVersion: 1, action: 'withdraw', selections: [] }) }); assert.equal(withdrawn.status, 201);
    assert.equal((await fetch(base + publicPath)).status, 410); assert.equal((await fetch(base + assetPath)).status, 410);
    assert.equal(parsePublicPhotoBatch(await (await fetch(base + batchPath)).json(), batchBindings, Date.now()).length, 0);
    const restarted = new PhotoPublicationService(f.stores, f.derivatives, new PhotoPublicationJournal(f.journal.root), true);
    await assert.rejects(restarted.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    assert.equal((await restarted.history(f.photo.ingredientId)).items.length, 2);
    await f.stores.publication.control({ action: 'freeze', expectedVersion: 1, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程冻结测试。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(f.service.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 2 }, f.admin), rightsCode('photo_publication_frozen'));
    await f.stores.publication.control({ action: 'resume', expectedVersion: 2, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程恢复测试。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(f.service.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); await f.close(); }
});

test('publication rejects fixture evidence, forged admin, stale selections and disabled publishing', async () => {
  const f = await fixture(false);
  try {
    await assert.rejects(f.service.publish(f.photo.ingredientId, f.input, f.admin), rightsCode('photo_unavailable'));
    await assert.rejects(f.service.publish(f.photo.ingredientId, f.input, f.editor), rightsCode('forbidden'));
    await assert.rejects(f.service.publish(f.photo.ingredientId, f.input, { ...f.admin, account: { ...f.admin.account, revision: 999 } }), rightsCode('forbidden'));
    const disabled = new PhotoPublicationService(f.stores, f.derivatives, f.journal, false);
    await assert.rejects(disabled.publish(f.photo.ingredientId, f.input, f.admin), rightsCode('photo_publication_disabled'));
    assert.equal(f.journal.history(f.photo.ingredientId).length, 0);
    assert.equal(photoPublicationFiles({}), undefined);
    assert.throws(() => photoPublicationFiles({ ENABLE_PHOTO_PUBLICATION: 'yes' }));
    assert.throws(() => photoPublicationFiles({ ENABLE_PHOTO_PUBLICATION: 'true' }));
    assert.throws(() => createApp(f.stores, { mode: 'accounts' }, f.journal.root, { privatePhotos: f.originals, photoPublication: { derivatives: f.derivatives, journal: f.journal, enabled: true } }));
  } finally { await f.close(); }
});

test('one concurrent winner, derivative corruption fails closed, and changed reviewer credentials invalidate public reads', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.publish(f.photo.ingredientId, { ...f.input, selections: [{ ...f.input.selections[0], professionalVersion: 1 }] }, f.admin), rightsCode('photo_unavailable'));
    const results = await Promise.allSettled([f.service.publish(f.photo.ingredientId, f.input, f.admin), f.service.publish(f.photo.ingredientId, f.input, f.admin)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(f.journal.history(f.photo.ingredientId).length, 1);
    const path = resolve(f.derivatives.root, f.prepared.metadata.assetFilename), bytes = readFileSync(path), damaged = Buffer.from(bytes); damaged[damaged.length - 3] ^= 1;
    writeFileSync(path, damaged); await assert.rejects(f.service.gallery(f.photo.ingredientId)); writeFileSync(path, bytes);
    assert.equal((await f.service.gallery(f.photo.ingredientId)).version, 1);
    await f.stores.publication.control({ action: 'freeze', expectedVersion: 1, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程冻结测试。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(f.service.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    await f.stores.publication.control({ action: 'resume', expectedVersion: 2, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程恢复测试。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(f.service.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    await f.service.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 1 }, f.admin);
    assert.equal((await f.service.gallery(f.photo.ingredientId)).version, 2);
    const physician = f.people.get('tcm_physician'); assert(physician);
    await f.stores.workflow.saveQualification(physician.account.id, { ...credentialInput('tcm_physician'), status: 'revoked', evidenceKind: 'manual-verification' }, 1, f.admin.account, f.admin.token);
    await assert.rejects(f.service.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    await assert.rejects(f.service.asset(f.photo.ingredientId, 2, f.prepared.metadata.sha256.slice(7)), rightsCode('photo_unavailable'));
    assert.deepEqual(readFileSync(resolve(f.root, 'originals/original.jpg')), original);
  } finally { await f.close(); }
});

test('journal edits and incomplete next records never fall back to an older publication', async () => {
  const f = await fixture();
  try {
    await f.service.publish(f.photo.ingredientId, f.input, f.admin);
    const path = resolve(f.journal.root, `${f.photo.ingredientId}.1.json`), before = readFileSync(path, 'utf8');
    writeFileSync(path, before.replace('ENGINEERING_SYNTHETIC_ONLY', 'ALTERED_SYNTHETIC_EVIDENCE'));
    assert.throws(() => f.journal.history(f.photo.ingredientId)); writeFileSync(path, before);
    writeFileSync(resolve(f.journal.root, `${f.photo.ingredientId}.2.json`), '{');
    await assert.rejects(f.service.gallery(f.photo.ingredientId));
    await assert.rejects(f.service.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 1 }, f.admin));
  } finally { await f.close(); }
});

test('photo resources encrypt, restore to new roots, bind the SQL archive, and never revive an older published pointer', async () => {
  const f = await fixture(), key = randomBytes(32), wrongKey = randomBytes(32);
  try {
    const published = await f.service.publish(f.photo.ingredientId, f.input, f.admin);
    const databasePath = resolve(f.root, 'database-snapshot.json'), databaseBytes = Buffer.from(JSON.stringify(f.f.read()));
    writeFileSync(databasePath, databaseBytes);
    const databaseArchiveSha256 = `sha256:${createHash('sha256').update(databaseBytes).digest('hex')}`;
    const options = { originalsRoot: resolve(f.root, 'originals'), manifest: resolve(f.root, 'originals/manifest.json'), derivativesRoot: f.derivatives.root, journalRoot: f.journal.root, databaseArchiveSha256 };
    const originalBefore = readFileSync(options.manifest), derivativeBefore = readFileSync(resolve(f.derivatives.root, f.prepared.metadata.assetFilename));
    const backup = capturePhotoResources(options), encrypted = encryptPhotoResources(backup, key);
    assert.deepEqual(decryptPhotoResources(encrypted, key), backup);
    assert(!encrypted.includes(Buffer.from(f.photo.author))); assert(!encrypted.includes(Buffer.from(f.photo.sourcePage)));
    assert.throws(() => decryptPhotoResources(encrypted, wrongKey));
    const envelope = JSON.parse(encrypted.toString('utf8')); envelope.tag = randomBytes(16).toString('base64');
    assert.throws(() => decryptPhotoResources(Buffer.from(JSON.stringify(envelope)), key));
    assert.throws(() => parsePhotoResourceBackup({ ...backup, files: [{ ...backup.files[0], path: '../escaped.jpg' }] }));
    assert.throws(() => restorePhotoResources(backup, f.root, `sha256:${'0'.repeat(64)}`));
    assert.deepEqual(readFileSync(options.manifest), originalBefore); assert.deepEqual(readFileSync(resolve(f.derivatives.root, f.prepared.metadata.assetFilename)), derivativeBefore);
    assert(!existsSync(resolve(f.journal.root, PHOTO_LOCK)));
    await f.service.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 1, action: 'withdraw', selections: [] }, f.admin);
    const withdrawn = capturePhotoResources(options), targetParent = resolve(f.root, 'recoveries'); mkdirSync(targetParent);
    const restored = restorePhotoResources(backup, targetParent, databaseArchiveSha256);
    assert.notEqual(restored.directory, f.root); assert.equal(restored.publicationEnabled, false);
    assert.deepEqual(restored.originals.asset(f.photo.id), original); assert.deepEqual(restored.derivatives.asset(f.photo.id), f.prepared.bytes);
    assert.equal(restored.journal.history(f.photo.ingredientId)[0]!.digest, published.digest);
    assert.equal(f.journal.history(f.photo.ingredientId)[0]!.action, 'withdraw');
    const recoveredService = new PhotoPublicationService(f.stores, restored.derivatives, restored.journal, true);
    assert.equal((await recoveredService.history(f.photo.ingredientId)).recoveryRequired, true);
    await assert.rejects(recoveredService.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    await assert.rejects(recoveredService.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 1 }, f.admin), rightsCode('photo_recovery_required'));
    const quarantineServer = createServer(); quarantineServer.listen(0, '127.0.0.1'); await once(quarantineServer, 'listening');
    const quarantineOrigin = `http://127.0.0.1:${(quarantineServer.address() as AddressInfo).port}`;
    quarantineServer.on('request', createApp(f.stores, { mode: 'accounts', allowedOrigins: [quarantineOrigin] }, resolve('dist'), {
      privatePhotos: restored.originals, photoPublication: { derivatives: restored.derivatives, journal: restored.journal, enabled: true }
    }));
    const recoveryContext = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    try {
      await recoveryContext.route('**/*', route => new URL(route.request().url()).origin === quarantineOrigin ? route.continue() : route.abort('blockedbyclient'));
      const page = await recoveryContext.newPage(); await page.goto(quarantineOrigin);
      await page.getByLabel('用户名', { exact: true }).fill(f.admin.account.username); await page.getByLabel('密码', { exact: true }).fill(fixturePassword);
      await page.getByRole('button', { name: '登录工作台 →', exact: true }).click(); await page.getByRole('button', { name: '图片审阅', exact: true }).click();
      await page.getByLabel('照片候选列表').getByRole('button').filter({ hasText: f.photo.name }).click(); await page.getByRole('tab', { name: '展示与发布', exact: true }).click();
      await expect(page.getByAltText('待确认的展示图')).toBeVisible();
      await expect(page.getByText('图片资源已从备份恢复。请核对数据和撤回记录，再重新冻结、恢复发布；旧图集保持停用，撤回仍可操作。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '发布图片图集', exact: true })).toBeDisabled();
      await page.getByLabel('发布或撤回说明').fill('ENGINEERING_RECOVERY_REVIEW_ONLY');
      await expect(page.getByRole('button', { name: '撤回图片图集', exact: true })).toBeEnabled();
      await page.screenshot({ path: resolve(f.root, 'recovery-ui.png'), fullPage: true });
    } finally { await recoveryContext.close(); await new Promise<void>(done => { quarantineServer.close(() => done()); quarantineServer.closeAllConnections(); }); }
    // A new manual recovery action must occur after the restoration timestamp.
    await new Promise(resolve => setTimeout(resolve, 2));
    await f.stores.publication.control({ action: 'freeze', expectedVersion: 1, evidenceReference: 'ENGINEERING_RESOURCE_RECOVERY', comment: '工程恢复核对。', confirmed: true }, f.admin.account, f.admin.token);
    await f.stores.publication.control({ action: 'resume', expectedVersion: 2, evidenceReference: 'ENGINEERING_RESOURCE_RECOVERY', comment: '工程明确恢复。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(recoveredService.gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    await recoveredService.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 1, reason: 'ENGINEERING_NEW_EXPLICIT_PUBLICATION' }, f.admin);
    assert.equal((await recoveredService.gallery(f.photo.ingredientId)).version, 2);
    const second = restorePhotoResources(withdrawn, targetParent, databaseArchiveSha256);
    assert.equal(second.journal.history(f.photo.ingredientId)[0]!.action, 'withdraw');
    await assert.rejects(new PhotoPublicationService(f.stores, second.derivatives, second.journal, true).gallery(f.photo.ingredientId), rightsCode('photo_unavailable'));
    const malformed = structuredClone(backup); malformed.files[0]!.path = '../escaped.jpg';
    const { digest: _discardedDigest, ...malformedPayload } = malformed;
    malformed.digest = `sha256:${createHash('sha256').update(JSON.stringify(malformedPayload)).digest('hex')}`;
    const directoriesBefore = readdirSync(targetParent).sort();
    assert.throws(() => restorePhotoResources(malformed, targetParent, databaseArchiveSha256));
    assert.deepEqual(readdirSync(targetParent).sort(), directoriesBefore); assert(!existsSync(resolve(f.root, 'escaped.jpg')));

    const archive = resolve(f.root, 'resources.encrypted.json'), exported = resolve(f.root, 'cli-resources.encrypted.json'); writeFileSync(archive, encrypted);
    const env: NodeJS.ProcessEnv = { ...process.env, PHOTO_RESOURCE_BACKUP_KEY: key.toString('base64') }; delete env.PHOTO_RESOURCE_BACKUP_KEY_FILE;
    const cli = (args: string[], selectedEnv = env) => spawnSync(process.execPath, [resolve('build/tools/backup-photo-resources.js'), ...args], { env: selectedEnv, encoding: 'utf8', timeout: 20000, windowsHide: true });
    const verified = cli(['verify', '--input', archive, '--database-backup', databasePath]); assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).databaseIncluded, false); assert(!verified.stdout.includes(key.toString('base64')));
    const badKey = cli(['verify', '--input', archive, '--database-backup', databasePath], { ...env, PHOTO_RESOURCE_BACKUP_KEY: wrongKey.toString('base64') }); assert.equal(badKey.status, 1);
    const restoredCli = cli(['restore', '--input', archive, '--database-backup', databasePath, '--target-parent', targetParent, '--confirm-maintenance']); assert.equal(restoredCli.status, 0, restoredCli.stderr);
    const cliResult: unknown = JSON.parse(restoredCli.stdout); assert(cliResult && typeof cliResult === 'object' && 'publicationEnabled' in cliResult && cliResult.publicationEnabled === false);
    const exportArgs = ['export', '--originals-root', options.originalsRoot, '--manifest', options.manifest, '--derivatives-root', options.derivativesRoot,
      '--journal-root', options.journalRoot, '--database-backup', databasePath, '--output', exported, '--confirm-maintenance'];
    assert.equal(cli(exportArgs.slice(0, -1)).status, 1); assert(!existsSync(exported));
    const exportResult = cli(exportArgs); assert.equal(exportResult.status, 0, exportResult.stderr);
    assert.equal(cli(exportArgs).status, 1, 'existing archive is never overwritten');
    assert.equal(decryptPhotoResources(readFileSync(exported), key).databaseArchiveSha256, databaseArchiveSha256);
    const locked = withPhotoResourceLock(f.journal.root, () => cli([...exportArgs.slice(0, -2), resolve(f.root, 'blocked-backup.json'), '--confirm-maintenance']));
    assert.equal(locked.status, 1); assert(!existsSync(resolve(f.root, 'blocked-backup.json')));
    // Exercise the actual compiled container entrypoint with host paths, not a
    // Docker engine. File-only operations must not need database credentials.
    const operatorDb = resolve(f.root, 'operator-database'), operatorInput = resolve(f.root, 'operator-input'),
      operatorOutput = resolve(f.root, 'operator-output'), operatorTarget = resolve(f.root, 'operator-recovery');
    for (const path of [operatorDb, operatorInput, operatorOutput, operatorTarget]) mkdirSync(path);
    const anchor = resolve(operatorDb, 'database.json'), operatorArchive = resolve(operatorInput, 'resources.json'), operatorExport = resolve(operatorOutput, 'resources.json');
    writeFileSync(anchor, databaseBytes); writeFileSync(operatorArchive, encrypted);
    const operatorKeyFile = resolve(f.root, 'transient-operator-key.txt'); writeFileSync(operatorKeyFile, key.toString('base64'), { flag: 'wx', mode: 0o600 });
    try {
      const fileEnvironment: NodeJS.ProcessEnv = { ...ciEnvironment(process.env, resolve(f.root, 'must-not-open.sqlite')), NODE_ENV: 'production',
        PHOTO_RESOURCE_BACKUP_KEY_FILE: operatorKeyFile, PHOTO_BACKUP_DATABASE_DIRECTORY: operatorDb, PHOTO_BACKUP_INPUT_DIRECTORY: operatorInput };
      const containerCli = (args: string[], selectedEnv = fileEnvironment) => spawnSync(process.execPath, [resolve('build/tools/container-entrypoint.js'), 'photo-backup', ...args],
        { env: selectedEnv, encoding: 'utf8', timeout: 20000, windowsHide: true });
      const verifiedFile = containerCli(['verify', '--input', operatorArchive, '--database-backup', anchor]); assert.equal(verifiedFile.status, 0, verifiedFile.stderr);
      assert.equal(JSON.parse(verifiedFile.stdout).databaseIncluded, false); assert(!verifiedFile.stdout.includes(key.toString('base64')));
      const restoredFile = containerCli(['restore', '--input', operatorArchive, '--database-backup', anchor, '--target-parent', operatorTarget, '--confirm-maintenance'],
        { ...fileEnvironment, PHOTO_BACKUP_RESTORE_DIRECTORY: operatorTarget }); assert.equal(restoredFile.status, 0, restoredFile.stderr);
      const restoredOutput: unknown = JSON.parse(restoredFile.stdout);
      assert(restoredOutput && typeof restoredOutput === 'object' && 'directory' in restoredOutput && typeof restoredOutput.directory === 'string' &&
        'publicationEnabled' in restoredOutput && restoredOutput.publicationEnabled === false);
      assert.equal(resolve(restoredOutput.directory, '..'), operatorTarget);
      const reopenedOriginals = new PrivatePhotoRegistry(resolve(restoredOutput.directory, 'originals'), resolve(restoredOutput.directory, 'originals/manifest.json'));
      const reopenedDerivatives = new PhotoDerivativeRegistry(resolve(restoredOutput.directory, 'derivatives'), reopenedOriginals);
      assert.deepEqual(reopenedOriginals.asset(f.photo.id), original); assert.deepEqual(reopenedDerivatives.asset(f.photo.id), f.prepared.bytes);
      assert(readPhotoRecovery(resolve(restoredOutput.directory, 'journal'))); assert(!existsSync(resolve(f.root, 'must-not-open.sqlite')));
      const exportedFile = containerCli(['export', '--originals-root', options.originalsRoot, '--manifest', options.manifest, '--derivatives-root', options.derivativesRoot,
        '--journal-root', options.journalRoot, '--database-backup', anchor, '--output', operatorExport, '--confirm-maintenance'], {
        ...fileEnvironment, PHOTO_BACKUP_INPUT_DIRECTORY: '', PHOTO_BACKUP_OUTPUT_DIRECTORY: operatorOutput, PHOTO_BACKUP_ORIGINALS_DIRECTORY: options.originalsRoot,
        PHOTO_BACKUP_DERIVATIVES_DIRECTORY: options.derivativesRoot, PHOTO_BACKUP_JOURNAL_DIRECTORY: options.journalRoot
      }); assert.equal(exportedFile.status, 0, exportedFile.stderr);
      const fileBackup = decryptPhotoResources(readFileSync(operatorExport), key);
      assert.equal(fileBackup.databaseArchiveSha256, databaseArchiveSha256);
      assert.equal(fileBackup.files.filter(file => file.path.startsWith('journal/')).length, 2);
      assert.equal(JSON.parse(Buffer.from(fileBackup.files.find(file => file.path.endsWith('.2.json'))!.base64, 'base64').toString('utf8')).action, 'withdraw');
      assert.deepEqual(readFileSync(options.manifest), originalBefore); assert.equal(f.journal.history(f.photo.ingredientId)[0]!.action, 'withdraw');
    } finally {
      assert.equal(realpathSync(operatorKeyFile).toLowerCase(), operatorKeyFile.toLowerCase()); assert(lstatSync(operatorKeyFile).isFile() && !lstatSync(operatorKeyFile).isSymbolicLink());
      assert.equal(readFileSync(operatorKeyFile, 'utf8'), key.toString('base64')); unlinkSync(operatorKeyFile);
    }
    assert(!existsSync(operatorKeyFile));
    writeFileSync(resolve(f.root, 'resource-report.json'), JSON.stringify({ schemaVersion: 'photo-resource-recovery-evidence.1', passed: true,
      finishedAt: new Date().toISOString(), files: backup.files.length, archiveDigest: backup.digest, databaseArchiveSha256,
      restoredDirectories: [restored.directory, second.directory], sourceJournalStillWithdrawn: f.journal.history(f.photo.ingredientId)[0]!.action === 'withdraw',
      explicitRecoveredVersion: (await recoveredService.gallery(f.photo.ingredientId)).version, originalAndDisplayBytesVerified: true,
      encryptedAuthenticationVerified: true, compiledCliVerified: true, compiledContainerFileOperatorVerified: true, dockerEngineVerified: false,
      recoveryUiVerified: true, databaseRestored: false, syntheticOnly: true, testKeyPersisted: false }, null, 2));
    console.log(`Photo resource recovery evidence: ${f.root}`);
  } finally { key.fill(0); wrongKey.fill(0); await f.close(); }
});

test('resource lock protects publication and capture; foreign locks and unknown journal files remain untouched', async () => {
  const f = await fixture();
  try {
    const saved = await f.service.publish(f.photo.ingredientId, f.input, f.admin);
    withPhotoResourceLock(f.journal.root, () => {
      assert.throws(() => new PhotoPublicationJournal(f.journal.root).append(saved), rightsCode('photo_resources_busy'));
    });
    assert(!existsSync(resolve(f.journal.root, PHOTO_LOCK)));
    assert.throws(() => withPhotoResourceLock(f.journal.root, () => { throw new Error('fixture-operation-failed'); }), /fixture-operation-failed/);
    assert(!existsSync(resolve(f.journal.root, PHOTO_LOCK)));
    writeFileSync(resolve(f.journal.root, 'unknown-resource.txt'), 'preserve unknown fixture');
    const before = readdirSync(f.journal.root).sort();
    assert.throws(() => capturePhotoResources({ originalsRoot: resolve(f.root, 'originals'), manifest: resolve(f.root, 'originals/manifest.json'),
      derivativesRoot: f.derivatives.root, journalRoot: f.journal.root, databaseArchiveSha256: `sha256:${'0'.repeat(64)}` }));
    assert.deepEqual(readdirSync(f.journal.root).sort(), before);
    writeFileSync(resolve(f.journal.root, PHOTO_LOCK), 'foreign fixture lock');
    assert.throws(() => withPhotoResourceLock(f.journal.root, () => {}), rightsCode('photo_resources_busy'));
    assert.equal(readFileSync(resolve(f.journal.root, PHOTO_LOCK), 'utf8'), 'foreign fixture lock');
    const replacementRoot = resolve(f.root, 'replacement-lock-test'); mkdirSync(replacementRoot);
    assert.throws(() => withPhotoResourceLock(replacementRoot, () => { writeFileSync(resolve(replacementRoot, PHOTO_LOCK), 'replaced fixture token'); }), /ownership changed/);
    assert.equal(readFileSync(resolve(replacementRoot, PHOTO_LOCK), 'utf8'), 'replaced fixture token');
    const linkRoot = resolve(f.root, 'recovery-link-test'), linkTarget = resolve(f.root, 'empty-link-target'), movedTarget = resolve(f.root, 'moved-empty-link-target');
    mkdirSync(linkRoot); mkdirSync(linkTarget);
    symlinkSync(linkTarget, resolve(linkRoot, PHOTO_RECOVERY), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(realpathSync(linkTarget).toLowerCase(), linkTarget.toLowerCase()); assert(lstatSync(linkTarget).isDirectory() && !lstatSync(linkTarget).isSymbolicLink());
    assert.deepEqual(readdirSync(linkTarget), []); assert(!existsSync(movedTarget)); assert(movedTarget.startsWith(f.root + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')));
    renameSync(linkTarget, movedTarget);
    assert(!existsSync(resolve(linkRoot, PHOTO_RECOVERY))); assert(lstatSync(resolve(linkRoot, PHOTO_RECOVERY)).isSymbolicLink());
    assert.throws(() => readPhotoRecovery(linkRoot), /recovery marker/);
  } finally { await f.close(); }
});

test('actual React display review publishes and withdraws via authenticated API, preserving uncertain inputs and emergency withdrawal', { timeout: 180000 }, async t => {
  const f = await fixture(), server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('request', createApp(f.stores, { mode: 'accounts', allowedOrigins: [origin] }, resolve('dist'), {
    privatePhotos: f.originals, photoPublication: { derivatives: f.derivatives, journal: f.journal, enabled: true }
  }));
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [], errors: string[] = [], checks: string[] = [];
  async function page(username: string, width: number) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }); contexts.push(context); context.setDefaultTimeout(10000);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    const p = await context.newPage(); p.on('pageerror', error => errors.push(error.message));
    await p.goto(origin); await p.getByLabel('用户名', { exact: true }).fill(username); await p.getByLabel('密码', { exact: true }).fill(fixturePassword);
    await p.getByRole('button', { name: '登录工作台 →', exact: true }).click();
    await p.getByRole('button', { name: '图片审阅', exact: true }).click();
    await p.getByLabel('照片候选列表').getByRole('button').filter({ hasText: f.photo.name }).click();
    await p.getByRole('tab', { name: '展示与发布', exact: true }).click();
    await expect(p.getByAltText('待确认的展示图', { exact: true })).toBeVisible();
    return { p, context };
  }
  const send = (p: Page) => p.getByRole('button', { name: '发布图片图集', exact: true });
  const reread = (p: Page) => p.getByRole('button', { name: '重新读取发布资料', exact: true });
  async function confirm(p: Page, reason: string) {
    await p.getByLabel('发布或撤回说明', { exact: true }).fill(reason);
    await p.getByRole('checkbox', { name: '已核对展示图的方向、颜色、细节及说明', exact: true }).check();
    await p.getByRole('checkbox', { name: '已完成画面隐私检查，确认允许公开', exact: true }).check();
  }
  try {
    const { p, context } = await page(f.admin.account.username, 390);
    await t.test('390px actual JPEG/attribution preview and UI publish produce the mini-program gallery', async () => {
      await expect.poll(() => p.getByAltText('待确认的展示图').evaluate(img => img instanceof HTMLImageElement && img.complete && img.naturalWidth === 96)).toBe(true);
      await expect(send(p)).toBeDisabled(); await confirm(p, 'ENGINEERING_UI_PUBLISH');
      await expect(send(p)).toBeEnabled();
      await p.screenshot({ path: resolve(f.root, 'review-390.png'), fullPage: true });
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await send(p).click(); await expect(p.getByLabel('图片发布反馈')).toContainText('已核对到本次操作记录');
      assert.equal(f.journal.history(f.photo.ingredientId)[0].version, 1);
      const gallery = await (await fetch(origin + `/api/v1/public/photos/${f.photo.ingredientId}`)).json();
      assert.equal(parsePublicPhotoGallery(gallery, { ingredientId: f.photo.ingredientId, name: '黄芪', baseReleaseId: f.f.seed.releaseId }, Date.now()).version, 1);
      checks.push('390px actual image + publish');
    });
    await t.test('bad write receipt preserves input, blocks repetition and explicit reread reconciles the one saved operation', async () => {
      let writes = 0;
      await context.route('**/api/v1/editorial/photo-publications/huang-qi', async route => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        writes++; const response = await route.fetch(); assert.equal(response.status(), 201);
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{"unexpected":true}' });
      });
      await confirm(p, 'ENGINEERING_UNKNOWN_RECEIPT'); await send(p).click();
      await expect(p.getByLabel('图片发布反馈')).toContainText('重新读取核对'); await expect(send(p)).toBeDisabled();
      await expect(p.getByLabel('发布或撤回说明')).toHaveValue('ENGINEERING_UNKNOWN_RECEIPT'); assert.equal(writes, 1);
      await context.unroute('**/api/v1/editorial/photo-publications/huang-qi');
      await reread(p).click(); await expect(p.getByLabel('图片发布反馈')).toContainText('已核对到本次操作记录');
      await expect(p.getByLabel('发布或撤回说明')).toHaveValue(''); assert.equal(f.journal.history(f.photo.ingredientId)[0].version, 2);
      checks.push('unknown receipt reconciled without retry');
    });
    await t.test('actual concurrent version conflict requires reread and a separate confirmed new operation', async () => {
      await f.service.publish(f.photo.ingredientId, { ...f.input, expectedVersion: 2, reason: 'OTHER_WINDOW_SYNTHETIC_ONLY' }, f.admin);
      await confirm(p, 'ENGINEERING_STALE_WINDOW'); await send(p).click();
      await expect(p.getByLabel('图片发布反馈')).toContainText('版本已变化'); await expect(send(p)).toBeDisabled();
      await reread(p).click(); await expect(p.getByLabel('图片发布反馈')).toContainText('未查到本次操作');
      await expect(send(p)).toBeDisabled();
      p.once('dialog', dialog => { void dialog.accept(); }); await p.getByRole('button', { name: '确认发起新的操作', exact: true }).click();
      await confirm(p, 'ENGINEERING_NEW_OPERATION'); await send(p).click();
      await expect(p.getByLabel('图片发布反馈')).toContainText('已核对到本次操作记录'); assert.equal(f.journal.history(f.photo.ingredientId)[0].version, 4);
      checks.push('real CAS conflict + explicit new operation');
    });
    await t.test('hidden page drops preview and confirmation, and an unreadable display file does not prevent withdrawal', async () => {
      await p.getByLabel('发布或撤回说明').fill('ENGINEERING_WITHDRAW');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(p.getByAltText('待确认的展示图')).toHaveCount(0);
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
      await expect(p.getByLabel('发布或撤回说明')).toHaveValue('ENGINEERING_WITHDRAW');
      await context.route(`**/api/v1/private-photo-derivatives/${f.photo.id}/image`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
      await reread(p).click(); await expect(p.getByLabel('图片发布反馈')).toContainText('仍可撤回');
      const withdraw = p.getByRole('button', { name: '撤回图片图集', exact: true }); await expect(withdraw).toBeEnabled();
      p.once('dialog', dialog => { void dialog.accept(); }); await withdraw.click();
      await expect(p.getByLabel('图片发布状态')).toContainText('撤回 #5');
      assert.equal((await fetch(origin + `/api/v1/public/photos/${f.photo.ingredientId}`)).status, 410);
      assert.equal(f.journal.history(f.photo.ingredientId)[0].action, 'withdraw'); checks.push('hide + failed image + emergency withdrawal');
    });
    await t.test('editor can inspect a verified display preview but cannot publish or withdraw', async () => {
      const { p: editor } = await page(f.editor.account.username, 1200);
      await expect(editor.getByText('当前账号可查阅展示图，发布和撤回由管理员操作。', { exact: true })).toBeVisible();
      await expect(send(editor)).toHaveCount(0);
      await editor.screenshot({ path: resolve(f.root, 'review-1200.png'), fullPage: true });
      checks.push('editor read-only actual preview');
    });
    await t.test('revoked rights keep the actual preview readable while disabling all publication confirmations', async () => {
      const submission = (await f.stores.photoSubmissions.detail(f.photo)).history[0]; assert(submission);
      await f.stores.photoRights.review(f.photo, { ...rightsInput(submission, 1), decision: 'revoke', evidenceKind: 'manual-verification' }, f.rights);
      await context.unroute(`**/api/v1/private-photo-derivatives/${f.photo.id}/image`);
      await reread(p).click(); await expect(p.getByAltText('待确认的展示图')).toBeVisible();
      await expect(p.getByRole('checkbox', { name: '已核对展示图的方向、颜色、细节及说明', exact: true })).toBeDisabled();
      await expect(send(p)).toBeDisabled(); checks.push('rights revoked + preview remains private');
    });
    writeFileSync(resolve(f.root, 'browser-report.json'), JSON.stringify({ schemaVersion: 'photo-publication-browser.1', finishedAt: new Date().toISOString(),
      passed: checks.length === 6 && errors.length === 0, expectedChecks: 6, checks, pageErrors: errors, syntheticOnly: true, productionPublished: false }, null, 2));
    assert.deepEqual(errors, []); assert.equal(checks.length, 6);
    console.log(`Photo publication browser evidence: ${f.root}`);
  } finally { for (const context of contexts) await context.close(); await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); await f.close(); }
});
