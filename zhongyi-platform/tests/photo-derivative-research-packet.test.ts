import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { parseEditorialReviewPack } from '../server/editorial-review-pack.js';
import { parseEditorialReference } from '../shared/editorial-references.js';
import { researchPacketArgs, researchPacketHtml, type ResearchDisplay } from '../photo-processing/research-packet.js';

const pack = parseEditorialReviewPack({ schemaVersion: 'private-editorial-pack.1', visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false, externalAiEnabled: false,
  sources: [{ key: 'fixture-source', input: { title: '<script>not-markup</script>', publisher: '工程夹具', url: 'https://example.test/source' }, accessedOn: '2026-10-14', evidenceNote: '<img src=x onerror=alert(1)>' }],
  drafts: [{ ingredientId: 'bai-he', content: { ediblePart: '待核对', latinName: '', educationText: '工程测试，不是实际食材资料。', safetyText: '<iframe src=x>不能执行</iframe>', sourceRefs: [{ id: 'fixture-source', revision: 1, locator: '仅测试' }] } }] });
const reference = parseEditorialReference({ id: 'reference-fixture', ingredientId: 'bai-he', name: '<img src=x onerror=alert(1)>', sourceUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10178363/fullTextXML', publisher: '工程夹具', locator: '测试', author: '未确定', declaredLicense: 'not-established', licenseUrl: null, representation: 'repository-display', observation: '不是食材照片', concerns: ['<script>不执行</script>'], sha256: `sha256:${'a'.repeat(64)}`, bytes: 100, width: 40, height: 30, publicationEligible: false });
const item: ResearchDisplay = { reference, filename: `reference-fixture-${'b'.repeat(64)}.jpg`, sha256: `sha256:${'b'.repeat(64)}`, bytes: 100, width: 40, height: 30, decodedWidth: 40, decodedHeight: 30, metadataPolicy: 'jfif-only-no-thumbnail' };
test('portable research HTML reuses current draft/source renderer, escapes material and never adds approvals or arbitrary media paths', () => {
  const html = researchPacketHtml(pack, [item]);
  assert(html.includes('img-src &#39;self&#39;') || html.includes("img-src 'self'"));
  assert(html.includes('review-notes.txt') && html.includes('转载许可未取得') && html.includes('含可辨人脸的湖南现场不在本包'));
  assert(html.includes('&lt;script&gt;') && html.includes('&lt;iframe'));
  assert(!/<script\b|<iframe\b|<form\b|onerror="/.test(html)); assert.equal((html.match(/<img /g) ?? []).length, 1);
  for (const filename of ['../source.jpg', 'credentials.json', 'x" onerror="alert(1)', 'https://example.test/x.jpg']) assert.throws(() => researchPacketHtml(pack, [{ ...item, filename }]));
  assert.throws(() => researchPacketHtml(pack, [{ ...item, width: 5000 }]));
});
test('research packet CLI requires exact explicit absolute inputs and a known local browser', () => {
  const args = ['--pack', resolve('fixture-pack.json'), '--references', resolve('fixture-references.json'), '--browser', 'edge'];
  assert.equal(researchPacketArgs(args).browser, 'edge');
  for (const bad of [[], [...args, '--publish'], ['--pack', '.', '--references', args[3], '--browser', 'edge'], [...args.slice(0, 5), 'remote'], ['--references', args[3], '--pack', args[1], '--browser', 'edge']]) assert.throws(() => researchPacketArgs(bad));
});
test('non-Baihe material does not acquire an unrelated Baihe scene claim', () => {
  const yam = { ...pack, drafts: pack.drafts.map(draft => ({ ...draft, ingredientId: 'shan-yao' })) };
  const html = researchPacketHtml(yam, [{ ...item, reference: { ...reference, ingredientId: 'shan-yao' } }]);
  assert(!html.includes('湖南现场'));
  assert(html.includes('未获准公开') && html.includes('原始图片、完整标准原件、账户和数据库均未装入'));
});
