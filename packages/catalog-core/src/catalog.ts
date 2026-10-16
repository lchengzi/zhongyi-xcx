import { parseIngredientSafety, SAFETY_RULES_VERSION } from './safety.js';
import type { IngredientSafety } from './safety.js';

export interface CatalogSource {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly checkedAt: string;
}

/** Historical public information. This model confers no professional approval. */
export interface Ingredient {
  readonly id: string;
  readonly name: string;
  readonly pinyin: string;
  readonly aliases: readonly string[];
  readonly latinName: string | null;
  readonly partText: string;
  readonly partReview: "pending" | "source_checked";
  readonly processingForms: readonly string[];
  readonly processingNote: string;
  readonly riskNotes: readonly string[];
  readonly restriction: string;
  readonly sources: readonly CatalogSource[];
  readonly sourceCheckedAt: string | null;
  readonly professionalReview: "pending";
  readonly image: null;
  readonly safety: IngredientSafety;
}

export interface CatalogSnapshot {
  readonly schemaVersion: "1.1.0";
  readonly rulesVersion: typeof SAFETY_RULES_VERSION;
  readonly contentVersion: string;
  readonly catalogAsOf: string;
  readonly boundaryNotice: string;
  readonly ingredients: readonly Ingredient[];
}

export type CatalogParseResult =
  | { readonly ok: true; readonly catalog: CatalogSnapshot }
  | { readonly ok: false; readonly issues: readonly string[] };

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${path}: unexpected or missing fields`);
  }
}

function text(value: unknown, path: string, maximum = 2000): string {
  if (typeof value !== "string" || value.trim() !== value || !value || value.length > maximum) {
    throw new Error(`${path}: expected nonempty bounded text`);
  }
  return value;
}

function array(value: unknown, path: string, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${path}: invalid array length or type`);
  }
  return Array.from(value, (item: unknown) => item);
}

function texts(value: unknown, path: string, minimum = 0): readonly string[] {
  return Object.freeze(array(value, path, minimum, 100).map((item, index) => text(item, `${path}[${index}]`)));
}

function date(value: unknown, path: string): string {
  const candidate = text(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new Error(`${path}: expected ISO date`);
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new Error(`${path}: invalid date`);
  }
  return candidate;
}

function identifier(value: unknown, path: string): string {
  const candidate = text(value, path, 80);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(candidate)) throw new Error(`${path}: invalid identifier`);
  return candidate;
}

function source(value: unknown, path: string): CatalogSource {
  const candidate = record(value, path);
  exact(candidate, ["id", "title", "publisher", "url", "checkedAt"], path);
  const url = text(candidate.url, `${path}.url`);
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?(?:\/[^\s<>"']*)?$/i.test(url)) {
    throw new Error(`${path}.url: expected public HTTPS address`);
  }
  return Object.freeze({
    id: identifier(candidate.id, `${path}.id`),
    title: text(candidate.title, `${path}.title`),
    publisher: text(candidate.publisher, `${path}.publisher`),
    url,
    checkedAt: date(candidate.checkedAt, `${path}.checkedAt`)
  });
}

function ingredient(value: unknown, path: string): Ingredient {
  const candidate = record(value, path);
  exact(candidate, [
    "id", "name", "pinyin", "aliases", "latinName", "partText", "partReview", "processingForms",
    "processingNote", "riskNotes", "restriction", "sources", "sourceCheckedAt", "professionalReview", "image", "safety"
  ], path);
  if (candidate.professionalReview !== "pending") throw new Error(`${path}.professionalReview: unsupported approval state`);
  if (candidate.image !== null) throw new Error(`${path}.image: no image approved for this schema`);
  if (candidate.partReview !== "pending" && candidate.partReview !== "source_checked") {
    throw new Error(`${path}.partReview: invalid review state`);
  }
  const sources = array(candidate.sources, `${path}.sources`, 1, 100).map((item, index) => source(item, `${path}.sources[${index}]`));
  if (new Set(sources.map((item) => item.id)).size !== sources.length) throw new Error(`${path}.sources: duplicate identifiers`);
  return Object.freeze({
    id: identifier(candidate.id, `${path}.id`),
    name: text(candidate.name, `${path}.name`, 100),
    pinyin: text(candidate.pinyin, `${path}.pinyin`, 200),
    aliases: texts(candidate.aliases, `${path}.aliases`),
    latinName: candidate.latinName === null ? null : text(candidate.latinName, `${path}.latinName`),
    partText: text(candidate.partText, `${path}.partText`),
    partReview: candidate.partReview,
    processingForms: texts(candidate.processingForms, `${path}.processingForms`),
    processingNote: text(candidate.processingNote, `${path}.processingNote`, 6000),
    riskNotes: texts(candidate.riskNotes, `${path}.riskNotes`, 1),
    restriction: text(candidate.restriction, `${path}.restriction`, 6000),
    sources: Object.freeze(sources),
    sourceCheckedAt: candidate.sourceCheckedAt === null ? null : date(candidate.sourceCheckedAt, `${path}.sourceCheckedAt`),
    professionalReview: "pending",
    image: null,
    safety: parseIngredientSafety(candidate.safety, `${path}.safety`)
  });
}

/** Treat imports, HTTP responses and caches alike as unknown at this boundary. */
export function parseCatalog(input: unknown): CatalogParseResult {
  try {
    const candidate = record(input, "catalog");
    exact(candidate, ["schemaVersion", "rulesVersion", "contentVersion", "catalogAsOf", "boundaryNotice", "ingredients"], "catalog");
    if (candidate.schemaVersion !== "1.1.0") throw new Error("catalog.schemaVersion: unsupported version");
    if (candidate.rulesVersion !== SAFETY_RULES_VERSION) throw new Error('catalog.rulesVersion: incompatible safety rules');
    const ingredients = array(candidate.ingredients, "catalog.ingredients", 1, 2000)
      .map((item, index) => ingredient(item, `catalog.ingredients[${index}]`));
    if (new Set(ingredients.map((item) => item.id)).size !== ingredients.length) {
      throw new Error("catalog.ingredients: duplicate identifiers");
    }
    return {
      ok: true,
      catalog: Object.freeze({
        schemaVersion: "1.1.0",
        rulesVersion: SAFETY_RULES_VERSION,
        contentVersion: text(candidate.contentVersion, "catalog.contentVersion", 100),
        catalogAsOf: date(candidate.catalogAsOf, "catalog.catalogAsOf"),
        boundaryNotice: text(candidate.boundaryNotice, "catalog.boundaryNotice", 6000),
        ingredients: Object.freeze(ingredients)
      })
    };
  } catch (error: unknown) {
    return { ok: false, issues: [error instanceof Error ? error.message : "catalog: unable to read data"] };
  }
}

function searchable(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
}

// Discovery-only spelling; not an identity, food-use or allergy equivalence.
// Public spelling evidence: Wuhan Botanical Garden, “一果多吃” (2021-08-30):
// https://wbg.cas.cn/KPPJ/zrjy/hbsjt/202108/t20210830_6177451.html
// Bind both fields so a withdrawn/renamed record cannot inherit this keyword.
function discoverySpellings(item: Ingredient): readonly string[] {
  return item.id === 'sang-shen' && item.name === '桑椹' ? ['桑葚'] : [];
}

/** Tokens match names, aliases, pinyin, Latin names and identity information. */
export function searchCatalog(catalog: CatalogSnapshot, query: string): readonly Ingredient[] {
  const terms = query.trim().split(/\s+/u).map(searchable).filter(Boolean);
  if (terms.length === 0) return catalog.ingredients;
  const joinedQuery = searchable(query);
  return catalog.ingredients.filter((item) => {
    const identity = [item.name, item.pinyin, ...item.aliases, ...discoverySpellings(item), item.latinName ?? "", item.partText, ...item.processingForms];
    const fields = identity.map(searchable);
    return fields.some((value) => value.includes(joinedQuery)) || terms.every((term) => fields.some((value) => value.includes(term)));
  });
}

export function findIngredient(catalog: CatalogSnapshot, id: string): Ingredient | undefined {
  return catalog.ingredients.find((item) => item.id === id);
}
