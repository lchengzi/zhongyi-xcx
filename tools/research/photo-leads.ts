// Private editorial research only. This module grants no image publication rights.
export const photoBaseline = [
  { path: 'zhongyi/content-private/media-candidates/food-forms/food-form-catalog.json', sha256: 'sha256:ccd0f652e2b9f6b3544ac58467b2f0a45d610de428832157de43a14d3580202c' },
  { path: 'zhongyi/data/ingredients.js', sha256: 'sha256:5b21a1e30d592cfa00017ad9021d591219cb0d74fb86c1f3ab5fad6c7115c092' },
  { path: 'zhongyi/content-private/research-refresh/2026-10-10-polyu-photo-leads.json', sha256: 'sha256:458050ae81d018375f87802c2587ce0c37feb51fa3a4181ee22170e395f7dcf5' }
] as const;
export const photoResearchPath = 'zhongyi/content-private/research-refresh/2026-10-11-root-rhizome-photo-leads.json';
export interface PhotoLead {
  id: string; ingredientId: string;
  source: { publisher: string; title: string; url: string; revisionUrl: string | null; relevantTextRead: true; claim: string };
  media: { links: string[]; access: 'reference_without_reviewable_pixels' | 'cache_miss' | 'not_requested';
    visualReviewState: 'not_performed'; localAsset: null; reportedWidth: number | null; reportedHeight: number | null;
    declaredAuthor: string | null; sourceDate: string | null; containsLocationMetadata: boolean | null };
  rights: { state: 'declared_cc_by_sa_4' | 'requires_prior_consent' | 'restricted_reuse'; noticeUrl: string;
    licenseUrl: string | null; noticeRead: true; projectReview: 'pending'; permissionObtained: false; notes: string };
  intendedUse: string; limitations: string[]; verificationState: 'pending'; publicationEligible: false;
}
export interface PhotoRightsAddendum {
  recordPath: string; recordSha256: string; affectedIngredientIds: string[]; noticeUrl: string; noticeRead: true;
  previousObservation: 'timeout_not_read'; newObservation: 'notice_read_requires_permission';
  requiredAction: 'obtain_permission_before_reuse'; permissionObtained: false; note: string;
}
export interface PhotoResearchBatch {
  schemaVersion: 'private-photo-research.1'; checkedAt: string; scope: 'private_research_only'; publicationEligible: false;
  runtimePlacements: []; doesNotCloseGaps: true; baselineBindings: { path: string; sha256: string }[];
  leads: PhotoLead[]; rightsAddenda: PhotoRightsAddendum[];
}
function invalid(): never { throw new Error('Invalid private photo research record; no publication or approval is inferred.'); }
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const expected = keys.split(' ');
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return invalid();
  return value;
}
function literal<T extends string | boolean | null>(value: unknown, expected: T): T { return value === expected ? expected : invalid(); }
function choice<T extends string>(value: unknown, options: readonly T[]): T { return options.find((item) => item === value) ?? invalid(); }
function list<T>(value: unknown, parse: (entry: unknown) => T, min: number, max: number): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid();
  return value.map((entry: unknown) => parse(entry));
}
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) invalid(); }
function date(value: unknown): string {
  const string = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(string) || !Number.isFinite(Date.parse(string)) || new Date(string).toISOString().slice(0, 10) !== string) return invalid();
  return string;
}
function dimension(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : invalid();
}
function url(value: unknown, hosts: readonly string[], query = false): string {
  const string = text(value, 2000); let parsed: URL;
  try { parsed = new URL(string); } catch { return invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash || (!query && parsed.search) || !hosts.includes(parsed.hostname)) return invalid();
  return string;
}
const sourceHosts = ['commons.wikimedia.org', 'herbaltcm.sn.polyu.edu.hk', 'www.tsumura.co.jp'];
const mediaHost = (source: string): string => new URL(source).hostname === 'commons.wikimedia.org' ? 'upload.wikimedia.org' : new URL(source).hostname;
function parseLead(value: unknown): PhotoLead {
  const item = object(value, 'id ingredientId source media rights intendedUse limitations verificationState publicationEligible');
  const source = object(item.source, 'publisher title url revisionUrl relevantTextRead claim');
  const sourceUrl = url(source.url, sourceHosts);
  const host = new URL(sourceUrl).hostname;
  const revisionUrl = source.revisionUrl === null ? null : url(source.revisionUrl, [host], true);
  if (revisionUrl !== null) {
    const revision = new URL(revisionUrl); const page = new URL(sourceUrl);
    if (host !== 'commons.wikimedia.org' || revision.pathname !== '/w/index.php' || page.pathname !== '/wiki/' + revision.searchParams.get('title') ||
      !/^\d+$/u.test(revision.searchParams.get('oldid') || '') || [...revision.searchParams.keys()].sort().join() !== 'oldid,title') invalid();
  }
  const media = object(item.media, 'links access visualReviewState localAsset reportedWidth reportedHeight declaredAuthor sourceDate containsLocationMetadata');
  const links = list(media.links, (entry) => url(entry, [mediaHost(sourceUrl)]), 1, 6); unique(links);
  const width = dimension(media.reportedWidth); const height = dimension(media.reportedHeight);
  if ((width === null) !== (height === null)) invalid();
  const location = media.containsLocationMetadata;
  if (location !== null && typeof location !== 'boolean') invalid();
  const rights = object(item.rights, 'state noticeUrl licenseUrl noticeRead projectReview permissionObtained notes');
  const state = choice(rights.state, ['declared_cc_by_sa_4', 'requires_prior_consent', 'restricted_reuse']);
  const licenseUrl = rights.licenseUrl === null ? null : url(rights.licenseUrl, ['creativecommons.org']);
  if (state === 'declared_cc_by_sa_4' ? host !== 'commons.wikimedia.org' || licenseUrl !== 'https://creativecommons.org/licenses/by-sa/4.0/' : licenseUrl !== null) invalid();
  if ((host === 'herbaltcm.sn.polyu.edu.hk' && state !== 'requires_prior_consent') || (host === 'www.tsumura.co.jp' && state !== 'restricted_reuse')) invalid();
  const id = text(item.id, 120); const ingredientId = text(item.ingredientId, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ingredientId)) invalid();
  return { id, ingredientId,
    source: { publisher: text(source.publisher, 200), title: text(source.title, 300), url: sourceUrl, revisionUrl,
      relevantTextRead: literal(source.relevantTextRead, true), claim: text(source.claim) },
    media: { links, access: choice(media.access, ['reference_without_reviewable_pixels', 'cache_miss', 'not_requested']),
      visualReviewState: literal(media.visualReviewState, 'not_performed'), localAsset: literal(media.localAsset, null), reportedWidth: width, reportedHeight: height,
      declaredAuthor: media.declaredAuthor === null ? null : text(media.declaredAuthor, 200), sourceDate: media.sourceDate === null ? null : date(media.sourceDate), containsLocationMetadata: location },
    rights: { state, noticeUrl: url(rights.noticeUrl, [host]), licenseUrl, noticeRead: literal(rights.noticeRead, true), projectReview: literal(rights.projectReview, 'pending'),
      permissionObtained: literal(rights.permissionObtained, false), notes: text(rights.notes) },
    intendedUse: text(item.intendedUse), limitations: list(item.limitations, (entry) => text(entry), 2, 12),
    verificationState: literal(item.verificationState, 'pending'), publicationEligible: literal(item.publicationEligible, false) };
}
function parseAddendum(value: unknown): PhotoRightsAddendum {
  const item = object(value, 'recordPath recordSha256 affectedIngredientIds noticeUrl noticeRead previousObservation newObservation requiredAction permissionObtained note');
  const affected = list(item.affectedIngredientIds, (entry) => choice(entry, ['tian-dong', 'gou-qi-zi', 'di-huang']), 3, 3); unique(affected);
  return { recordPath: literal(item.recordPath, photoBaseline[2].path), recordSha256: literal(item.recordSha256, photoBaseline[2].sha256), affectedIngredientIds: affected,
    noticeUrl: literal(item.noticeUrl, 'https://herbaltcm.sn.polyu.edu.hk/copyright'), noticeRead: literal(item.noticeRead, true),
    previousObservation: literal(item.previousObservation, 'timeout_not_read'), newObservation: literal(item.newObservation, 'notice_read_requires_permission'),
    requiredAction: literal(item.requiredAction, 'obtain_permission_before_reuse'), permissionObtained: literal(item.permissionObtained, false), note: text(item.note) };
}
export function parsePhotoResearch(value: unknown): PhotoResearchBatch {
  const batch = object(value, 'schemaVersion checkedAt scope publicationEligible runtimePlacements doesNotCloseGaps baselineBindings leads rightsAddenda');
  if (!Array.isArray(batch.runtimePlacements) || batch.runtimePlacements.length !== 0) invalid();
  const bindings = list(batch.baselineBindings, (entry) => {
    const binding = object(entry, 'path sha256'); return { path: text(binding.path), sha256: text(binding.sha256) };
  }, 3, 3);
  if (JSON.stringify(bindings) !== JSON.stringify(photoBaseline)) invalid();
  const leads = list(batch.leads, parseLead, 1, 100); unique(leads.map((lead) => lead.id)); unique(leads.map((lead) => lead.source.url));
  const rightsAddenda = list(batch.rightsAddenda, parseAddendum, 1, 1);
  return { schemaVersion: literal(batch.schemaVersion, 'private-photo-research.1'), checkedAt: date(batch.checkedAt), scope: literal(batch.scope, 'private_research_only'),
    publicationEligible: literal(batch.publicationEligible, false), runtimePlacements: [], doesNotCloseGaps: literal(batch.doesNotCloseGaps, true), baselineBindings: bindings, leads, rightsAddenda };
}
