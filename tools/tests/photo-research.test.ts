import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import { parsePhotoResearch } from '../research/photo-leads';
import { syntheticPhotoResearch } from './photo-research.fixture';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (): unknown => syntheticPhotoResearch();
const rejectsInvalid = (run: () => unknown) => assert.throws(run, /Invalid private photo research record/);
test('synthetic research contract keeps pending flags and fixed baseline bindings without reading private files', () => {
  const batch = parsePhotoResearch(read());
  assert.equal(batch.leads.length, 4); assert.equal(batch.rightsAddenda[0]?.affectedIngredientIds.length, 3);
  assert.equal(batch.checkedAt, '2000-01-01'); assert.equal(batch.publicationEligible, false);
  assert(batch.leads.every(lead => lead.source.publisher === 'ENGINEERING_FIXTURE_NOT_REAL_RESEARCH'));
  assert(batch.leads.every(lead => lead.rights.permissionObtained === false && lead.media.localAsset === null));
});
test('private record cannot claim publication, completed visual review, local files or acquired permission', () => {
  const mutations = [
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, publicationEligible: true }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, runtimePlacements: ['detail'] }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, doesNotCloseGaps: false }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, leads: [{ ...value.leads[0], publicationEligible: true }, ...value.leads.slice(1)] }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, leads: [{ ...value.leads[0], media: { ...value.leads[0]?.media, visualReviewState: 'approved' } }, ...value.leads.slice(1)] }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, leads: [{ ...value.leads[0], media: { ...value.leads[0]?.media, localAsset: 'downloaded.jpg' } }, ...value.leads.slice(1)] }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, leads: [{ ...value.leads[0], rights: { ...value.leads[0]?.rights, permissionObtained: true } }, ...value.leads.slice(1)] }),
    (value: ReturnType<typeof parsePhotoResearch>) => ({ ...value, leads: [{ ...value.leads[0], verificationState: 'approved' }, ...value.leads.slice(1)] })
  ];
  for (const mutate of mutations) rejectsInvalid(() => parsePhotoResearch(mutate(parsePhotoResearch(read()))));
});
test('source and license host relationships, fixed revision titles and media URLs are enforced', () => {
  for (const bad of ['http://upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org/a.jpg?token=secret', 'https://user:secret@upload.wikimedia.org/a.jpg',
    'https://127.0.0.1/a.jpg', 'https://upload.wikimedia.org.attacker.test/a.jpg', 'https://herbaltcm.sn.polyu.edu.hk/a.jpg']) {
    const value = parsePhotoResearch(read()); value.leads[0]!.media.links = [bad]; rejectsInvalid(() => parsePhotoResearch(value));
  }
  const wrongLicense = parsePhotoResearch(read()); wrongLicense.leads[1]!.rights.licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/'; rejectsInvalid(() => parsePhotoResearch(wrongLicense));
  const wrongRevision = parsePhotoResearch(read()); wrongRevision.leads[0]!.source.revisionUrl = 'https://commons.wikimedia.org/w/index.php?title=File:Other.jpg&oldid=1111466910'; rejectsInvalid(() => parsePhotoResearch(wrongRevision));
  const wrongNotice = parsePhotoResearch(read()); wrongNotice.leads[1]!.rights.noticeUrl = 'https://commons.wikimedia.org/wiki/File:Other.jpg'; rejectsInvalid(() => parsePhotoResearch(wrongNotice));
});
test('rights addenda preserve old observations, whole record digest and all three affected ingredients', () => {
  const changed = parsePhotoResearch(read()); changed.baselineBindings[0]!.sha256 = 'sha256:' + '0'.repeat(64); rejectsInvalid(() => parsePhotoResearch(changed));
  const addendum = parsePhotoResearch(read()); addendum.rightsAddenda[0]!.recordSha256 = 'sha256:' + '0'.repeat(64); rejectsInvalid(() => parsePhotoResearch(addendum));
  const missing = parsePhotoResearch(read()); missing.rightsAddenda[0]!.affectedIngredientIds.pop(); rejectsInvalid(() => parsePhotoResearch(missing));
  const forged = parsePhotoResearch(read()); rejectsInvalid(() => parsePhotoResearch({ ...forged, rightsAddenda: [{ ...forged.rightsAddenda[0], permissionObtained: true }] }));
});
test('unknown/missing fields, duplicates, invalid dates and fabricated dimensions are rejected', () => {
  for (const value of [null, [], {}, { ...parsePhotoResearch(read()), checkedAt: '2026-02-30' }, { ...parsePhotoResearch(read()), publicUrl: 'https://example.test' }]) rejectsInvalid(() => parsePhotoResearch(value));
  const duplicate = parsePhotoResearch(read()); duplicate.leads.push(duplicate.leads[0]!); rejectsInvalid(() => parsePhotoResearch(duplicate));
  const badDimensions = parsePhotoResearch(read()); badDimensions.leads[0]!.media.reportedHeight = null; rejectsInvalid(() => parsePhotoResearch(badDimensions));
  badDimensions.leads[0]!.media.reportedWidth = -1; rejectsInvalid(() => parsePhotoResearch(badDimensions));
});
test('parser projects a fresh object; changing an output cannot mutate the recorded input', () => {
  const raw = read(); const before = structuredClone(raw); const parsed = parsePhotoResearch(raw);
  parsed.leads[0]!.media.links.push('https://example.test/new'); parsed.baselineBindings[0]!.sha256 = 'changed';
  assert.deepEqual(raw, before);
});
test('CLI rejects an approval action before trying to load any private corpus', () => {
  const wrong = spawnSync(process.execPath, ['--import', 'tsx', 'tools/research/check-photo-leads.ts', '--approve'], { cwd: root, encoding: 'utf8' });
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /read-only/); assert.equal(wrong.stdout, '');
});
test('research has strict type coverage and is not part of the client compilation', () => {
  const configFile = resolve(root, 'tsconfig.research.json'); const loaded = ts.readConfigFile(configFile, ts.sys.readFile); assert.equal(loaded.error, undefined);
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root); assert.deepEqual(config.errors, []);
  assert.equal(config.options.strict, true); assert.equal(config.options.noUncheckedIndexedAccess, true);
  for (const name of ['photo-leads.ts', 'check-photo-leads.ts', 'photo-research.test.ts', 'photo-research.fixture.ts']) assert.ok(config.fileNames.some((file) => file.endsWith(name)));
  const miniFile = resolve(root, 'apps/miniprogram/tsconfig.json'); const miniLoaded = ts.readConfigFile(miniFile, ts.sys.readFile);
  const mini = ts.parseJsonConfigFileContent(miniLoaded.config, ts.sys, resolve(root, 'apps/miniprogram'));
  assert.ok(!mini.fileNames.some((file) => file.includes('/research/') || file.includes('content-private')));
});
