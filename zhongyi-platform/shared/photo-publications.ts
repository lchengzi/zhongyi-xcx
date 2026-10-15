import { choice, date, digest, id, invalid, list, literal, number, object, text, unique } from './workflow-response.js';

export interface PhotoPublicationSelection { candidateId: string; derivativeDigest: string; professionalVersion: number; rightsVersion: number; submissionVersion: number }
export interface PhotoPublicationInput { expectedVersion: number; action: 'publish' | 'withdraw'; selections: PhotoPublicationSelection[]; displayReviewConfirmed: true; visualPrivacyConfirmed: true; reason: string }
export interface PublishedPhoto {
  sha256: string; width: number; height: number; bytes: number; caption: string; part: string; processing: string;
  author: string; sourceUrl: string; license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0'; licenseUrl: string; modification: string;
}
export interface PhotoPublicationEntry extends PhotoPublicationSelection { photo: PublishedPhoto }
export interface PhotoPublicationRecord {
  schemaVersion: 'photo-publication.1'; ingredientId: string; name: string; baseReleaseId: string; version: number;
  action: PhotoPublicationInput['action']; entries: PhotoPublicationEntry[];
  displayReviewConfirmed: true; visualPrivacyConfirmed: true; reason: string;
  actorId: string; actorName: string; accountRevision: number; controlEpoch: string; createdAt: string; validUntil: string; previousDigest: string | null; digest: string;
}
export interface PublishedPhotoGallery {
  schemaVersion: 'public-photo-gallery.1'; ingredientId: string; name: string; baseReleaseId: string; version: number;
  publishedAt: string; validUntil: string; photos: PublishedPhoto[];
}
export interface PhotoPublicationHistory {
  schemaVersion: 'photo-publication-history.1'; enabled: boolean; ingredientId: string; name: string; baseReleaseId: string;
  control: { action: 'resume' | 'freeze'; epoch: string } | null; recoveryRequired: boolean; items: PhotoPublicationRecord[];
}
function boundedText(input: unknown, maximum: number): string {
  const value = text(input, maximum); if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value;
}
export function photoSelection(input: unknown): PhotoPublicationSelection {
  const value = object(input, 'candidateId derivativeDigest professionalVersion rightsVersion submissionVersion');
  return { candidateId: id(value.candidateId), derivativeDigest: digest(value.derivativeDigest), professionalVersion: number(value.professionalVersion), rightsVersion: number(value.rightsVersion), submissionVersion: number(value.submissionVersion) };
}
export function parsePhotoPublicationInput(input: unknown): PhotoPublicationInput {
  const value = object(input, 'expectedVersion action selections displayReviewConfirmed visualPrivacyConfirmed reason');
  const action = choice(value.action, ['publish', 'withdraw'] as const), selections = list(value.selections, photoSelection, 8);
  if (action === 'publish' ? !selections.length : selections.length !== 0) invalid(); unique(selections.map(item => item.candidateId));
  return { expectedVersion: number(value.expectedVersion, 0), action, selections,
    displayReviewConfirmed: literal(value.displayReviewConfirmed, true), visualPrivacyConfirmed: literal(value.visualPrivacyConfirmed, true), reason: boundedText(value.reason, 1000) };
}
export function parsePublishedPhoto(input: unknown): PublishedPhoto {
  const p = object(input, 'sha256 width height bytes caption part processing author sourceUrl license licenseUrl modification');
  const bound = (value: unknown, min: number, max: number) => { const result = number(value, min); return result <= max ? result : invalid(); };
  const license = choice(p.license, ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'] as const);
  const licenseUrl = { 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/' }[license];
  const sourceUrl = boundedText(p.sourceUrl, 2000);
  if (p.licenseUrl !== licenseUrl || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s<>"'\\]+\?oldid=\d+$/.test(sourceUrl)) invalid();
  return { sha256: digest(p.sha256), width: bound(p.width, 16, 1280), height: bound(p.height, 16, 1280), bytes: bound(p.bytes, 32, 524288),
    caption: boundedText(p.caption, 180), part: boundedText(p.part, 200), processing: boundedText(p.processing, 200), author: boundedText(p.author, 500),
    sourceUrl, license, licenseUrl, modification: boundedText(p.modification, 500) };
}
export function parsePhotoPublicationRecord(input: unknown): PhotoPublicationRecord {
  const r = object(input, 'schemaVersion ingredientId name baseReleaseId version action entries displayReviewConfirmed visualPrivacyConfirmed reason actorId actorName accountRevision controlEpoch createdAt validUntil previousDigest digest');
  const entries = list(r.entries, input => {
    const entry = object(input, 'candidateId derivativeDigest professionalVersion rightsVersion submissionVersion photo');
    return { ...photoSelection({ candidateId: entry.candidateId, derivativeDigest: entry.derivativeDigest, professionalVersion: entry.professionalVersion, rightsVersion: entry.rightsVersion, submissionVersion: entry.submissionVersion }), photo: parsePublishedPhoto(entry.photo) };
  }, 8);
  const action = choice(r.action, ['publish', 'withdraw'] as const);
  if (action === 'publish' ? !entries.length : entries.length !== 0) invalid(); unique(entries.map(item => item.candidateId)); unique(entries.map(item => item.photo.sha256));
  return { schemaVersion: literal(r.schemaVersion, 'photo-publication.1'), ingredientId: id(r.ingredientId), name: boundedText(r.name, 120), baseReleaseId: boundedText(r.baseReleaseId, 160),
    version: number(r.version), action, entries, displayReviewConfirmed: literal(r.displayReviewConfirmed, true), visualPrivacyConfirmed: literal(r.visualPrivacyConfirmed, true), reason: boundedText(r.reason, 1000),
    actorId: id(r.actorId), actorName: id(r.actorName), accountRevision: number(r.accountRevision), controlEpoch: id(r.controlEpoch), createdAt: date(r.createdAt), validUntil: date(r.validUntil),
    previousDigest: r.previousDigest === null ? null : digest(r.previousDigest), digest: digest(r.digest) };
}
export function parsePhotoPublicationHistory(input: unknown, ingredientId: string): PhotoPublicationHistory {
  const value = object(input, 'schemaVersion enabled ingredientId name baseReleaseId control recoveryRequired items');
  if (typeof value.enabled !== 'boolean' || typeof value.recoveryRequired !== 'boolean' || value.ingredientId !== ingredientId) invalid();
  const control = value.control === null ? null : object(value.control, 'action epoch');
  const items = list(value.items, parsePhotoPublicationRecord, 50), head = items[0];
  if (items.length !== Math.min(head?.version ?? 0, 50)) invalid();
  for (const [index, item] of items.entries()) {
    const older = items[index + 1];
    if (item.ingredientId !== ingredientId || item.version !== head.version - index || (older && item.previousDigest !== older.digest) ||
      (item.version === 1 && item.previousDigest !== null) || (item.version > 1 && item.previousDigest === null) ||
      (item.action === 'publish' && item.validUntil <= item.createdAt)) invalid();
  }
  return { schemaVersion: literal(value.schemaVersion, 'photo-publication-history.1'), enabled: value.enabled, ingredientId: id(value.ingredientId),
    name: boundedText(value.name, 120), baseReleaseId: boundedText(value.baseReleaseId, 160),
    control: control ? { action: choice(control.action, ['resume', 'freeze'] as const), epoch: id(control.epoch) } : null, recoveryRequired: value.recoveryRequired, items };
}
