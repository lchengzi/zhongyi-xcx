import type { Account, ProfessionalQualification } from '../shared/contracts.js';
import type { PhotoNote } from '../shared/photo-notes.js';
import type { PhotoSubmission } from '../shared/photo-submissions.js';
import type { PhotoRightsReview } from '../shared/photo-rights.js';
import type { PhotoProfessionalReview } from '../shared/photo-professional.js';
import { verifiedPhotoProfessionalReview } from './photo-professional-policy.js';

export interface PhotoProfessionalHistory {
  reviews: PhotoProfessionalReview[]; notes: PhotoNote[]; submissions: PhotoSubmission[]; rights: PhotoRightsReview[];
  qualifications: ProfessionalQualification[]; users: Account[];
}
// Validate historical fixed references, not just the currently effective head.
// Later credential/account changes invalidate current approval, not old evidence.
export function validPhotoProfessionalHistory(facts: PhotoProfessionalHistory): boolean {
  try {
    const users = new Map(facts.users.map(user => [user.id, user]));
    const qualifications = new Map(facts.qualifications.map(q => [`${q.userId}:${q.revision}`, q]));
    const notes = new Map(facts.notes.map(n => [`${n.candidate.id}:${n.version}`, n]));
    const submissions = new Map(facts.submissions.map(s => [`${s.candidate.id}:${s.version}`, s]));
    const rights = new Map(facts.rights.map(r => [`${r.candidateId}:${r.version}`, r]));
    const heads = new Map<string, PhotoProfessionalReview>(), professions = new Map<string, PhotoProfessionalReview>();
    for (const value of facts.reviews.slice().sort((a, b) => a.candidateId.localeCompare(b.candidateId) || a.version - b.version)) {
      const item = verifiedPhotoProfessionalReview(value), previous = heads.get(item.candidateId), professional = professions.get(`${item.candidateId}:${item.profession}`);
      const actor = users.get(item.actorId), qualification = qualifications.get(`${item.qualificationUserId}:${item.qualificationRevision}`);
      const note = notes.get(`${item.candidateId}:${item.noteVersion}`), submission = submissions.get(`${item.candidateId}:${item.submissionVersion}`), right = rights.get(`${item.candidateId}:${item.rightsVersion}`);
      const time = Date.parse(item.createdAt);
      if (!actor || actor.username !== item.actorName || actor.revision < item.accountRevision || !qualification || !users.has(qualification.userId) ||
        qualification.digest !== item.qualificationDigest || qualification.profession !== item.profession || qualification.evidenceKind !== item.evidenceKind ||
        item.version !== (previous?.version ?? 0) + 1 || item.version > 10000 || !note || !submission || !right ||
        note.digest !== item.noteDigest || note.bindingDigest !== item.bindingDigest || note.candidate.ingredientId !== item.ingredientId ||
        submission.digest !== item.submissionDigest || submission.bindingDigest !== item.bindingDigest || submission.candidate.ingredientId !== item.ingredientId || submission.noteVersion !== item.noteVersion || submission.noteDigest !== item.noteDigest ||
        right.digest !== item.rightsDigest || right.bindingDigest !== item.bindingDigest || right.ingredientId !== item.ingredientId || right.submissionVersion !== item.submissionVersion || right.submissionDigest !== item.submissionDigest || right.decision !== 'approve' ||
        time < Date.parse(note.createdAt) || time < Date.parse(submission.createdAt) || time < Date.parse(right.createdAt) || time >= Date.parse(right.validUntil) ||
        facts.notes.some(n => n.candidate.id === item.candidateId && n.version > item.noteVersion && Date.parse(n.createdAt) < time) ||
        facts.submissions.some(s => s.candidate.id === item.candidateId && s.version > item.submissionVersion && Date.parse(s.createdAt) < time) ||
        facts.rights.some(r => r.candidateId === item.candidateId && r.version > item.rightsVersion && Date.parse(r.createdAt) < time) ||
        (previous && (time < Date.parse(previous.createdAt) || item.submissionVersion < previous.submissionVersion || item.noteVersion < previous.noteVersion || item.rightsVersion < previous.rightsVersion || item.ingredientId !== previous.ingredientId))) return false;
      if (item.decision === 'revoke') {
        if (!professional || professional.decision !== 'approve' || professional.bindingDigest !== item.bindingDigest || professional.submissionVersion !== item.submissionVersion || professional.submissionDigest !== item.submissionDigest ||
          professional.noteVersion !== item.noteVersion || professional.noteDigest !== item.noteDigest || professional.rightsVersion !== item.rightsVersion || professional.rightsDigest !== item.rightsDigest ||
          professional.qualificationUserId !== item.qualificationUserId || professional.qualificationRevision !== item.qualificationRevision || professional.qualificationDigest !== item.qualificationDigest ||
          (item.actorRole !== 'admin' && professional.actorId !== item.actorId)) return false;
      } else {
        if (item.qualificationUserId !== item.actorId || qualification.status !== 'verified' || !qualification.verificationConfirmed || qualification.accountRevision !== item.accountRevision ||
          time < Date.parse(qualification.recordedAt) || time >= Date.parse(qualification.validUntil) ||
          facts.qualifications.some(q => q.userId === item.qualificationUserId && q.revision > item.qualificationRevision && Date.parse(q.recordedAt) < time) ||
          (item.decision === 'approve' && [item.identity, item.part, item.processing].some(conclusion => conclusion !== 'matches')) ||
          (professional?.decision === 'return' && professional.submissionVersion === item.submissionVersion) ||
          (professional?.decision === 'approve' && item.decision === 'approve' && professional.rightsVersion === item.rightsVersion && professional.qualificationDigest === item.qualificationDigest) ||
          facts.notes.some(n => n.candidate.id === item.candidateId && n.version <= item.noteVersion && n.actorId === item.actorId) ||
          facts.submissions.some(s => s.candidate.id === item.candidateId && s.version <= item.submissionVersion && s.actorId === item.actorId) ||
          facts.rights.some(r => r.candidateId === item.candidateId && r.version <= item.rightsVersion && r.actorId === item.actorId)) return false;
      }
      heads.set(item.candidateId, item); professions.set(`${item.candidateId}:${item.profession}`, item);
    }
    return true;
  } catch { return false; }
}
