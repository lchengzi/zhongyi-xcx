import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepositoryBundle } from '../server/stores.js';
import type { PhotoNoteStore } from '../server/photo-note-service.js';
import { photoBindingDigest } from '../server/photo-note-values.js';
import { parsePrivatePhoto } from '../shared/private-photos.js';
import { fixturePassword } from './migration-fixture.js';
import type { PhotoNoteInput } from '../shared/photo-notes.js';

// Metadata-only engineering fixture. No real image or professional approval.
export const notePhoto = () => parsePrivatePhoto({ id: 'fixture-photo-note', ingredientId: 'huang-qi', name: '工程模拟候选，非食材照片',
  sourcePage: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', sourceRevision: '1', author: 'Test fixture', declaredLicense: 'CC0-1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', observation: '仅测试，不作食材鉴定。', concerns: ['测试材料不可公开。'],
  sha256: `sha256:${'0'.repeat(64)}`, bytes: 17, width: 1, height: 1, identityReview: 'pending', processingReview: 'pending', rightsReview: 'pending',
  professionalReview: 'pending', originalMetadataRetained: true, publicationEligible: false });
export const noteInput = (version = 0, photo = notePhoto()): PhotoNoteInput => ({ bindingDigest: photoBindingDigest(photo), expectedVersion: version,
  category: 'identity', text: '工程模拟：需补充身份核对依据。', evidenceReference: 'fixture:identity-observation-1' });
type Backend = { auth: RepositoryBundle['auth']; one: PhotoNoteStore; two: PhotoNoteStore; close(): void | Promise<void> };
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
export function registerPhotoNoteTests(engine: string, backend: () => Promise<Backend>): void {
  test(`${engine}: immutable photo notes bind source/file metadata and retain old-source history without granting approval`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-admin', fixturePassword, '127.0.0.1'); const authority = { account: login.info.user, token: login.token };
      const photo = notePhoto(); assert.equal((await f.one.detail(photo)).version, 0);
      const saved = await f.one.save(photo, noteInput(), authority);
      assert.equal(saved.version, 1); assert.equal(saved.actorName, authority.account.username); assert.equal(saved.candidate.publicationEligible, false);
      photo.concerns.push('detached caller mutation'); assert.deepEqual((await f.two.detail(notePhoto())).history, [saved]);
      const changed = { ...notePhoto(), sourceRevision: '2', sha256: `sha256:${'1'.repeat(64)}` };
      await assert.rejects(f.two.save(changed, noteInput(1), authority), code('photo_note_conflict'));
      const second = await f.two.save(changed, noteInput(1, changed), authority);
      assert.deepEqual((await f.one.detail(changed)).history, [second, saved]); assert.notEqual(second.bindingDigest, saved.bindingDigest);
      await assert.rejects(f.one.detail({ ...changed, ingredientId: 'jiang' }), code('photo_identity_changed'));
      await assert.rejects(f.one.detail({ ...changed, ingredientId: 'not-an-ingredient' }), code('ingredient_not_found'));
    } finally { await f.close(); }
  });
  test(`${engine}: session/role/actor checks and strict payload fail closed without adding history`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-editor', fixturePassword, '127.0.0.1'); const authority = { account: login.info.user, token: login.token };
      await assert.rejects(f.one.save(notePhoto(), { ...noteInput(), approved: true }, authority), code('invalid_photo_note'));
      await assert.rejects(f.one.save(notePhoto(), noteInput(), { ...authority, account: { ...authority.account, username: 'forged' } }), code('forbidden'));
      const reviewer = await f.auth.login('migration-reviewer', fixturePassword, '127.0.0.1');
      await assert.rejects(f.one.save(notePhoto(), noteInput(), { account: reviewer.info.user, token: reviewer.token }), code('forbidden'));
      await f.auth.logout(login.token, authority.account.username);
      await assert.rejects(f.one.save(notePhoto(), noteInput(), authority), code('unauthorized'));
      assert.equal((await f.one.detail(notePhoto())).version, 0);
    } finally { await f.close(); }
  });
  test(`${engine}: concurrent expected-version writers serialize; only one revision is appended`, async () => {
    const f = await backend();
    try {
      const login = await f.auth.login('migration-admin', fixturePassword, '127.0.0.1'); const authority = { account: login.info.user, token: login.token };
      const results = await Promise.allSettled([f.one.save(notePhoto(), noteInput(), authority), f.two.save(notePhoto(), noteInput(), authority)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const failure = results.find(r => r.status === 'rejected'); assert(failure?.status === 'rejected'); assert(code('photo_note_conflict')(failure.reason));
      assert.equal((await f.one.detail(notePhoto())).history.length, 1);
    } finally { await f.close(); }
  });
}
