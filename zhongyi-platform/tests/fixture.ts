import { seedDigest } from '../server/seed.js';
import type { CatalogSeed, Ingredient } from '../shared/contracts.js';

export function fixtureSeed(): CatalogSeed {
  const source = { id: 'test-official', title: '测试来源（非正式资料）', publisher: 'Test fixture', url: 'https://example.org/source', status: 'published', checkedAt: '2026-08-10' };
  const make = (id: string, name: string, pinyin: string, aliases: string[]): Ingredient => ({
    id, name, pinyin, aliases, batch: '测试批次', latinName: '', ediblePart: '待核对', identityState: 'pending',
    professionalReviewState: 'pending', restriction: '仅测试使用', sources: [source]
  });
  const payload = { schemaVersion: 1 as const, releaseId: 'release-test.1', releaseDigest: `sha256:${'a'.repeat(64)}`,
    contentVersion: 'test-catalog.1', sourceAsOf: '2026-08-10', ingredients: [make('huang-qi', '黄芪', 'huang qi', []), make('gou-qi-zi', '枸杞子', 'gou qi zi', ['枸杞']), make('jiang', '姜', 'jiang', ['生姜'])] };
  return { ...payload, digest: seedDigest(payload) };
}
