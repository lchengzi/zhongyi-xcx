import type { Row, TableName } from './migration-snapshot.js';
import { photoProfessionalFrom } from './photo-professional-values.js';
import { photoNoteFrom } from './photo-note-values.js';
import { photoSubmissionFrom } from './photo-submission-values.js';
import { photoRightsFrom } from './photo-rights-values.js';
import { qualificationFrom } from './professional-values.js';
import { validPhotoProfessionalHistory } from './photo-professional-history.js';
import type { Account } from '../shared/contracts.js';
export function validPhotoProfessionalTables(tables: Record<TableName, Row[]>): boolean {
  try {
    const users: Account[] = tables.users.map(row => {
      if (typeof row.id !== 'string' || typeof row.username !== 'string' || typeof row.created_at !== 'string' || typeof row.revision !== 'number' ||
        !['admin', 'reviewer', 'editor'].includes(String(row.role))) throw new Error('Invalid user');
      const role = row.role;
      if (role !== 'admin' && role !== 'reviewer' && role !== 'editor') throw new Error('Invalid role');
      return { id: row.id, username: row.username, createdAt: row.created_at, revision: row.revision, role, active: row.active === 1 };
    });
    return validPhotoProfessionalHistory({ users, qualifications: tables.professional_qualifications.map(qualificationFrom), notes: tables.photo_notes.map(photoNoteFrom),
      submissions: tables.photo_submissions.map(photoSubmissionFrom), rights: tables.photo_rights_reviews.map(photoRightsFrom), reviews: tables.photo_professional_reviews.map(photoProfessionalFrom) });
  } catch { return false; }
}
