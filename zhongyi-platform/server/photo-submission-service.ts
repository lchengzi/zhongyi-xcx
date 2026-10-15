import type { Account } from '../shared/contracts.js';
import type { PhotoNoteDetail } from '../shared/photo-notes.js';
import { parsePrivatePhoto, type PrivatePhoto } from '../shared/private-photos.js';
import { PHOTO_SUBMISSION_SCHEMA, parsePhotoSubmissionDetail, parsePhotoSubmissionInput, type PhotoSubmission, type PhotoSubmissionDetail, type PhotoSubmissionInput } from '../shared/photo-submissions.js';
import { AccountError } from './auth.js';
import { photoSubmissionDigest } from './photo-submission-values.js';
import type { WriteAuthority } from './stores.js';

export interface PhotoSubmissionStore {
  detail(candidate: PrivatePhoto): Promise<PhotoSubmissionDetail>;
  submit(candidate: PrivatePhoto, input: unknown, authority: WriteAuthority): Promise<PhotoSubmission>;
}
export function ownPhotoSubmission(value: PrivatePhoto, raw: unknown, authority: WriteAuthority) {
  const candidate = parsePrivatePhoto(value); let input: PhotoSubmissionInput;
  try { input = parsePhotoSubmissionInput(raw); } catch { throw new AccountError(400, 'invalid_photo_submission', '请核对图片说明、部位、加工形态与依据，并确认送审。'); }
  return { candidate, input, authority: { account: { ...authority.account }, token: authority.token } };
}
export function photoSubmissionDetail(candidate: PrivatePhoto, notes: PhotoNoteDetail, history: PhotoSubmission[]): PhotoSubmissionDetail {
  if (history.some(item => item.candidate.ingredientId !== candidate.ingredientId)) throw new AccountError(409, 'photo_identity_changed', '候选编号已绑定另一食材，请登记新的候选编号。');
  return parsePhotoSubmissionDetail({ schemaVersion: PHOTO_SUBMISSION_SCHEMA, candidateId: candidate.id, bindingDigest: notes.bindingDigest,
    noteVersion: notes.version, noteDigest: notes.history[0]?.digest ?? null, noteBindingDigest: notes.history[0]?.bindingDigest ?? null, version: history[0]?.version ?? 0, history },
  { candidateId: candidate.id, bindingDigest: notes.bindingDigest, ingredientId: candidate.ingredientId });
}
export function nextPhotoSubmission(candidate: PrivatePhoto, current: PhotoSubmissionDetail, input: PhotoSubmissionInput, actor: Account, now: number): PhotoSubmission {
  if (current.bindingDigest !== input.bindingDigest || current.version !== input.expectedVersion || current.noteVersion !== input.expectedNoteVersion || current.noteDigest !== input.noteDigest || current.noteBindingDigest !== current.bindingDigest) {
    throw new AccountError(409, 'photo_submission_conflict', '图片资料、核对意见或送审版本已变化，请重新读取核对；本次未送审。');
  }
  if (current.version >= 10000) throw new AccountError(409, 'photo_submission_limit', '该候选送审历史达到上限，请联系管理员归档。');
  const payload = { candidate, bindingDigest: current.bindingDigest, version: current.version + 1, noteVersion: input.expectedNoteVersion, noteDigest: input.noteDigest,
    caption: input.caption, partDescription: input.partDescription, processingDescription: input.processingDescription, evidenceReference: input.evidenceReference, submissionConfirmed: input.submissionConfirmed,
    actorId: actor.id, actorName: actor.username, accountRevision: actor.revision, createdAt: new Date(now).toISOString() };
  return { ...payload, digest: photoSubmissionDigest(payload) };
}
