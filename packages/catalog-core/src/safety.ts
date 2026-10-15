import type { Ingredient } from './catalog.js';

/** Version of the existing deterministic rules, not a new clinical approval. */
export const SAFETY_RULES_VERSION = '1.6.0';
export type TriState = 'yes' | 'no' | 'unknown';
export type AgeGroup = 'unknown' | 'infant_toddler' | 'child' | 'adult' | 'older_adult';
export type ReviewState = 'pending' | 'reviewed';

export interface SafetyProfile {
  readonly ageGroup: AgeGroup;
  readonly pregnancy: TriState;
  readonly breastfeeding: TriState;
  readonly allergyStatus: TriState;
  readonly conditionStatus: TriState;
  readonly medicationStatus: TriState;
  readonly allergies: readonly string[];
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly redFlags: readonly string[];
}

/** Public projection of source-gated rules. Pending review can never grant yes. */
export interface IngredientSafety {
  readonly sourceState: 'checked' | 'unverified';
  readonly regulatoryStatus: 'listed' | 'ordinary_food' | 'unconfirmed';
  readonly population: Readonly<Record<'pregnancy' | 'breastfeeding' | 'infantsToddlers' | 'children' | 'olderAdults', 'no' | 'unknown'>>;
  readonly allergenKeys: readonly string[];
  readonly avoidConditions: readonly string[];
  readonly cautionConditions: readonly string[];
  readonly drugInteractions: readonly string[];
  readonly preparationWarnings: readonly string[];
  readonly reviews: Readonly<Record<'allergen' | 'condition' | 'interaction' | 'preparation' | 'foodUse' | 'catalog', ReviewState>>;
}

const ageGroups: readonly AgeGroup[] = ['unknown', 'infant_toddler', 'child', 'adult', 'older_adult'];
export const AGE_OPTIONS: readonly { readonly value: AgeGroup; readonly label: string }[] = Object.freeze([
  { value: 'unknown', label: '不确定' }, { value: 'infant_toddler', label: '婴幼儿' },
  { value: 'child', label: '儿童或青少年' }, { value: 'adult', label: '成年人' }, { value: 'older_adult', label: '老年人' }
]);
export const TRI_OPTIONS: readonly { readonly value: TriState; readonly label: string }[] = Object.freeze([
  { value: 'unknown', label: '不确定' }, { value: 'yes', label: '是' }, { value: 'no', label: '否' }
]);
export const RED_FLAG_OPTIONS = Object.freeze([
  { value: 'breathing_difficulty', label: '明显呼吸困难' },
  { value: 'altered_consciousness', label: '意识异常或昏厥' },
  { value: 'sudden_severe_chest_pain', label: '突发剧烈胸痛' },
  { value: 'stroke_like_signs', label: '突发口角歪斜、单侧无力或言语异常' },
  { value: 'seizure', label: '抽搐或首次癫痫样发作' },
  { value: 'suspected_severe_allergy', label: '疑似严重过敏反应' },
  { value: 'bleeding_or_black_stool', label: '呕血、便血或黑便' },
  { value: 'persistent_vomiting_or_dehydration', label: '持续呕吐或明显脱水' },
  { value: 'severe_progressive_abdominal_pain', label: '剧烈或持续加重的腹痛' },
  { value: 'pregnancy_emergency_signs', label: '孕期出血、剧烈腹痛或胎动明显异常' },
  { value: 'immediate_self_harm_risk', label: '有即时自伤、自杀或人身危险' }
]);
export const EMERGENCY_MESSAGE = '请立即联系急救或前往正规医疗机构，不要等待食养建议。';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}
function values(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function clean(value: unknown, max: number): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
}
function unique(value: unknown, max: number, length: number): readonly string[] {
  const found = new Set<string>();
  const result: string[] = [];
  for (const item of values(value)) {
    const text = clean(item, length);
    const key = text.toLocaleLowerCase();
    if (!text || found.has(key) || result.length >= max) continue;
    found.add(key);
    result.push(text);
  }
  return Object.freeze(result);
}
function tri(value: unknown): TriState { return value === 'yes' || value === 'no' ? value : 'unknown'; }
function age(value: unknown): AgeGroup {
  return ageGroups.find(candidate => candidate === value) ?? 'unknown';
}

/** Unknown stays unknown; a named history overrides a contradictory no. */
export function normalizeSafetyProfile(input: unknown): SafetyProfile {
  const source = object(input);
  const allergies = unique(source.allergies, 30, 80);
  const conditions = unique(source.conditions, 30, 80);
  const medications = unique(source.medications, 30, 80);
  return Object.freeze({
    ageGroup: age(source.ageGroup), pregnancy: tri(source.pregnancy), breastfeeding: tri(source.breastfeeding),
    allergies, conditions, medications,
    allergyStatus: allergies.length ? 'yes' : tri(source.allergyStatus),
    conditionStatus: conditions.length ? 'yes' : tri(source.conditionStatus),
    medicationStatus: medications.length ? 'yes' : tri(source.medicationStatus),
    // Unrecognized nonempty flags must not disappear and resume browsing.
    redFlags: unique(source.redFlags, 12, 60)
  });
}

function exact(source: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(source).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(source, key))) {
    throw new Error(`${path}: unexpected or missing safety fields`);
  }
}
export function parseIngredientSafety(input: unknown, path: string): IngredientSafety {
  const source = object(input);
  exact(source, ['sourceState', 'regulatoryStatus', 'population', 'allergenKeys', 'avoidConditions', 'cautionConditions', 'drugInteractions', 'preparationWarnings', 'reviews'], path);
  if (source.sourceState !== 'checked' && source.sourceState !== 'unverified') throw new Error(`${path}: invalid source state`);
  if (source.regulatoryStatus !== 'listed' && source.regulatoryStatus !== 'ordinary_food' && source.regulatoryStatus !== 'unconfirmed') throw new Error(`${path}: invalid regulatory state`);
  const population = object(source.population);
  const populationKeys = ['pregnancy', 'breastfeeding', 'infantsToddlers', 'children', 'olderAdults'] as const;
  exact(population, populationKeys, `${path}.population`);
  const populationState = (key: typeof populationKeys[number]): 'no' | 'unknown' => {
    const state = population[key];
    if (state !== 'no' && state !== 'unknown') throw new Error(`${path}.${key}: unapproved positive population claim`);
    return state;
  };
  const reviews = object(source.reviews);
  const reviewKeys = ['allergen', 'condition', 'interaction', 'preparation', 'foodUse', 'catalog'] as const;
  exact(reviews, reviewKeys, `${path}.reviews`);
  const review = (key: typeof reviewKeys[number]): ReviewState => {
    const state = reviews[key];
    if (state !== 'pending' && state !== 'reviewed') throw new Error(`${path}.${key}: invalid review state`);
    return state;
  };
  const list = (key: string): readonly string[] => {
    const entries = source[key];
    if (!Array.isArray(entries) || entries.length > 100) throw new Error(`${path}.${key}: invalid list`);
    return Object.freeze(Array.from(entries, (entry: unknown) => {
      if (typeof entry !== 'string' || !entry || entry.trim() !== entry || entry.length > 2000) throw new Error(`${path}.${key}: invalid text`);
      return entry;
    }));
  };
  return Object.freeze({
    sourceState: source.sourceState, regulatoryStatus: source.regulatoryStatus,
    population: Object.freeze({ pregnancy: populationState('pregnancy'), breastfeeding: populationState('breastfeeding'), infantsToddlers: populationState('infantsToddlers'), children: populationState('children'), olderAdults: populationState('olderAdults') }),
    allergenKeys: list('allergenKeys'), avoidConditions: list('avoidConditions'), cautionConditions: list('cautionConditions'), drugInteractions: list('drugInteractions'), preparationWarnings: list('preparationWarnings'),
    reviews: Object.freeze({ allergen: review('allergen'), condition: review('condition'), interaction: review('interaction'), preparation: review('preparation'), foodUse: review('foodUse'), catalog: review('catalog') })
  });
}

export type SafetyReasonCode = 'invalid_record' | 'red_flag' | 'regulatory_unavailable' | 'source_unverified' | 'allergy_match' | 'condition_match' | 'allergy_prone_not_suitable' | 'interaction_match' | 'pregnancy_not_suitable' | 'breastfeeding_not_suitable' | 'infants_toddlers_not_suitable' | 'children_not_suitable' | 'older_adult_not_suitable';
export type SafetyWarningCode = 'condition_caution' | 'pregnancy_unknown' | 'breastfeeding_unknown' | 'infants_toddlers_unknown' | 'children_unknown' | 'older_adult_unknown' | 'condition_data_pending' | 'interaction_data_pending' | 'allergen_data_limited' | 'allergy_details_required' | 'condition_details_required' | 'medication_details_required' | 'preparation_warning' | 'preparation_data_pending' | 'food_use_mapping_pending' | 'catalog_refresh_pending' | 'professional_review_pending' | 'profile_incomplete';
export interface SafetyAssessment {
  readonly ingredientId: string;
  readonly blocked: boolean;
  readonly status: 'blocked' | 'caution' | 'reference';
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly reasonCodes: readonly SafetyReasonCode[];
  readonly warningCodes: readonly SafetyWarningCode[];
}

function token(value: string): string { return value.trim().slice(0, 120).toLocaleLowerCase().replace(/[\s·•、，,;；()（）]/g, ''); }
function matches(profile: readonly string[], rules: readonly string[]): readonly string[] {
  return [...new Set(profile.flatMap(value => rules.filter(rule => {
    const a = token(value), b = token(rule);
    return a.length > 0 && b.length > 0 && (a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))));
  })))];
}
export function missingSafetyDimensions(profile: SafetyProfile): readonly string[] {
  const missing: string[] = [];
  if (profile.ageGroup === 'unknown') missing.push('年龄阶段');
  for (const [label, state] of [['孕期状态', profile.pregnancy], ['哺乳期状态', profile.breastfeeding], ['过敏情况', profile.allergyStatus], ['基础疾病情况', profile.conditionStatus], ['用药情况', profile.medicationStatus]]) {
    if (state === 'unknown' && label) missing.push(label);
  }
  return missing;
}

/** Keeps the legacy decision codes. A clear checklist never grants suitability. */
export function assessIngredient(item: Ingredient | undefined, input: unknown): SafetyAssessment {
  const profile = normalizeSafetyProfile(input);
  const reasons: string[] = [], warnings: string[] = [];
  const reasonCodes: SafetyReasonCode[] = [], warningCodes: SafetyWarningCode[] = [];
  const block = (code: SafetyReasonCode, message: string) => { if (!reasonCodes.includes(code)) { reasonCodes.push(code); reasons.push(message); } };
  const warn = (code: SafetyWarningCode, message: string) => { if (!warningCodes.includes(code)) { warningCodes.push(code); warnings.push(message); } };
  if (!item) block('invalid_record', '条目数据无效，请返回目录重新选择。');
  else {
    const name = item.name, safety = item.safety;
    if (profile.redFlags.length) block('red_flag', EMERGENCY_MESSAGE);
    if (safety.regulatoryStatus === 'unconfirmed') block('regulatory_unavailable', `${name}的食品法规状态尚未确认。`);
    if (safety.sourceState !== 'checked') block('source_unverified', `${name}缺少已核对的来源。`);
    if (matches(profile.allergies, safety.allergenKeys).length) block('allergy_match', `过敏信息与${name}匹配，请先向专业人员确认。`);
    const avoided = matches(profile.conditions, safety.avoidConditions);
    if (avoided.length) block('condition_match', `${name}命中已记录的禁用情况：${avoided.join('、')}。`);
    if (profile.allergyStatus === 'yes' && matches(['过敏体质'], safety.avoidConditions).length) block('allergy_prone_not_suitable', `${name}的官方资料标记为过敏体质人群不推荐食用。`);
    const caution = matches(profile.conditions, safety.cautionConditions);
    if (caution.length) warn('condition_caution', `${name}命中需专业确认的情况：${caution.join('、')}。`);
    if (matches(profile.medications, safety.drugInteractions).length) block('interaction_match', `${name}命中已记录的用药相互作用规则，请先咨询医生或药师。`);
    const population = (key: keyof IngredientSafety['population'], present: boolean, reason: SafetyReasonCode, warning: SafetyWarningCode, label: string) => {
      if (!present) return;
      if (safety.population[key] === 'no') block(reason, `${name}的来源资料标记为${label}不推荐食用。`);
      else warn(warning, `${name}的${label}适用性尚未确认，请先咨询医生或药师。`);
    };
    population('pregnancy', profile.pregnancy === 'yes', 'pregnancy_not_suitable', 'pregnancy_unknown', '孕期');
    population('breastfeeding', profile.breastfeeding === 'yes', 'breastfeeding_not_suitable', 'breastfeeding_unknown', '哺乳期');
    population('infantsToddlers', profile.ageGroup === 'infant_toddler', 'infants_toddlers_not_suitable', 'infants_toddlers_unknown', '婴幼儿');
    population('children', profile.ageGroup === 'child', 'children_not_suitable', 'children_unknown', '儿童或青少年');
    population('olderAdults', profile.ageGroup === 'older_adult', 'older_adult_not_suitable', 'older_adult_unknown', '老年人');
    if (profile.conditions.length && safety.reviews.condition !== 'reviewed') warn('condition_data_pending', `${name}的基础疾病禁忌资料尚未完成专业审校。`);
    if ((profile.medicationStatus === 'yes' || profile.medications.length) && safety.reviews.interaction !== 'reviewed') warn('interaction_data_pending', `${name}的药物相互作用资料尚未完成专业审校。`);
    if (profile.allergies.length && safety.reviews.allergen !== 'reviewed') warn('allergen_data_limited', `${name}目前只支持名称匹配，交叉过敏资料尚未审校。`);
    if (profile.allergyStatus === 'yes' && !profile.allergies.length) warn('allergy_details_required', '已填写有过敏史，具体过敏物仍待补充。');
    if (profile.conditionStatus === 'yes' && !profile.conditions.length) warn('condition_details_required', '已填写有基础疾病或特殊情况，具体信息仍待补充。');
    if (profile.medicationStatus === 'yes' && !profile.medications.length) warn('medication_details_required', '已填写正在用药，具体名称仍待补充。');
    if (safety.preparationWarnings.length) warn('preparation_warning', `${name}含来源记录的加工或食用注意事项，请在详情中核对。`);
    if (safety.reviews.preparation !== 'reviewed') warn('preparation_data_pending', `${name}的加工与食用注意事项尚未完成专业审校。`);
    if (safety.reviews.foodUse !== 'reviewed') warn('food_use_mapping_pending', `${name}的食用形态标签尚未完成来源映射复核。`);
    if (safety.reviews.catalog !== 'reviewed') warn('catalog_refresh_pending', `${name}的现行目录、部位和用途限制仍需发布前复核。`);
    warn('professional_review_pending', `${name}尚未完成逐字段专业审校，仅可用于目录浏览。`);
    const missing = missingSafetyDimensions(profile);
    if (missing.length) warn('profile_incomplete', `仍有安全信息未确认（${missing.join('、')}），不能判断个体适用性。`);
  }
  return Object.freeze({ ingredientId: item?.id ?? '', blocked: reasons.length > 0, status: reasons.length ? 'blocked' : warnings.length ? 'caution' : 'reference', reasons: Object.freeze(reasons), warnings: Object.freeze(warnings), reasonCodes: Object.freeze(reasonCodes), warningCodes: Object.freeze(warningCodes) });
}
