import { createRequire } from 'node:module';

// Build-time bridge only. The client imports the resulting public JSON, never
// the native app or its unpublished research and review records.
const legacy = createRequire(new URL('../zhongyi/package.json', import.meta.url));
const { populationRuleState, ingredientCurrentSourcesReady } = legacy('./utils/safety.js');
const text = value => typeof value === 'string' ? value.trim() : '';

export function projectIngredientSafety(item) {
  if (!item || item.audit?.professionalReviewState !== 'pending') {
    throw new Error('A changed review state requires an explicit projection review.');
  }
  return {
    sourceState: ingredientCurrentSourcesReady(item) && item.audit?.sourceCheckState === 'checked' ? 'checked' : 'unverified',
    regulatoryStatus: ['listed', 'ordinary_food'].includes(item.regulatory?.status) ? item.regulatory.status : 'unconfirmed',
    population: Object.fromEntries(['pregnancy', 'breastfeeding', 'infantsToddlers', 'children', 'olderAdults'].map(key => {
      const state = populationRuleState(item, key);
      if (state === 'yes') throw new Error('Positive population approval requires a reviewed publication protocol.');
      return [key, state];
    })),
    allergenKeys: (item.safety?.allergenKeys || []).map(text),
    avoidConditions: (item.safety?.avoidConditions || []).map(text),
    cautionConditions: (item.safety?.cautionConditions || []).map(text),
    drugInteractions: (item.safety?.drugInteractions || []).map(text),
    preparationWarnings: (item.safety?.preparationWarnings || []).map(text),
    reviews: {
      allergen: item.safety?.allergenReviewState === 'reviewed' ? 'reviewed' : 'pending',
      condition: item.safety?.conditionReviewState === 'reviewed' ? 'reviewed' : 'pending',
      interaction: item.safety?.interactionReviewState === 'reviewed' ? 'reviewed' : 'pending',
      preparation: item.safety?.preparationReviewState === 'reviewed' ? 'reviewed' : 'pending',
      foodUse: item.foodUse?.mappingReviewState === 'reviewed' ? 'reviewed' : 'pending',
      catalog: item.regulatory?.currentCatalogReviewState === 'reviewed' ? 'reviewed' : 'pending'
    }
  };
}
