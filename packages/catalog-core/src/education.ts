/** Public API v1 education document. It is separate from deterministic rules. */
export const EDUCATION_BOUNDARY = '非医疗食养教育，不用于诊断、治疗、个体化开方或用药指导。';
export const EDUCATION_PATH = '/api/v1/public/education/';

export interface EducationBinding {
  readonly ingredientId: string;
  readonly name: string;
  readonly baseReleaseId: string;
}
export interface CatalogRelease {
  readonly protocolVersion: 1;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly contentVersion: string;
}
export interface EducationSource {
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly locator: string;
  readonly checkedAt: string;
  readonly validUntil: string;
}
export interface EducationDocument extends EducationBinding {
  readonly scope: 'ingredient_education';
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly contentRevision: number;
  readonly publishedAt: string;
  readonly ediblePart: string;
  readonly latinName: string;
  readonly educationText: string;
  readonly safetyText: string;
  readonly sources: readonly EducationSource[];
  readonly boundary: typeof EDUCATION_BOUNDARY;
}
export type EducationParseResult =
  | { readonly ok: true; readonly document: EducationDocument }
  | { readonly ok: false; readonly errorCode: 'invalid_payload' | 'identity_mismatch' | 'source_expired' };

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_payload');
  return Object.fromEntries(Object.entries(input));
}
function exact(input: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(input, key))) throw new Error('invalid_payload');
}
function text(input: unknown, maximum: number, empty = false): string {
  if (typeof input !== 'string' || input.trim() !== input || (!empty && !input) || input.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) throw new Error('invalid_payload');
  return input;
}
function version(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) throw new Error('invalid_payload');
  return input;
}
function iso(input: unknown): string {
  const value = text(input, 24);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('invalid_payload');
  return value;
}

/** No credentials, path, query, fragment or nonstandard port in a service origin. */
export function publicContentOrigin(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 253 || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?$/i.test(input)) return null;
  const hostname = input.slice(8).replace(/:443$/, '');
  if (hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return input.replace(/:443$/, '').toLowerCase();
}
function sourceUrl(input: unknown): string {
  const value = text(input, 2000);
  const parts = /^(https:\/\/[a-z0-9.-]+(?::443)?)(?:[/?#][^\s<>"'\\]*)?$/i.exec(value);
  if (!parts || !publicContentOrigin(parts[1])) throw new Error('invalid_payload');
  return value;
}
export function parseEducationBinding(input: unknown): EducationBinding {
  const value = record(input);
  exact(value, ['ingredientId', 'name', 'baseReleaseId']);
  const ingredientId = text(value.ingredientId, 80);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(ingredientId)) throw new Error('invalid_payload');
  return Object.freeze({ ingredientId, name: text(value.name, 120), baseReleaseId: text(value.baseReleaseId, 160) });
}

/** Bundled, build-verified release pin, not a value supplied by the server. */
export function parseCatalogRelease(input: unknown, expectedContentVersion: string): CatalogRelease | null {
  try {
    const value = record(input);
    exact(value, ['protocolVersion', 'releaseId', 'releaseDigest', 'contentVersion']);
    if (value.protocolVersion !== 1 || value.contentVersion !== expectedContentVersion) return null;
    const releaseId = text(value.releaseId, 160), releaseDigest = text(value.releaseDigest, 71);
    if (!/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(releaseId) || !/^sha256:[a-f0-9]{64}$/.test(releaseDigest)) return null;
    return Object.freeze({ protocolVersion: 1, releaseId, releaseDigest, contentVersion: text(value.contentVersion, 160) });
  } catch { return null; }
}

/** Validate wire shape and local identity. Professional approval is enforced by
 * the publishing service, not inferred from text or a client-side status flag. */
export function parseEducation(input: unknown, expected: EducationBinding, now: number): EducationParseResult {
  try {
    if (!Number.isFinite(now) || now < 0) throw new Error('invalid_payload');
    const binding = parseEducationBinding(expected);
    const value = record(input);
    exact(value, ['scope', 'ingredientId', 'name', 'snapshotId', 'snapshotVersion', 'contentRevision', 'baseReleaseId', 'publishedAt', 'ediblePart', 'latinName', 'educationText', 'safetyText', 'sources', 'boundary']);
    if (value.scope !== 'ingredient_education' || value.boundary !== EDUCATION_BOUNDARY) throw new Error('invalid_payload');
    if (value.ingredientId !== binding.ingredientId || value.name !== binding.name || value.baseReleaseId !== binding.baseReleaseId) return { ok: false, errorCode: 'identity_mismatch' };
    const snapshotId = text(value.snapshotId, 80);
    if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(snapshotId)) throw new Error('invalid_payload');
    const publishedAt = iso(value.publishedAt);
    if (Date.parse(publishedAt) > now) throw new Error('invalid_payload');
    if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 30) throw new Error('invalid_payload');
    const sources = Object.freeze(Array.from(value.sources, (item: unknown): EducationSource => {
      const source = record(item);
      exact(source, ['title', 'publisher', 'url', 'locator', 'checkedAt', 'validUntil']);
      const checkedAt = iso(source.checkedAt), validUntil = iso(source.validUntil);
      if (Date.parse(checkedAt) > now || Date.parse(validUntil) <= Date.parse(checkedAt)) throw new Error('invalid_payload');
      return Object.freeze({ title: text(source.title, 300), publisher: text(source.publisher, 300), url: sourceUrl(source.url), locator: text(source.locator, 2000), checkedAt, validUntil });
    }));
    if (sources.some(source => Date.parse(source.validUntil) <= now)) return { ok: false, errorCode: 'source_expired' };
    return { ok: true, document: Object.freeze({ ...binding, scope: 'ingredient_education', snapshotId,
      snapshotVersion: version(value.snapshotVersion), contentRevision: version(value.contentRevision), publishedAt,
      ediblePart: text(value.ediblePart, 1000), latinName: text(value.latinName, 500, true),
      educationText: text(value.educationText, 6000), safetyText: text(value.safetyText, 4000), sources, boundary: EDUCATION_BOUNDARY }) };
  } catch { return { ok: false, errorCode: 'invalid_payload' }; }
}
