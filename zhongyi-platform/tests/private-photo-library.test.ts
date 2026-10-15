import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRealPhotoLibrary, loadRehmanniaPhotoLibrary, realPhotoRoot, expandedPhotoManifest, rehmanniaPhotoManifest } from './private-photo-library-fixture.js';
import { PrivatePhotoRegistry } from '../server/private-photos.js';

test('opt-in real private library binds all 13 originals to retained historical provenance without granting approval', () => {
  const registry = loadRealPhotoLibrary(), items = registry.list().items;
  registry.assertStaticIsolation(resolve('dist'));
  assert(items.every(item => item.identityReview === 'pending' && item.processingReview === 'pending' && item.rightsReview === 'pending' && item.professionalReview === 'pending' && !item.publicationEligible));
  assert.deepEqual(items.filter(item => item.ingredientId === 'tie-pi-shi-hu').map(item => item.id).sort(), ['food-form-tie-pi-shi-hu-dried-rolls-v01', 'food-form-tie-pi-shi-hu-stems-v01']);
  for (const id of ['gou-qi-zi', 'tian-dong', 'di-huang']) assert(!items.some(item => item.ingredientId === id));
  console.log(JSON.stringify({ scope: 'historical-private-library-integrity-not-approval', originals: items.length, ingredients: 12, bytes: items.reduce((sum, item) => sum + item.bytes, 0), manifestSha256: createHash('sha256').update(readFileSync(expandedPhotoManifest)).digest('hex'), originalBytesModified: false, publicPhotosAdded: 0 }));
});

test('expanded registry returns detached metadata and bytes and preserves the old two-photo registry', () => {
  const registry = loadRealPhotoLibrary(), list = registry.list(), original = registry.asset(list.items[2].id); assert(original);
  list.items[2].concerns.push('only this copy'); original.fill(0);
  assert(!registry.candidate(list.items[2].id)?.concerns.includes('only this copy'));
  assert.notEqual(registry.asset(list.items[2].id)?.[0], 0);
  const baseline = new PrivatePhotoRegistry(realPhotoRoot, resolve(realPhotoRoot, '2026-10-12-private-preview.json'));
  assert.equal(baseline.list().items.length, 2);
  for (const candidate of baseline.list().items) assert.deepEqual(registry.candidate(candidate.id), candidate);
});

test('new Rehmannia originals are source-byte verified and separately bound without replacing historical gaps or reviews', () => {
  const registry = loadRehmanniaPhotoLibrary(), items = registry.list().items;
  registry.assertStaticIsolation(resolve('dist'));
  assert(items.every(item => item.identityReview === 'pending' && item.processingReview === 'pending' && item.rightsReview === 'pending' && item.professionalReview === 'pending' && !item.publicationEligible));
  assert.equal(items.filter(item => item.ingredientId === 'di-huang').length, 2);
  for (const id of ['gou-qi-zi', 'tian-dong']) assert(!items.some(item => item.ingredientId === id));
  console.log(JSON.stringify({ scope: 'new-private-original-acquisition-not-approval', originals: items.length, ingredients: 13, newlyAcquiredOriginals: 2, newBytes: 239089, manifestSha256: createHash('sha256').update(readFileSync(rehmanniaPhotoManifest)).digest('hex'), historicalRecordsModified: false, historicalGapClosed: false, publicPhotosAdded: 0 }));
});
