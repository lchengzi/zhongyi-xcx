import { createHash } from 'node:crypto';
import type { CatalogSeed, Ingredient, SourceSummary } from '../shared/contracts.js';

const text = (value: unknown): value is string => typeof value === 'string';
const exact = (value: object, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function seedDigest(seed: Omit<CatalogSeed, 'digest'>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(seed)).digest('hex')}`;
}

export function validateSeed(input: unknown): CatalogSeed {
  if (!object(input) || !exact(input, ['schemaVersion', 'releaseId', 'releaseDigest', 'contentVersion', 'sourceAsOf', 'ingredients', 'digest']) ||
    input.schemaVersion !== 1 || !text(input.releaseId) || !text(input.releaseDigest) || !text(input.contentVersion) ||
    !text(input.sourceAsOf) || !text(input.digest) || !Array.isArray(input.ingredients) || !input.ingredients.length) {
    throw new Error('Invalid catalog seed envelope');
  }
  const ids = new Set<string>();
  for (const item of input.ingredients) {
    if (!object(item) || !exact(item, ['id', 'name', 'pinyin', 'aliases', 'batch', 'latinName', 'ediblePart', 'identityState', 'professionalReviewState', 'restriction', 'sources']) ||
      !['id', 'name', 'pinyin', 'batch', 'latinName', 'ediblePart', 'identityState', 'professionalReviewState', 'restriction'].every((key) => text(item[key])) ||
      !Array.isArray(item.aliases) || !item.aliases.every(text) || !Array.isArray(item.sources) ||
      !/^[a-z0-9-]+$/.test(item.id as string) || ids.has(item.id as string)) throw new Error('Invalid catalog ingredient');
    ids.add(item.id as string);
    for (const source of item.sources) {
      if (!object(source) || !exact(source, ['id', 'title', 'publisher', 'url', 'status', 'checkedAt']) || !Object.values(source).every(text)) throw new Error('Invalid catalog source');
      const url = new URL(source.url as string);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid source URL');
    }
  }
  const seed = input as unknown as CatalogSeed;
  const { digest, ...payload } = seed;
  if (seedDigest(payload) !== digest) throw new Error('Catalog seed digest mismatch');
  return seed;
}

// Only these catalog fields can cross into the companion application.
export function projectIngredient(item: Record<string, unknown>): Ingredient {
  const pick = (value: unknown) => typeof value === 'string' ? value : '';
  const identity = object(item.identity) ? item.identity : {};
  const audit = object(item.audit) ? item.audit : {};
  const regulatory = object(item.regulatory) ? item.regulatory : {};
  return {
    id: pick(item.id), name: pick(item.name), pinyin: pick(item.pinyin),
    aliases: Array.isArray(item.aliases) ? item.aliases.filter(text) : [],
    batch: pick(item.batch), latinName: pick(identity.latinName),
    ediblePart: pick(identity.ediblePart), identityState: pick(identity.partReviewState),
    professionalReviewState: pick(audit.professionalReviewState), restriction: pick(regulatory.restriction),
    sources: (Array.isArray(item.sources) ? item.sources.filter(object) : []).map((source): SourceSummary => ({
      id: pick(source.id), title: pick(source.title), publisher: pick(source.publisher),
      url: pick(source.url), status: pick(source.status), checkedAt: pick(source.checkedAt)
    }))
  };
}
