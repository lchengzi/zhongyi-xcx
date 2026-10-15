import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { capturePostgresBackup, decryptBackup, encryptBackup, restorePostgresBackup, writeBackupFile, readBackupFile } from '../server/postgres-backup.js';
import { capturePhotoResources, decryptPhotoResources, encryptPhotoResources, restorePhotoResources, writeNewPhotoFile } from '../server/photo-resource-backup.js';
import { PhotoPublicationJournal } from '../server/photo-publication-journal.js';
import { PhotoPublicationService } from '../server/photo-publication-service.js';
import { parsePublicPhotoGallery, parsePublicPhotoBatch } from '../../packages/catalog-core/src/photos.js';
import type { ProfessionalKind, SessionInfo } from '../shared/contracts.js';
import type { RepositoryBundle, WriteAuthority } from '../server/stores.js';
import { migrationFixture, fixturePassword, fileDigest } from './migration-fixture.js';
import { createSyntheticPublicationAssets } from './photo-publication-assets-fixture.js';
import { noteInput } from './photo-note-fixture.js';
import { submissionInput } from './photo-submission-fixture.js';
import { rightsInput, rightsCode } from './photo-rights-fixture.js';
import { credentialInput } from './professional-fixture.js';
import { assertRecoveryData } from './backup-fixture.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller required; no SQLite substitute or skipped image proof');
const schemaName = () => `photo_publish_${randomUUID().replaceAll('-', '')}`;
const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function authority(stores: RepositoryBundle, username: string): Promise<WriteAuthority> {
  const login = await stores.auth.login(username, fixturePassword, 'ENGINEERING_PHOTO_PUBLICATION');
  return { account: login.info.user, token: login.token };
}
async function fixture() {
  const source = await migrationFixture(undefined, false), sourceDigest = fileDigest(source.filename), pool = createPostgresPool(connection!), schema = schemaName();
  let stores: RepositoryBundle | undefined;
  const close = async () => { try { await stores?.close(); stores = undefined; } finally { await pool.end(); assert.equal(fileDigest(source.filename), sourceDigest); source.dispose(); } };
  try {
    await migrateSqliteToPostgres(pool, schema, source.read(), source.seed); stores = await openPostgresStore(connection!, schema, source.seed);
    const assets = createSyntheticPublicationAssets(), { photo, derivatives, journal } = assets;
    const admin = await authority(stores, 'migration-admin'), editor = await authority(stores, 'migration-editor'), rights = await authority(stores, 'migration-reviewer');
    await stores.publication.control({ action: 'resume', expectedVersion: 0, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '仅工程测试，不是实际发布。', confirmed: true }, admin.account, admin.token);
    const note = await stores.photoNotes.save(photo, noteInput(0, photo), editor), submission = await stores.photoSubmissions.submit(photo, submissionInput(note), editor);
    await stores.photoRights.review(photo, { ...rightsInput(submission), evidenceKind: 'manual-verification' }, rights);
    const people = new Map<ProfessionalKind, WriteAuthority>();
    // These manual-labelled fields exercise policy branches only; this fixture
    // cannot attest a real person's qualifications or approve real food photos.
    for (const [profession, username] of [['tcm_physician', 'synthetic-photo-physician'], ['pharmacist', 'synthetic-photo-pharmacist']] as const) {
      const person = await stores.auth.createUser(username, fixturePassword, 'reviewer', 'ENGINEERING_SYNTHETIC_ONLY');
      await stores.workflow.saveQualification(person.id, { ...credentialInput(profession), evidenceKind: 'manual-verification' }, 0, admin.account, admin.token);
      const actor = await authority(stores, username), qualification = (await stores.workflow.qualificationHistory(person.id))[0]; assert(qualification);
      people.set(profession, actor); const detail = await stores.photoProfessional.detail(photo);
      assert(detail.submissionDigest && detail.noteDigest && detail.rightsDigest);
      await stores.photoProfessional.review(photo, {
        bindingDigest: detail.bindingDigest, expectedVersion: detail.version, expectedSubmissionVersion: detail.submissionVersion, submissionDigest: detail.submissionDigest,
        expectedNoteVersion: detail.noteVersion, noteDigest: detail.noteDigest, expectedRightsVersion: detail.rightsVersion, rightsDigest: detail.rightsDigest,
        profession, expectedQualificationRevision: qualification.revision, qualificationDigest: qualification.digest, decision: 'approve',
        identity: 'matches', part: 'matches', processing: 'matches', evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '工程模拟，非真人专业签审。', verificationConfirmed: true
      }, actor);
    }
    const input = { expectedVersion: 0, action: 'publish', selections: [{ candidateId: photo.id, derivativeDigest: assets.metadata.digest, professionalVersion: 2, rightsVersion: 1, submissionVersion: 1 }],
      displayReviewConfirmed: true, visualPrivacyConfirmed: true, reason: 'ENGINEERING_SYNTHETIC_ONLY' };
    return { source, sourceDigest, pool, schema, assets, admin, editor, rights, people, input,
      get stores() { if (!stores) throw new Error('Fixture pools closed'); return stores; },
      service: () => { if (!stores) throw new Error('Fixture pools closed'); return new PhotoPublicationService(stores, derivatives, journal, true); },
      async reopen() { await stores?.close(); stores = undefined; stores = await openPostgresStore(connection!, schema, source.seed); }, close };
  } catch (error) { await close(); throw error; }
}

test('real PostgreSQL image HTTP validates authority, serves strict batch/JPEG, withdraws and reopens without exposing editorial records', async () => {
  const f = await fixture(), origin = 'https://postgres-photos.example.test', { assets } = f;
  const server = createApp(f.stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, {
    privatePhotos: assets.originals, photoPublication: { derivatives: assets.derivatives, journal: assets.journal, enabled: true }
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, privatePath = `/api/v1/editorial/photo-publications/${assets.photo.ingredientId}`, publicPath = `/api/v1/public/photos/${assets.photo.ingredientId}`;
  try {
    assert.equal((await fetch(base + privatePath)).status, 401);
    const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.admin.account.username, password: fixturePassword }) });
    assert.equal(login.status, 200); const session: SessionInfo = await login.json(), cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
    assert.equal((await fetch(base + privatePath, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'invalid' }, body: JSON.stringify(f.input) })).status, 403);
    assert.equal((await fetch(base + privatePath, { method: 'POST', headers, body: JSON.stringify({ ...f.input, actorId: f.admin.account.id }) })).status, 400);
    await assert.rejects(f.service().publish(assets.photo.ingredientId, f.input, f.editor), rightsCode('forbidden'));
    const published = await fetch(base + privatePath, { method: 'POST', headers, body: JSON.stringify(f.input) }); assert.equal(published.status, 201);
    const seed = await f.stores.catalog.publicSnapshot(), binding = { ingredientId: assets.photo.ingredientId, name: assets.photo.name, baseReleaseId: seed.releaseId };
    // Public names bind the catalog entry, not the candidate's private caption.
    binding.name = seed.ingredients.find(item => item.id === binding.ingredientId)!.name;
    const galleryResponse = await fetch(base + publicPath); assert.equal(galleryResponse.status, 200); assert.equal(galleryResponse.headers.get('Cache-Control'), 'no-store');
    const galleryValue: unknown = await galleryResponse.json(), gallery = parsePublicPhotoGallery(galleryValue, binding, Date.now());
    const batchResponse = await fetch(base + '/api/v1/public/photos/batch/' + binding.ingredientId); assert.equal(batchResponse.status, 200);
    assert.equal(parsePublicPhotoBatch(await batchResponse.json(), [binding], Date.now()).length, 1);
    const imagePath = `${publicPath}/${gallery.version}/${gallery.photos[0]!.sha256.slice(7)}.jpg`, image = await fetch(base + imagePath);
    assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), assets.display);
    for (const value of ['localPath', 'password_hash', f.admin.account.username, 'qualificationDigest', assets.root]) assert(!JSON.stringify(galleryValue).includes(value));
    const withdrawn = await fetch(base + privatePath, { method: 'POST', headers, body: JSON.stringify({ ...f.input, expectedVersion: 1, action: 'withdraw', selections: [] }) }); assert.equal(withdrawn.status, 201);
    assert.equal((await fetch(base + publicPath)).status, 410); assert.equal((await fetch(base + imagePath)).status, 410);
    const emptyBatch = await fetch(base + '/api/v1/public/photos/batch/' + binding.ingredientId); assert.equal(emptyBatch.status, 200);
    assert.equal(parsePublicPhotoBatch(await emptyBatch.json(), [binding], Date.now()).length, 0);
    const history = new PhotoPublicationJournal(assets.journal.root).history(binding.ingredientId); assert.deepEqual(history.map(item => item.action), ['withdraw', 'publish']);
    assert.equal((await f.stores.photoProfessional.detail(assets.photo)).version, 2);
  } finally { const closed = once(server, 'close'); server.close(); server.closeIdleConnections(); await closed; await f.close(); }
});

test('real PostgreSQL photo publication CAS, pool reconstruction and new control epochs preserve explicit re-publication', async () => {
  const f = await fixture(), other = await openPostgresStore(connection!, f.schema, f.source.seed), { assets } = f;
  try {
    const one = f.service(), two = new PhotoPublicationService(other, assets.derivatives, new PhotoPublicationJournal(assets.journal.root), true);
    const results = await Promise.allSettled([one.publish(assets.photo.ingredientId, f.input, f.admin), two.publish(assets.photo.ingredientId, f.input, f.admin)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(assets.journal.history(assets.photo.ingredientId).length, 1);
    const rejected = results.find(item => item.status === 'rejected'); assert(rejected?.status === 'rejected'); assert(rightsCode('photo_publication_conflict')(rejected.reason));
    await f.reopen(); assert.equal((await f.service().gallery(assets.photo.ingredientId)).version, 1);
    const control = (await f.stores.publication.controlHistory())[0]; assert(control);
    await f.stores.publication.control({ action: 'freeze', expectedVersion: control.version, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '测试冻结。', confirmed: true }, f.admin.account, f.admin.token);
    await f.stores.publication.control({ action: 'resume', expectedVersion: control.version + 1, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '测试恢复，不自动发布。', confirmed: true }, f.admin.account, f.admin.token);
    await assert.rejects(f.service().gallery(assets.photo.ingredientId), rightsCode('photo_unavailable'));
    await f.service().publish(assets.photo.ingredientId, { ...f.input, expectedVersion: 1 }, f.admin);
    assert.equal((await f.service().gallery(assets.photo.ingredientId)).version, 2);
    const physician = f.people.get('tcm_physician'); assert(physician);
    const qualification = (await f.stores.workflow.qualificationHistory(physician.account.id))[0]; assert(qualification);
    await f.stores.workflow.saveQualification(physician.account.id, { ...credentialInput('tcm_physician'), evidenceKind: 'manual-verification', status: 'revoked' }, qualification.revision, f.admin.account, f.admin.token);
    await assert.rejects(f.service().gallery(assets.photo.ingredientId), rightsCode('photo_unavailable'));
  } finally { await other.close(); await f.close(); }
});

test('real PostgreSQL encrypted SQL plus file recovery revokes old sessions and never revives a later-withdrawn image', async () => {
  const f = await fixture(), { assets } = f, sqlKey = randomBytes(32), photoKey = randomBytes(32), targetSchema = schemaName();
  let restoredStores: RepositoryBundle | undefined;
  try {
    await f.service().publish(assets.photo.ingredientId, f.input, f.admin);
    // Quiescent isolated schema and files: no concurrent writer. This is a
    // verified paired restore, not an atomic cross-SQL/filesystem transaction.
    const sqlBackup = await capturePostgresBackup(f.pool, f.schema, f.source.seed), sqlArchive = resolve(assets.root, 'database.zfbackup');
    writeBackupFile(sqlArchive, encryptBackup(sqlBackup, sqlKey)); const databaseArchiveSha256 = sha(readFileSync(sqlArchive));
    const files = capturePhotoResources({ originalsRoot: resolve(assets.root, 'originals'), manifest: resolve(assets.root, 'originals/manifest.json'),
      derivativesRoot: assets.derivatives.root, journalRoot: assets.journal.root, databaseArchiveSha256 });
    const photoArchive = resolve(assets.root, 'photos.encrypted.json'), photoArchiveBytes = encryptPhotoResources(files, photoKey);
    writeNewPhotoFile(photoArchive, photoArchiveBytes);
    await f.service().publish(assets.photo.ingredientId, { ...f.input, expectedVersion: 1, action: 'withdraw', selections: [] }, f.admin);
    assert.equal(assets.journal.history(assets.photo.ingredientId)[0]!.action, 'withdraw');
    await restorePostgresBackup(f.pool, targetSchema, decryptBackup(readBackupFile(sqlArchive), sqlKey, f.source.seed), f.source.seed);
    assertRecoveryData(sqlBackup, await capturePostgresBackup(f.pool, targetSchema, f.source.seed));
    const parent = resolve(assets.root, 'recovery'); mkdirSync(parent);
    const restored = restorePhotoResources(decryptPhotoResources(readFileSync(photoArchive), photoKey), parent, databaseArchiveSha256);
    assert.equal(restored.publicationEnabled, false); assert.deepEqual(restored.originals.asset(assets.photo.id), assets.original);
    assert.deepEqual(restored.derivatives.asset(assets.photo.id), assets.display);
    restoredStores = await openPostgresStore(connection!, targetSchema, f.source.seed);
    assert.equal(await restoredStores.auth.session(f.admin.token), undefined);
    assert.equal((await restoredStores.photoProfessional.detail(assets.photo)).version, 2);
    const recovered = new PhotoPublicationService(restoredStores, restored.derivatives, restored.journal, true);
    assert.equal((await recovered.history(assets.photo.ingredientId)).recoveryRequired, true);
    await assert.rejects(recovered.gallery(assets.photo.ingredientId), rightsCode('photo_unavailable'));
    await assert.rejects(recovered.publish(assets.photo.ingredientId, { ...f.input, expectedVersion: 1 }, f.admin), rightsCode('unauthorized'));
    const admin = await authority(restoredStores, f.admin.account.username), control = (await restoredStores.publication.controlHistory())[0]; assert(control);
    assert.equal(control.action, 'freeze');
    if (Date.now() <= Date.parse(restored.recovery.restoredAt)) await new Promise(resolve => setTimeout(resolve, 2));
    await restoredStores.publication.control({ action: 'freeze', expectedVersion: control.version, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '仅隔离恢复核对演练。', confirmed: true }, admin.account, admin.token);
    await restoredStores.publication.control({ action: 'resume', expectedVersion: control.version + 1, evidenceReference: 'ENGINEERING_SYNTHETIC_ONLY', comment: '明确恢复，不自动重新发布。', confirmed: true }, admin.account, admin.token);
    await assert.rejects(recovered.gallery(assets.photo.ingredientId), rightsCode('photo_unavailable'));
    await recovered.publish(assets.photo.ingredientId, { ...f.input, expectedVersion: 1 }, admin); assert.equal((await recovered.gallery(assets.photo.ingredientId)).version, 2);
    assert.equal(assets.journal.history(assets.photo.ingredientId)[0]!.action, 'withdraw'); assert.equal(sha(readFileSync(sqlArchive)), databaseArchiveSha256);
    assert.deepEqual(readFileSync(photoArchive), photoArchiveBytes);
    writeFileSync(resolve(assets.root, 'recovery-report.json'), JSON.stringify({ schemaVersion: 'photo-postgres-recovery-evidence.1', passed: true,
      finishedAt: new Date().toISOString(), engine: 'real-postgresql', databaseRestored: true, encryptedSqlArchiveVerified: true, databaseArchiveSha256,
      photoArchiveDigest: files.digest, originalAndDisplayBytesVerified: true, oldSessionsRejected: true, oldPublishedHeadDidNotRevive: true,
      sourceWithdrawalPreserved: true, explicitRecoveredVersion: 2, productionDeploymentVerified: false, crossResourceAtomicSnapshot: false,
      syntheticOnly: true, testKeysPersisted: false }, null, 2), { flag: 'wx' });
    console.log(`PostgreSQL photo paired recovery evidence: ${assets.root}`);
  } finally { sqlKey.fill(0); photoKey.fill(0); await restoredStores?.close(); await f.close(); }
});

