import type { Row, TableName } from './migration-snapshot.js';
import { photoRightsFrom } from './photo-rights-values.js';
import { photoSubmissionFrom } from './photo-submission-values.js';
import { photoNoteFrom } from './photo-note-values.js';
import type { PhotoRightsReview } from '../shared/photo-rights.js';

// A correctly rehashed backup must still preserve the original source/submitter
// and independence relationships. Later role changes do not erase old history.
export function validPhotoRightsTables(tables: Record<TableName, Row[]>): boolean {
  try {
    const users = new Map(tables.users.map(row => [row.id, row]));
    const notes = tables.photo_notes.map(photoNoteFrom), submissions = tables.photo_submissions.map(photoSubmissionFrom);
    const sources = new Map(submissions.map(item => [`${item.candidate.id}:${item.version}`, item]));
    const heads = new Map<string, PhotoRightsReview>();
    for (const row of tables.photo_rights_reviews.slice().sort((a, b) => String(a.candidate_id).localeCompare(String(b.candidate_id)) || Number(a.version) - Number(b.version))) {
      const item = photoRightsFrom(row), previous = heads.get(item.candidateId), actor = users.get(item.actorId), submission = sources.get(`${item.candidateId}:${item.submissionVersion}`);
      if (!actor || actor.username !== item.actorName || item.accountRevision > Number(actor.revision) || item.version !== (previous?.version ?? 0) + 1 || item.version > 10000 ||
        !submission || item.ingredientId !== submission.candidate.ingredientId || item.submissionDigest !== submission.digest || item.bindingDigest !== submission.bindingDigest ||
        (previous && (previous.ingredientId !== item.ingredientId || previous.submissionVersion > item.submissionVersion)) || Date.parse(item.createdAt) < Date.parse(submission.createdAt)) return false;
      if (item.decision === 'revoke') {
        if (previous?.decision !== 'approve' || previous.submissionVersion !== item.submissionVersion || previous.submissionDigest !== item.submissionDigest || (item.actorRole !== 'admin' && previous.actorId !== item.actorId)) return false;
      } else {
        if (submissions.some(s => s.candidate.id === item.candidateId && s.version <= item.submissionVersion && s.actorId === item.actorId) ||
          notes.some(n => n.candidate.id === item.candidateId && n.version <= submission.noteVersion && n.actorId === item.actorId)) return false;
        if (item.decision === 'approve' && (Date.parse(item.validUntil) <= Date.parse(item.createdAt) || Date.parse(item.validUntil) > Date.parse(item.createdAt) + 366 * 86400000)) return false;
      }
      heads.set(item.candidateId, item);
    }
    return true;
  } catch { return false; }
}
