import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { projectIngredientSafety } from '../../../tools/public-safety-projection.mjs';
import { assessIngredient, normalizeSafetyProfile, parseCatalog, parseIngredientSafety, RED_FLAG_OPTIONS } from '../src/index.js';
import type { Ingredient } from '../src/index.js';

const requireLegacy = createRequire(new URL('../../../zhongyi/package.json', import.meta.url));
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
const legacySafety = record(requireLegacy('./utils/safety.js'));
const legacyData = record(requireLegacy('./data/ingredients.js'));
const legacyItems = legacyData.ingredients;
assert.ok(Array.isArray(legacyItems));
const parsed = parseCatalog(JSON.parse(readFileSync(new URL('../../../apps/miniprogram/src/data/catalog.json', import.meta.url), 'utf8')));
assert.ok(parsed.ok);
const catalog = parsed.catalog;
const legacyById = new Map(legacyItems.map((value: unknown) => [record(value).id, value]));
function legacyCall(name: string, ...args: unknown[]): unknown {
  const fn = legacySafety[name];
  assert.equal(typeof fn, 'function');
  if (typeof fn !== 'function') throw new Error('Missing legacy reference function');
  const result: unknown = fn(...args);
  return result;
}
function sameDecision(item: Ingredient | undefined, legacy: unknown, profile: unknown) {
  const before = record(legacyCall('evaluateIngredient', legacy, profile));
  const after = assessIngredient(item, profile);
  assert.equal(after.blocked, before.blocked, `${item?.id}: blocked`);
  assert.deepEqual(after.reasonCodes, before.reasonCodes, `${item?.id}: reasons`);
  assert.deepEqual(after.warningCodes, before.warningCodes, `${item?.id}: warnings`);
}
const adult = { ageGroup: 'adult', pregnancy: 'no', breastfeeding: 'no', allergyStatus: 'no', conditionStatus: 'no', medicationStatus: 'no' };

test('normalization preserves legacy unknowns, bounded lists and contradictory named history', () => {
  for (const input of [undefined, null, 1, [], {}, adult,
    { allergies: [' 百合 ', '百合', 42, null, {}, 'A', 'a'], allergyStatus: 'no', conditions: ['高血压'], conditionStatus: 'no' },
    { ageGroup: 'invalid', pregnancy: true, redFlags: ['unknown-emergency', 'unknown-emergency'] },
    { medications: Array.from({ length: 40 }, (_, i) => `${i}${'a'.repeat(100)}`), redFlags: Array.from({ length: 20 }, (_, i) => `${i}${'b'.repeat(80)}`) }
  ]) {
    const profile = normalizeSafetyProfile(input);
    assert.deepEqual(profile, legacyCall('normalizeProfile', input));
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.redFlags));
    assert.ok(Object.isFrozen(profile.medications));
  }
});

test('all 106 real entries retain legacy decisions across unknown, population, allergy, medication and emergency profiles', () => {
  const profiles: unknown[] = [{}, adult,
    ...['infant_toddler', 'child', 'older_adult'].map(ageGroup => ({ ...adult, ageGroup })),
    ...['pregnancy', 'breastfeeding', 'allergyStatus', 'conditionStatus', 'medicationStatus'].map(key => ({ ...adult, [key]: 'yes' })),
    { ...adult, conditions: ['过敏体质', '高血压'] }, { ...adult, medications: ['藜芦'] },
    { ...adult, allergies: ['百合', '山药', '蜂蜜'] },
    { ...adult, redFlags: ['unrecognized-emergency'] },
    ...RED_FLAG_OPTIONS.map(option => ({ ...adult, redFlags: [option.value] }))
  ];
  let comparisons = 0;
  for (const item of catalog.ingredients) {
    const legacy = legacyById.get(item.id);
    assert.ok(legacy);
    const policy = item.safety;
    const matching = [
      { ...adult, allergies: policy.allergenKeys }, { ...adult, conditions: policy.avoidConditions },
      { ...adult, conditions: policy.cautionConditions }, { ...adult, medications: policy.drugInteractions }
    ];
    for (const profile of [...profiles, ...matching]) {
      sameDecision(item, legacy, profile);
      comparisons += 1;
    }
    assert.ok(assessIngredient(item, adult).warningCodes.includes('professional_review_pending'));
    assert.equal('eligible' in assessIngredient(item, adult), false);
  }
  assert.equal(comparisons, 3074);
  sameDecision(undefined, undefined, {});
});

test('real publication restrictions retain known population and interaction cases', () => {
  const blocked = (profile: unknown) => catalog.ingredients.filter(item => assessIngredient(item, profile).blocked);
  assert.equal(blocked({}).length, 0);
  for (const profile of [{ pregnancy: 'yes' }, { breastfeeding: 'yes' }, { ageGroup: 'infant_toddler' }]) {
    assert.equal(blocked(profile).length, 13);
  }
  assert.deepEqual(blocked({ medications: ['藜芦'] }).map(item => item.id).sort(), ['dang-shen', 'xi-yang-shen']);
  assert.deepEqual(blocked({ allergyStatus: 'yes' }).map(item => item.id), ['tian-ma']);
  assert.equal(blocked({ redFlags: ['unknown-emergency'] }).length, 106);
});

test('build-time source gating, not raw declarations, controls migrated population rules', () => {
  const original = record(legacyItems[0]);
  const first = catalog.ingredients.find(item => item.id === original.id);
  assert.ok(first);
  const safety = record(original.safety);
  const audit = record(original.audit);
  const variants = [
    { ...original, safety: { ...safety, pregnancy: 'yes', sourceIds: [] } },
    { ...original, safety: { ...safety, pregnancy: 'yes' } },
    { ...original, safety: { ...safety, pregnancy: 'avoid' } },
    { ...original, safety: { ...safety, pregnancy: { status: 'no' } } },
    { ...original, safety: { ...safety, pregnancy: 'no', sourceIds: [] } },
    { ...original, audit: { ...audit, sourceCheckState: 'pending' }, safety: { ...safety, pregnancy: 'no' } },
    { ...original, sources: [], safety: { ...safety, pregnancy: 'no' } },
    { ...original, regulatory: { ...record(original.regulatory), status: 'unconfirmed' } },
    { ...original, safety: { ...safety, cautionConditions: ['高血压'] } }
  ];
  for (const legacy of variants) {
    const item = { ...first, safety: parseIngredientSafety(projectIngredientSafety(legacy), 'safety') };
    sameDecision(item, legacy, { ...adult, pregnancy: 'yes', conditions: ['高血压'] });
  }
  assert.throws(() => projectIngredientSafety({ ...original, audit: { ...audit, professionalReviewState: 'reviewed' } }), /projection review/);
});

test('public policy parsing rejects malformed fields, sparse lists, private records and positive suitability', () => {
  const item = catalog.ingredients[0];
  assert.ok(item);
  const policy = item.safety;
  for (const value of [null, {}, { ...policy, privateReview: {} },
    { ...policy, sourceState: 'trusted' }, { ...policy, regulatoryStatus: 'approved' },
    { ...policy, population: { ...policy.population, pregnancy: 'yes' } },
    { ...policy, reviews: { ...policy.reviews, allergen: 'approved' } },
    { ...policy, allergenKeys: new Array(1) }, { ...policy, drugInteractions: [''] },
    { ...policy, avoidConditions: Array(101).fill('a') }
  ]) assert.throws(() => parseIngredientSafety(value, 'safety'));
  assert.ok(Object.isFrozen(parseIngredientSafety(policy, 'safety').population));
});
