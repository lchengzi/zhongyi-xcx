import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrivatePhotoRegistry } from '../server/private-photos.js';

// Opt-in local evidence only. Historical source statements are not current
// licensing checks, professional determinations, or approval to publish.
export const realPhotoRoot = resolve('../zhongyi/content-private/research-refresh');
export const expandedPhotoManifest = resolve(realPhotoRoot, '2026-10-12-private-preview-expanded.json');
export const rehmanniaPhotoManifest = resolve(realPhotoRoot, '2026-10-12-private-preview-with-rehmannia.json');
function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected historical object');
  return Object.fromEntries(Object.entries(value));
}
function array(value: unknown): unknown[] { assert(Array.isArray(value), 'Expected historical array'); return value; }
function text(value: unknown): string { assert.equal(typeof value, 'string'); assert(typeof value === 'string' && value.length > 0); return value; }
function json(path: string, digest: string): Record<string, unknown> {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256 * 1024);
  const bytes = readFileSync(path); assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'Historical evidence changed');
  const value: unknown = JSON.parse(bytes.toString('utf8')); return object(value);
}
export function loadRealPhotoLibrary(): PrivatePhotoRegistry {
  const inventory = json(resolve(realPhotoRoot, '2026-10-09-photo-review-inventory.json'), 'a7b3787a94dfb0a3b85f5afb387103eb8201cbac89b1657535bb36becdcf5613');
  const metadata = json(resolve(realPhotoRoot, '2026-10-09-existing-photo-metadata.json'), '6535ccec88c0f38ff29960268fb95cb00496ac8e9a597cbbb6938415886da6a7');
  const baseline = json(resolve(realPhotoRoot, '2026-10-12-private-preview.json'), '46d91c15b3096d6643341825bee3e513a33549b0619174bf56110778c6077700');
  assert.equal(inventory.schemaVersion, 'photo-review-inventory.1');
  assert.equal(metadata.schemaVersion, 'existing-photo-metadata.1');
  assert.equal(inventory.publicationEligible, false);
  const records = array(inventory.records).map(object), originals = records.filter(record => record.localState === 'full_original');
  const fallback = array(metadata.existingPhotoObservations).map(object);
  const registry = new PrivatePhotoRegistry(realPhotoRoot, expandedPhotoManifest);
  const candidates = registry.list().items;
  assert.equal(candidates.length, 13); assert.equal(originals.length, 13);
  assert.equal(new Set(candidates.map(item => item.ingredientId)).size, 12);
  assert.equal(candidates.reduce((sum, item) => sum + item.bytes, 0), 33_268_745);
  assert.deepEqual(candidates.map(item => item.id).sort(), originals.map(record => text(record.candidateId)).sort());
  const raw: unknown = JSON.parse(readFileSync(expandedPhotoManifest, 'utf8'));
  const entries = array(object(raw).items).map(object);
  for (const previous of array(baseline.items).map(object)) assert.deepEqual(entries.find(item => item.id === previous.id), previous, 'Existing candidate binding must be retained');
  for (const candidate of candidates) {
    const historical = originals.find(record => record.candidateId === candidate.id); assert(historical);
    const source = object(historical.source), asset = object(historical.localAsset), capture = object(historical.captureEvidence);
    assert.equal(candidate.ingredientId, historical.ingredientId);
    assert.equal(candidate.sourcePage, source.sourcePage); assert.equal(candidate.author, source.author); assert.equal(candidate.licenseUrl, source.licenseUrl);
    const license = candidate.declaredLicense === 'CC0-1.0' ? 'CC0 1.0' : candidate.declaredLicense === 'CC-BY-4.0' ? 'CC BY 4.0' : 'CC BY-SA 4.0';
    assert.equal(license, source.licenseName);
    const manifestEntry = entries.find(item => item.id === candidate.id); assert(manifestEntry);
    assert.equal(`content-private/research-refresh/${text(manifestEntry.localPath)}`, asset.path);
    for (const field of ['sha256', 'bytes', 'width', 'height'] as const) assert.equal(candidate[field], asset[field]);
    assert.equal(asset.originalMetadataRetained, true); assert.equal(asset.publicDerivativeAvailable, false);
    assert.equal(capture.identityReviewState, 'pending'); assert.equal(capture.partProcessingReviewState, 'pending'); assert.equal(capture.rightsReviewState, 'pending'); assert.equal(capture.professionalReviewState, 'pending');
    if (capture.sourceObservation !== undefined) {
      const observation = object(capture.sourceObservation);
      assert.equal(candidate.sourceRevision, observation.pageRevision); assert.equal(candidate.sourcePage, observation.page);
    } else {
      const previous = fallback.find(record => record.candidateId === candidate.id); assert(previous);
      assert.equal(previous.id, capture.previousObservationId); assert.equal(previous.ingredientId, candidate.ingredientId);
      const previousSource = object(previous.source), permanent = new URL(text(previousSource.permanentUrl));
      assert.equal(permanent.origin, 'https://commons.wikimedia.org'); assert.equal(permanent.pathname, '/w/index.php');
      assert.deepEqual([...permanent.searchParams.keys()].sort(), ['oldid', 'title']);
      assert.equal(permanent.searchParams.get('title'), decodeURIComponent(new URL(candidate.sourcePage).pathname.slice('/wiki/'.length)));
      assert.equal(candidate.sourceRevision, permanent.searchParams.get('oldid'));
      assert.equal(previousSource.url, candidate.sourcePage); assert.equal(previousSource.creator, candidate.author); assert.equal(previousSource.licenseUrl, candidate.licenseUrl);
    }
    if (!array(baseline.items).map(object).some(item => item.id === candidate.id)) {
      assert.equal(candidate.observation, `历史非专业目视记录：${text(historical.observation)}`);
      for (const limitation of array(historical.limitations)) assert(candidate.concerns.includes(text(limitation)), 'Do not discard known concerns');
    }
  }
  // No review copy or metadata-only record is silently treated as an original.
  for (const record of records.filter(record => record.localState !== 'full_original')) assert(!candidates.some(item => item.id === record.candidateId));
  return registry;
}

// New acquisition evidence is additive; do not rewrite the historical 13-image
// fixture or turn original availability into identity/processing approval.
export function loadRehmanniaPhotoLibrary(): PrivatePhotoRegistry {
  const baseline = loadRealPhotoLibrary();
  json(expandedPhotoManifest, '1add140a9e2f68c5805a12b3260dbf75ad0245474076e70c6917182c9ef63f52');
  json(resolve(realPhotoRoot, '2026-10-09-rehmannia-processing-pair.json'), 'efc393f3b794dabda290adfd252e91fdaccb0d9b261f8c41c823be461b1cbce1');
  const manifest = json(rehmanniaPhotoManifest, 'c8442953f9d1dda4562ff6b422c990d3e4554f650bea77b3e5d672ba9f585021');
  const acquisition = json(resolve(realPhotoRoot, '2026-10-12-rehmannia-acquisition.json'), '10dca789723ae0b0505368c466a32bfe2f726e1a9f6b666b5c654817ab89066d');
  assert.equal(acquisition.schemaVersion, 'private-photo-acquisition.1');
  for (const key of ['historicalRecordModified', 'sameSpeciesConfirmed', 'sameBatchConfirmed', 'processingDifferenceVerified', 'foodUseApproved', 'historicalGapClosed']) assert.equal(acquisition[key], false);
  assert.equal(acquisition.publicPhotosAdded, 0);
  const registry = new PrivatePhotoRegistry(realPhotoRoot, rehmanniaPhotoManifest), items = registry.list().items;
  assert.equal(items.length, 15); assert.equal(new Set(items.map(item => item.ingredientId)).size, 13);
  assert.equal(items.reduce((sum, item) => sum + item.bytes, 0), 33_507_834);
  for (const previous of baseline.list().items) assert.deepEqual(registry.candidate(previous.id), previous);
  const entries = array(manifest.items).map(object), records = array(acquisition.records).map(object);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => r.candidateId), ['food-form-di-huang-seche-label-v01', 'food-form-di-huang-prepare-label-v01']);
  for (const record of records) {
    const candidate = registry.candidate(text(record.candidateId)); assert(candidate); assert.equal(candidate.ingredientId, 'di-huang');
    const entry = entries.find(e => e.id === candidate.id); assert(entry);
    for (const field of ['sourcePage', 'sourceRevision', 'declaredLicense', 'licenseUrl', 'observation', 'concerns', 'sha256', 'bytes', 'width', 'height', 'identityReview', 'processingReview', 'rightsReview', 'professionalReview', 'originalMetadataRetained', 'publicationEligible'] as const) assert.deepEqual(candidate[field], record[field]);
    assert.equal(candidate.author, record.authorClaim); assert.equal(entry.localPath, record.localPath);
    assert.equal(record.visualReview, 'nonprofessional_original_size_pixels_viewed');
    const bytes = registry.asset(candidate.id); assert(bytes);
    assert.equal(createHash('sha1').update(bytes).digest('hex'), record.sourceSha1);
    assert.equal(candidate.publicationEligible, false);
  }
  return registry;
}
