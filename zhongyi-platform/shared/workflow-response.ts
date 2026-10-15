// Browser-safe response boundary. Shape/identity checks do not grant approval,
// recompute server digests, or authenticate the source of the response.
import type { ContentDraft, ContentRevision, DraftContent, DraftDetail, Ingredient, IngredientPage, ManagedSource, ReviewTask, SourcePage, ReviewTaskPage } from './contracts.js';

export function invalid(): never { throw new Error('Invalid workflow response'); }
export function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const names = keys.split(' ');
  if (Object.keys(value).length !== names.length || names.some(key => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return invalid();
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 80);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result) ? result : invalid();
}
export function number(value: unknown, minimum = 1): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : invalid();
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T { return values.find(item => item === value) ?? invalid(); }
export function literal<T extends string | boolean>(value: unknown, expected: T): T { return value === expected ? expected : invalid(); }
export function date(value: unknown): string {
  const result = text(value, 24);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) && Number.isFinite(Date.parse(result)) && new Date(result).toISOString() === result ? result : invalid();
}
export function digest(value: unknown): string { const result = text(value, 71); return /^sha256:[a-f0-9]{64}$/.test(result) ? result : invalid(); }
export function list<T>(value: unknown, parse: (entry: unknown) => T, maximum: number): T[] {
  return Array.isArray(value) && value.length <= maximum ? value.map((entry: unknown) => parse(entry)) : invalid();
}
export function unique(values: readonly (string | number)[]): void { if (new Set(values).size !== values.length) invalid(); }
function url(value: unknown): string {
  const result = text(value, 1000); let parsed: URL;
  try { parsed = new URL(result); } catch { return invalid(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid();
  return result;
}

export function parseManagedSource(value: unknown, expected?: { id: string; revision?: number }): ManagedSource {
  const item = object(value, 'id revision title publisher url recordedBy recordedAt verificationState visibility');
  const source: ManagedSource = { id: id(item.id), revision: number(item.revision), title: text(item.title, 200), publisher: text(item.publisher, 120),
    url: url(item.url), recordedBy: text(item.recordedBy, 80), recordedAt: date(item.recordedAt),
    verificationState: literal(item.verificationState, 'pending'), visibility: literal(item.visibility, 'private') };
  if (expected && (source.id !== expected.id || (expected.revision !== undefined && source.revision !== expected.revision))) invalid();
  return source;
}
function content(value: unknown): DraftContent {
  const item = object(value, 'ediblePart latinName educationText safetyText sourceRefs');
  const refs = list(item.sourceRefs, entry => { const ref = object(entry, 'id revision locator');
    return { id: id(ref.id), revision: number(ref.revision), locator: text(ref.locator, 400) }; }, 10);
  unique(refs.map(ref => ref.id));
  return { ediblePart: text(item.ediblePart, 200, false), latinName: text(item.latinName, 200, false), educationText: text(item.educationText, 1600, false),
    safetyText: text(item.safetyText, 1000, false), sourceRefs: refs };
}
const revisionKeys = 'ingredientId revision content sources digest baseReleaseId authorId author createdAt';
function revisionFields(item: Record<string, unknown>, ingredientId: string, expectedRevision?: number): ContentRevision {
  const result: ContentRevision = { ingredientId: id(item.ingredientId), revision: number(item.revision), content: content(item.content),
    sources: list(item.sources, entry => parseManagedSource(entry), 10), digest: digest(item.digest), baseReleaseId: text(item.baseReleaseId, 200),
    authorId: id(item.authorId), author: text(item.author, 80), createdAt: date(item.createdAt) };
  if (result.ingredientId !== ingredientId || (expectedRevision !== undefined && result.revision !== expectedRevision)) invalid();
  unique(result.sources.map(source => source.id));
  // Missing fixed source objects remain displayable as an explicit gap. The
  // review UI must still block acceptance via hasFixedSourceReferences.
  if (result.sources.some(source => !result.content.sourceRefs.some(ref => ref.id === source.id && ref.revision === source.revision))) invalid();
  return result;
}
export function parseContentRevision(value: unknown, ingredientId: string, expectedRevision?: number): ContentRevision {
  return revisionFields(object(value, revisionKeys), ingredientId, expectedRevision);
}
export function parseContentDraft(value: unknown, ingredientId: string): ContentDraft {
  return draftFields(value, ingredientId, false);
}
// Read-only review views can expose missing fixed-source objects as gaps. This
// does not change strict draft/save parsing or the UI's acceptance source gate.
export function parseReviewDraft(value: unknown, ingredientId: string): ContentDraft {
  return draftFields(value, ingredientId, true);
}
function draftFields(value: unknown, ingredientId: string, allowSourceGaps: boolean): ContentDraft {
  const item = object(value, `${revisionKeys} lockVersion state ownerId owner updatedAt visibility professionalReviewState publicationEnabled`);
  const revision = revisionFields(item, ingredientId);
  if (!allowSourceGaps && revision.sources.length !== revision.content.sourceRefs.length) invalid();
  const result: ContentDraft = { ...revision, lockVersion: number(item.lockVersion), state: choice(item.state, ['draft', 'submitted', 'changes_requested', 'editorial_accepted']),
    ownerId: id(item.ownerId), owner: text(item.owner, 80), updatedAt: date(item.updatedAt), visibility: literal(item.visibility, 'private'),
    professionalReviewState: literal(item.professionalReviewState, 'pending'), publicationEnabled: literal(item.publicationEnabled, false) };
  if (result.lockVersion < result.revision) invalid();
  return result;
}
export function parseSavedDraft(value: unknown, ingredientId: string, previous: ContentDraft | null, input: DraftContent): ContentDraft {
  const draft = parseContentDraft(value, ingredientId);
  const normalized: DraftContent = { ediblePart: input.ediblePart.trim(), latinName: input.latinName.trim(), educationText: input.educationText.trim(),
    safetyText: input.safetyText.trim(), sourceRefs: input.sourceRefs.map(ref => ({ id: ref.id, revision: ref.revision, locator: ref.locator.trim() })) };
  if (draft.state !== 'draft' || draft.lockVersion !== (previous?.lockVersion || 0) + 1 || draft.revision !== (previous?.revision || 0) + 1 ||
    JSON.stringify(draft.content) !== JSON.stringify(normalized) || (previous && (draft.baseReleaseId !== previous.baseReleaseId || draft.ownerId !== previous.ownerId))) invalid();
  return draft;
}
export function parseReviewTask(value: unknown, expectedId?: string): ReviewTask {
  const item = object(value, 'id ingredientId ingredientName revision digest status submittedById submittedBy submittedAt reviewedBy reviewedAt comment');
  const task: ReviewTask = { id: id(item.id), ingredientId: id(item.ingredientId), ingredientName: text(item.ingredientName, 200), revision: number(item.revision), digest: digest(item.digest),
    status: choice(item.status, ['pending', 'accepted', 'returned']), submittedById: id(item.submittedById), submittedBy: text(item.submittedBy, 80), submittedAt: date(item.submittedAt),
    reviewedBy: item.reviewedBy === null ? null : text(item.reviewedBy, 80), reviewedAt: item.reviewedAt === null ? null : date(item.reviewedAt),
    comment: item.comment === null ? null : text(item.comment, 1000) };
  if ((expectedId !== undefined && task.id !== expectedId) || (task.status === 'pending'
    ? task.reviewedBy !== null || task.reviewedAt !== null || task.comment !== null
    : task.reviewedBy === null || task.reviewedAt === null || task.comment === null)) invalid();
  return task;
}
export function parseDraftDetail(value: unknown, ingredientId: string): DraftDetail {
  const item = object(value, 'draft revisions tasks contributorIds');
  const result: DraftDetail = { draft: item.draft === null ? null : parseContentDraft(item.draft, ingredientId),
    revisions: list(item.revisions, entry => parseContentRevision(entry, ingredientId), 20), tasks: list(item.tasks, entry => parseReviewTask(entry), 20),
    contributorIds: list(item.contributorIds, id, 100000) };
  unique(result.revisions.map(revision => revision.revision)); unique(result.tasks.map(task => task.id)); unique(result.contributorIds);
  if (result.tasks.some(task => task.ingredientId !== ingredientId)) invalid();
  const draft = result.draft;
  if (draft) {
    const current = result.revisions.find(revision => revision.revision === draft.revision);
    if (!current || current.digest !== draft.digest || current.baseReleaseId !== draft.baseReleaseId ||
      JSON.stringify(current.content) !== JSON.stringify(draft.content) || JSON.stringify(current.sources) !== JSON.stringify(draft.sources) ||
      current.authorId !== draft.authorId || current.author !== draft.author || current.createdAt !== draft.createdAt ||
      !result.contributorIds.includes(draft.authorId)) invalid();
  } else if (result.revisions.length || result.tasks.length || result.contributorIds.length) invalid();
  return result;
}
export function parseDraftSubmission(value: unknown, ingredientId: string, expected: ContentDraft): { draft: ContentDraft; task: ReviewTask } {
  const item = object(value, 'draft task'), draft = parseContentDraft(item.draft, ingredientId), task = parseReviewTask(item.task);
  if (draft.state !== 'submitted' || task.status !== 'pending' || task.ingredientId !== ingredientId || task.revision !== draft.revision || task.digest !== draft.digest ||
    draft.revision !== expected.revision || draft.digest !== expected.digest || draft.lockVersion !== expected.lockVersion + 1 ||
    JSON.stringify(draft.content) !== JSON.stringify(expected.content) || JSON.stringify(draft.sources) !== JSON.stringify(expected.sources)) invalid();
  return { draft, task };
}
function page<T>(value: unknown, parse: (entry: unknown) => T, expected?: { page: number; pageSize: number }): { items: T[]; total: number; page: number; pageSize: number } {
  const item = object(value, 'items total page pageSize');
  const result = { items: list(item.items, parse, 50), total: number(item.total, 0), page: number(item.page), pageSize: number(item.pageSize) };
  if (result.pageSize > 50 || result.items.length > result.pageSize || result.items.length > result.total ||
    (expected && (result.page !== expected.page || result.pageSize !== expected.pageSize))) invalid();
  return result;
}
export function parseSourcePage(value: unknown, expected?: { page: number; pageSize: number }): SourcePage {
  const result = page(value, entry => parseManagedSource(entry), expected); unique(result.items.map(source => source.id)); return result;
}
export function parseReviewTaskPage(value: unknown, expected: { page: number; pageSize: number; status: ReviewTask['status'] }): ReviewTaskPage {
  const result = page(value, entry => parseReviewTask(entry), expected); unique(result.items.map(task => task.id));
  if (result.items.some(task => task.status !== expected.status)) invalid(); return result;
}
export function parseIngredient(value: unknown): Ingredient {
  const item = object(value, 'id name pinyin aliases batch latinName ediblePart identityState professionalReviewState restriction sources');
  return { id: id(item.id), name: text(item.name, 200), pinyin: text(item.pinyin, 200, false), aliases: list(item.aliases, entry => text(entry, 200), 100),
    batch: text(item.batch, 200, false), latinName: text(item.latinName, 1000, false), ediblePart: text(item.ediblePart, 2000, false),
    identityState: text(item.identityState, 80), professionalReviewState: text(item.professionalReviewState, 80), restriction: text(item.restriction, 4000, false),
    sources: list(item.sources, entry => { const source = object(entry, 'id title publisher url status checkedAt');
      return { id: id(source.id), title: text(source.title, 1000), publisher: text(source.publisher, 1000), url: url(source.url),
        status: text(source.status, 80), checkedAt: text(source.checkedAt, 80, false) }; }, 100) };
}
export function parseIngredientPage(value: unknown, expected: { page: number; pageSize: number }): IngredientPage {
  const result = page(value, parseIngredient, expected); unique(result.items.map(item => item.id)); return result;
}
