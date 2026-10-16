// Read-only research context, not a candidate original or publishable photo.
import { object } from './workflow-response.js';
import { photoId } from './private-photos.js';

export const EDITORIAL_REFERENCE_SCHEMA = 'private-editorial-reference.1';
export const MAX_REFERENCE_BYTES = 1024 * 1024;
export interface EditorialReference {
  id: string; ingredientId: string; name: string; sourceUrl: string; publisher: string; locator: string;
  author: string; declaredLicense: 'not-established' | 'CC-BY-4.0' | 'CC-BY-SA-4.0' | 'CC-BY-SA-2.5' | 'CC0-1.0'; licenseUrl: string | null;
  representation: 'source-page-image' | 'repository-display' | 'repository-original' | 'processed-display' | 'source-thumbnail';
  observation: string; concerns: string[]; sha256: string; bytes: number; width: number; height: number;
  publicationEligible: false;
}
export interface EditorialReferenceList { schemaVersion: typeof EDITORIAL_REFERENCE_SCHEMA; enabled: boolean; items: EditorialReference[] }
function invalid(): never { throw new Error('Invalid private research reference'); }
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) invalid();
  return value;
}
export function parseEditorialReference(raw: unknown): EditorialReference {
  const value = object(raw, 'id ingredientId name sourceUrl publisher locator author declaredLicense licenseUrl representation observation concerns sha256 bytes width height publicationEligible');
  if (!photoId(value.id) || !photoId(value.ingredientId) || value.publicationEligible !== false ||
    typeof value.sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.sha256)) invalid();
  const sourceUrl = text(value.sourceUrl, 600), url = new URL(sourceUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !['nieer.cas.cn', 'www.yixing.gov.cn', 'www.ebi.ac.uk', 'commons.wikimedia.org', 'www.news.cn', 'www.thepaper.cn', 'sourcing.hktdc.com'].includes(url.hostname)) invalid();
  if (url.search && !(url.hostname === 'commons.wikimedia.org' && /^\?oldid=[1-9][0-9]{0,14}$/.test(url.search))) invalid();
  const license = value.declaredLicense;
  if (license !== 'not-established' && license !== 'CC-BY-4.0' && license !== 'CC-BY-SA-4.0' && license !== 'CC-BY-SA-2.5' && license !== 'CC0-1.0') invalid();
  // A researched older licence is recorded truthfully, not relabelled as4.0.
  // This is private context only; no candidate or public-photo contract changes.
  if (license === 'CC-BY-SA-2.5' && (url.hostname !== 'commons.wikimedia.org' || !url.pathname.startsWith('/wiki/File:') || !/^\?oldid=[1-9][0-9]{0,14}$/.test(url.search))) invalid();
  const licenseUrl = license === 'not-established' ? null : license === 'CC-BY-4.0' ? 'https://creativecommons.org/licenses/by/4.0/' : license === 'CC-BY-SA-4.0' ? 'https://creativecommons.org/licenses/by-sa/4.0/' : license === 'CC-BY-SA-2.5' ? 'https://creativecommons.org/licenses/by-sa/2.5/' : 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (value.licenseUrl !== licenseUrl || !Array.isArray(value.concerns) || !value.concerns.length || value.concerns.length > 10) invalid();
  const representation = value.representation;
  if (representation !== 'source-page-image' && representation !== 'repository-display' && representation !== 'repository-original' && representation !== 'processed-display' && representation !== 'source-thumbnail') invalid();
  if (representation === 'repository-original' && (url.hostname !== 'commons.wikimedia.org' || !url.pathname.startsWith('/wiki/File:') || !/^\?oldid=[1-9][0-9]{0,14}$/.test(url.search))) invalid();
  // A news article is research provenance, not an open image licence. Only
  // concrete article URLs are accepted; media URLs and arbitrary paths are not.
  if (url.hostname === 'www.news.cn' && (!/^\/(?:info\/)?\d{8}\/[a-f0-9]{32}\/c\.html$/.test(url.pathname) ||
    representation !== 'source-page-image' || license !== 'not-established')) invalid();
  if (url.hostname === 'www.thepaper.cn' && (!/^\/newsDetail_forward_[1-9][0-9]{0,14}$/.test(url.pathname) ||
    representation !== 'source-page-image' || license !== 'not-established')) invalid();
  // A supplier listing supplies private visual context, never an inferred image
  // licence, food identity or approval. Keep this researched page explicit.
  if (url.hostname === 'sourcing.hktdc.com' && (url.pathname !== '/en/Product-Detail/Lanzhou-Fresh-Lily-Bulb-1X1K417Q' ||
    representation !== 'source-page-image' || license !== 'not-established')) invalid();
  if (representation === 'source-thumbnail' && (url.hostname !== 'commons.wikimedia.org' || !url.pathname.startsWith('/wiki/File:') || !/^\?oldid=[1-9][0-9]{0,14}$/.test(url.search))) invalid();
  const width = integer(value.width, 12000), height = integer(value.height, 12000);
  if (width * height > 16_000_000) invalid();
  return { id: value.id, ingredientId: value.ingredientId, name: text(value.name, 100), sourceUrl, publisher: text(value.publisher, 200), locator: text(value.locator, 600),
    author: text(value.author, 400), declaredLicense: license, licenseUrl, representation, observation: text(value.observation), concerns: value.concerns.map(item => text(item)),
    sha256: value.sha256, bytes: integer(value.bytes, MAX_REFERENCE_BYTES), width, height, publicationEligible: false };
}
export function parseEditorialReferenceList(raw: unknown): EditorialReferenceList {
  const value = object(raw, 'schemaVersion enabled items');
  if (value.schemaVersion !== EDITORIAL_REFERENCE_SCHEMA || typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.items) || value.items.length > 30 || (!value.enabled && value.items.length)) invalid();
  const items = value.items.map(parseEditorialReference);
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  return { schemaVersion: EDITORIAL_REFERENCE_SCHEMA, enabled: value.enabled, items };
}
