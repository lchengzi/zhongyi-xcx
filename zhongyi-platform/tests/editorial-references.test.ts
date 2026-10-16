import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEditorialReference, parseEditorialReferenceList, EDITORIAL_REFERENCE_SCHEMA } from '../shared/editorial-references.js';
import { parsePrivatePhoto } from '../shared/private-photos.js';
import { EditorialReferenceRegistry } from '../server/editorial-references.js';
import { createApp } from '../server/app.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { fixtureSeed } from './fixture.js';
import { localDemoStartArgs } from '../server/local-demo.js';

// Framing-only synthetic bytes, never called an actual food photograph.
const bytes = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
const reference = { id: 'research-fixture', ingredientId: 'huang-qi', name: '工程研究参考', sourceUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10178363/fullTextXML',
  publisher: '工程夹具', locator: '仅测试', author: '未确定', declaredLicense: 'not-established', licenseUrl: null, representation: 'repository-display', observation: '不是食材图片。', concerns: ['仅测试，不能公开。'],
  sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes: bytes.length, width: 1, height: 1, publicationEligible: false };
function fixture(input: unknown = reference) {
  const root = mkdtempSync(join(tmpdir(), 'editorial-reference-')), file = join(root, 'manifest.json');
  const manifest = { schemaVersion: EDITORIAL_REFERENCE_SCHEMA, items: [{ ...parseEditorialReference(input), localPath: 'research.jpg' }] };
  writeFileSync(file, JSON.stringify(manifest)); writeFileSync(join(root, 'research.jpg'), bytes);
  return { root, file, manifest };
}
test('research projection keeps unknown rights separate, rejects approval, paths, unsafe sources and false licenses', () => {
  const parsed = parseEditorialReference(reference); parsed.concerns.push('detached'); assert.equal(reference.concerns.length, 1);
  assert.throws(() => parsePrivatePhoto(parsed));
  for (const bad of [{ ...reference, localPath: 'secret.jpg' }, { ...reference, publicationEligible: true }, { ...reference, approved: true },
    { ...reference, sourceUrl: 'https://www.ebi.ac.uk.evil.test/p' }, { ...reference, sourceUrl: 'https://www.ebi.ac.uk/p?token=private' },
    { ...reference, sourceUrl: 'http://www.ebi.ac.uk/p' }, { ...reference, sourceUrl: 'https://user:password@www.ebi.ac.uk/p' },
    { ...reference, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }, { ...reference, bytes: 1024 * 1024 + 1 },
    { ...reference, width: 12000, height: 12000 }, { ...reference, id: '../secret' }, { ...reference, concerns: [] }]) assert.throws(() => parseEditorialReference(bad));
  assert.throws(() => parseEditorialReferenceList({ schemaVersion: EDITORIAL_REFERENCE_SCHEMA, enabled: false, items: [reference] }));
  assert.throws(() => parseEditorialReferenceList({ schemaVersion: EDITORIAL_REFERENCE_SCHEMA, enabled: true, items: [reference, reference] }));
});
test('source thumbnails retain fixed Commons provenance and share-alike license without becoming candidate originals', () => {
  const thumb = { ...reference, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg?oldid=123', declaredLicense: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', representation: 'source-thumbnail' };
  const parsed = parseEditorialReference(thumb); assert.equal(parsed.publicationEligible, false); assert.throws(() => parsePrivatePhoto(parsed));
  for (const bad of [{ ...thumb, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg' },
    { ...thumb, sourceUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10178363/fullTextXML' },
    { ...thumb, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }, { ...thumb, publicationEligible: true },
    { ...thumb, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg?oldid=123&token=secret' }]) assert.throws(() => parseEditorialReference(bad));
});
test('private Commons reference preserves actual BY-SA2.5 without widening original or public publication permissions', () => {
  const older = { ...reference, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg?oldid=123',
    declaredLicense: 'CC-BY-SA-2.5', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.5/', representation: 'repository-original' };
  const parsed = parseEditorialReference(older); assert.equal(parsed.declaredLicense, 'CC-BY-SA-2.5');
  assert.equal(parsed.publicationEligible, false); assert.throws(() => parsePrivatePhoto(parsed));
  const f = fixture(older), registry = new EditorialReferenceRegistry(f.file);
  assert.equal(registry.list().items[0]!.declaredLicense, 'CC-BY-SA-2.5'); assert.deepEqual(registry.image(older.id), bytes);
  for (const bad of [{ ...older, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg' },
    { ...older, sourceUrl: 'https://www.ebi.ac.uk/article' }, { ...older, sourceUrl: 'https://commons.wikimedia.org/wiki/Category:Beans?oldid=123' },
    { ...older, licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }, { ...older, declaredLicense: 'CC-BY-SA-3.0' },
    { ...older, sourceUrl: older.sourceUrl + '&token=private' }, { ...older, publicationEligible: true }]) assert.throws(() => parseEditorialReference(bad));
  const originalWithSupportedLicense = { ...older, declaredLicense: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  assert.equal(parseEditorialReference(originalWithSupportedLicense).representation, 'repository-original');
  assert.throws(() => parseEditorialReference({ ...originalWithSupportedLicense, sourceUrl: 'https://www.ebi.ac.uk/reference' }));
});
test('private Commons BY2.0 preserves its exact licence and cannot grant candidate or publication permission', () => {
  const older = { ...reference, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg?oldid=123',
    declaredLicense: 'CC-BY-2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', representation: 'processed-display' };
  const parsed = parseEditorialReference(older);
  assert.equal(parsed.declaredLicense, 'CC-BY-2.0');
  assert.equal(parsed.publicationEligible, false); assert.throws(() => parsePrivatePhoto(parsed));
  const f = fixture(older), registry = new EditorialReferenceRegistry(f.file);
  assert.equal(registry.list().items[0]!.licenseUrl, older.licenseUrl);
  assert.deepEqual(registry.image(older.id), bytes);
  for (const bad of [{ ...older, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg' },
    { ...older, sourceUrl: 'https://commons.wikimedia.org/wiki/Category:Lilium?oldid=123' },
    { ...older, sourceUrl: 'https://www.ebi.ac.uk/article' },
    { ...older, sourceUrl: 'https://www.yixing.gov.cn/doc/2024/10/08/1260878.shtml' },
    { ...older, sourceUrl: older.sourceUrl + '&token=private' },
    { ...older, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
    { ...older, licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/' },
    { ...older, publicationEligible: true }]) assert.throws(() => parseEditorialReference(bad));
});
test('domestic news references remain article-bound, private and without an inferred open licence', () => {
  for (const sourceUrl of ['https://www.news.cn/info/20231123/f50bde73d27847b48cee110c34047d57/c.html',
    'https://www.news.cn/20250810/86728be67197444f91ce862ac492b211/c.html']) {
    const news = { ...reference, sourceUrl, representation: 'source-page-image' };
    assert.equal(parseEditorialReference(news).publicationEligible, false);
    assert.throws(() => parsePrivatePhoto(news));
    for (const bad of [{ ...news, sourceUrl: sourceUrl.replace('www.news.cn', 'www.news.cn.evil.test') },
      { ...news, sourceUrl: sourceUrl + '?token=private' }, { ...news, sourceUrl: sourceUrl.replace('c.html', 'image.jpg') },
      { ...news, sourceUrl: 'https://www.news.cn/arbitrary/c.html' }, { ...news, representation: 'processed-display' },
      { ...news, declaredLicense: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      { ...news, declaredLicense: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
      { ...news, publicationEligible: true }]) assert.throws(() => parseEditorialReference(bad));
  }
});
test('The Paper author article remains a private page reference, not a licensed candidate original', () => {
  const article = { ...reference, sourceUrl: 'https://www.thepaper.cn/newsDetail_forward_7515280', representation: 'source-page-image' };
  assert.equal(parseEditorialReference(article).publicationEligible, false);
  assert.throws(() => parsePrivatePhoto(article));
  for (const bad of [{ ...article, sourceUrl: 'https://www.thepaper.cn/newsDetail_forward_0' },
    { ...article, sourceUrl: 'https://www.thepaper.cn/newsDetail_forward_7515280?token=private' },
    { ...article, sourceUrl: 'https://www.thepaper.cn/newsDetail_forward_7515280/image.jpg' },
    { ...article, sourceUrl: 'https://www.thepaper.cn.evil.test/newsDetail_forward_7515280' },
    { ...article, sourceUrl: 'https://imagepphcloud.thepaper.cn/pph/image/68/656/666.jpg' },
    { ...article, sourceUrl: 'https://www.thepaper.cn/arbitrary' },
    { ...article, representation: 'source-thumbnail' }, { ...article, representation: 'processed-display' },
    { ...article, declaredLicense: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    { ...article, publicationEligible: true }]) assert.throws(() => parseEditorialReference(bad));
});
test('supplier photo stays bound to the researched product page without inferred rights or original status', () => {
  const supplier = { ...reference, sourceUrl: 'https://sourcing.hktdc.com/en/Product-Detail/Lanzhou-Fresh-Lily-Bulb-1X1K417Q', representation: 'source-page-image' };
  assert.equal(parseEditorialReference(supplier).publicationEligible, false);
  assert.throws(() => parsePrivatePhoto(supplier));
  for (const bad of [{ ...supplier, sourceUrl: supplier.sourceUrl + '?token=private' },
    { ...supplier, sourceUrl: supplier.sourceUrl + '/image.jpg' },
    { ...supplier, sourceUrl: 'https://sourcing.hktdc.com/en/Product-Detail/Other-1X1K417Q' },
    { ...supplier, sourceUrl: 'https://sourcing.hktdc.com/arbitrary' },
    { ...supplier, sourceUrl: supplier.sourceUrl.replace('sourcing.hktdc.com', 'sourcing.hktdc.com.evil.test') },
    { ...supplier, sourceUrl: 'https://sourcing-media.hktdc.com/original-file/a517863ae39d11ea883f06c82c63b760' },
    { ...supplier, representation: 'processed-display' }, { ...supplier, representation: 'repository-display' },
    { ...supplier, declaredLicense: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    { ...supplier, publicationEligible: true }]) assert.throws(() => parseEditorialReference(bad));
});

test('read-only registry checks hashes, dimensions, paths and public directory isolation without mutating source files', () => {
  const f = fixture(), registry = new EditorialReferenceRegistry(f.file);
  const copy = registry.image(reference.id)!; copy[0] = 0; assert.deepEqual(registry.image(reference.id), bytes);
  assert.equal(registry.image('../secret'), undefined); assert.throws(() => registry.assertIsolation(f.root)); assert.throws(() => registry.assertIsolation(join(f.root, 'dist')));
  for (const change of [{ localPath: '../research.jpg' }, { sha256: `sha256:${'a'.repeat(64)}` }, { width: 2 }, { bytes: 1 }]) {
    writeFileSync(f.file, JSON.stringify({ schemaVersion: EDITORIAL_REFERENCE_SCHEMA, items: [{ ...f.manifest.items[0], ...change }] }));
    assert.throws(() => new EditorialReferenceRegistry(f.file));
  }
  mkdirSync(join(f.root, 'real')); symlinkSync(join(f.root, 'real'), join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(f.root, 'real/research.jpg'), bytes); writeFileSync(f.file, JSON.stringify({ schemaVersion: EDITORIAL_REFERENCE_SCHEMA, items: [{ ...f.manifest.items[0], localPath: 'link/research.jpg' }] }));
  assert.throws(() => new EditorialReferenceRegistry(f.file));
  assert.deepEqual(registry.image(reference.id), bytes);
});
test('normal account HTTP protects read-only research bytes, rejects mutations and does not expose candidates or public photos', async () => {
  const f = fixture(), registry = new EditorialReferenceRegistry(f.file), repo = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repo.db);
  assert.throws(() => createApp(repo, 'fixture-long-enough-local-key-2026', undefined, { editorialReferences: registry }), /account/);
  const origin = 'https://reference-fixture.example.test';
  const server = createApp(repo, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { editorialReferences: registry }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api/v1`;
  try {
    for (const suffix of ['', `/${reference.id}/image`]) assert.equal((await fetch(`${base}/editorial-references${suffix}`)).status, 401);
    for (const role of ['editor', 'reviewer'] as const) {
      await auth.createUser(`research-${role}`, 'fixture-password-research-2026', role, 'test'); const login = await auth.login(`research-${role}`, 'fixture-password-research-2026', 'test');
      const headers = { Cookie: `food_session=${login.token}` };
      const list = await fetch(`${base}/editorial-references`, { headers }); assert.equal(list.status, 200); assert.equal(list.headers.get('Cache-Control'), 'no-store');
      const value = await list.text(); assert(!/localPath|research.jpg|originalMetadata/.test(value)); assert.equal(parseEditorialReferenceList(JSON.parse(value)).items.length, 1);
      const image = await fetch(`${base}/editorial-references/${reference.id}/image`, { headers }); assert.equal(image.status, 200); assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
      assert.equal(image.headers.get('Cross-Origin-Resource-Policy'), 'same-origin'); assert.equal(image.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
      assert.equal((await fetch(`${base}/editorial-references?path=secret`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/editorial-references`, { headers, method: 'HEAD' })).status, 400);
      assert.equal((await fetch(`${base}/editorial-references`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
      assert.equal((await fetch(`${base}/editorial-references`, { method: 'POST', headers: { ...headers, Origin: origin, 'X-CSRF-Token': login.info.csrfToken } })).status, 400);
      assert.equal((await (await fetch(`${base}/private-photos`, { headers })).json()).items.length, 0);
      assert.equal((await fetch(`${base}/public/photos/huang-qi`)).status, 503);
      assert(!(await (await fetch(`${base}/public/catalog`)).text()).includes('research-fixture'));
      await auth.logout(login.token, login.info.user.username); assert.equal((await fetch(`${base}/editorial-references/${reference.id}/image`, { headers })).status, 401);
    }
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); repo.close(); }
});
test('local demo research attachment is explicit and absolute, with old CLI behavior preserved', () => {
  const id = 'demo-12345678-1234-4123-8123-123456789abc', f = fixture();
  assert.deepEqual(localDemoStartArgs(['start', id]), { demoId: id, port: 4314 });
  assert.deepEqual(localDemoStartArgs(['start', id, '--research-manifest', f.file]), { demoId: id, port: 4314, researchManifest: f.file });
  for (const args of [['start', id, '--research-manifest', '.'], ['start', id, '--research-manifest', f.file, '--research-manifest', f.file], ['start', id, '--research-root', f.root]]) assert.throws(() => localDemoStartArgs(args));
});
