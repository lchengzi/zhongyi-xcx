import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalogRelease, parseEducation, parseEducationBinding, publicContentOrigin } from '../src/index.js';
import { educationNow, educationBinding, educationFixture } from './education-fixture.js';

test('education wire validation creates an immutable public document bound to trusted local identity', () => {
  const input = educationFixture();
  const result = parseEducation(input, educationBinding, educationNow);
  assert.ok(result.ok);
  assert.ok(Object.isFrozen(result.document));
  assert.ok(Object.isFrozen(result.document.sources));
  assert.ok(Object.isFrozen(result.document.sources[0]));
  const source = input.sources[0]; assert.ok(source);
  source.title = 'caller changed';
  assert.equal(result.document.sources[0]?.title, '工程测试来源');
  assert.equal('professionalReview' in result.document, false);
  assert.equal('safety' in result.document, false);
});

test('education cannot override identity, release, deterministic rules or carry private approval data', () => {
  const input = educationFixture();
  for (const patch of [{ ingredientId: 'shan-yao' }, { name: '山药' }, { baseReleaseId: 'other-release' }]) {
    const result = parseEducation({ ...input, ...patch }, educationBinding, educationNow);
    assert.ok(!result.ok && result.errorCode === 'identity_mismatch');
  }
  for (const value of [{ ...input, rulesVersion: 'forged' }, { ...input, safety: { pregnancy: 'yes' } }, { ...input, reviews: ['private'] },
    { ...input, sources: [{ ...input.sources[0], evidenceReference: 'private' }] }, { ...input, boundary: '适合食用' }, { ...input, scope: 'prescription' }]) {
    assert.equal(parseEducation(value, educationBinding, educationNow).ok, false);
  }
});

test('malformed dates, versions, sparse sources, unsafe links and expired references fail closed', () => {
  const input = educationFixture();
  for (const value of [null, [], {}, { ...input, snapshotVersion: 0 }, { ...input, contentRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, publishedAt: '2099-01-01T00:00:00.000Z' }, { ...input, publishedAt: '2026-02-30T00:00:00.000Z' },
    { ...input, sources: [] }, { ...input, sources: new Array(1) }, { ...input, educationText: 'x'.repeat(6001) },
    ...['http://example.org', 'javascript:alert(1)', 'https://user:password@example.org/', 'https://example.org/\nsecret'].map(url => ({ ...input, sources: [{ ...input.sources[0], url }] }))
  ]) assert.equal(parseEducation(value, educationBinding, educationNow).ok, false);
  const expired = parseEducation({ ...input, sources: [{ ...input.sources[0], validUntil: new Date(educationNow).toISOString() }] }, educationBinding, educationNow);
  assert.ok(!expired.ok && expired.errorCode === 'source_expired');
  assert.equal(parseEducation(input, educationBinding, Number.NaN).ok, false);
});

test('service origin is pinned to one HTTPS origin, never a query, path or embedded credential', () => {
  assert.equal(publicContentOrigin('https://CONTENT.example.test:443'), 'https://content.example.test');
  for (const input of [null, '', 'http://content.example.test', 'https://content.example.test/', 'https://user:secret@content.example.test', 'https://content.example.test?q=x', 'https://content.example.test#x', 'https://-bad.example.test', 'https://bad..example.test', 'https://example.test:8443']) assert.equal(publicContentOrigin(input), null);
  assert.throws(() => parseEducationBinding({ ...educationBinding, profile: 'private' }));
  assert.throws(() => parseEducationBinding({ ...educationBinding, ingredientId: '../private' }));
});

test('bundled release metadata must match local content version and contain no private or remote configuration', () => {
  const value = { protocolVersion: 1, releaseId: 'release-test.1', releaseDigest: `sha256:${'a'.repeat(64)}`, contentVersion: 'test.1' };
  assert.ok(Object.isFrozen(parseCatalogRelease(value, 'test.1')));
  for (const input of [{ ...value, protocolVersion: 2 }, { ...value, contentVersion: 'wrong' }, { ...value, releaseDigest: 'wrong' }, { ...value, releaseId: '../private' }, { ...value, origin: 'https://untrusted.test' }]) assert.equal(parseCatalogRelease(input, 'test.1'), null);
});
