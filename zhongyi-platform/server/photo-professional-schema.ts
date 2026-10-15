// Additive append-only professional image opinions; never publication approval.
const TABLE_SQL = `
CREATE TABLE photo_professional_reviews (
  candidate_id TEXT NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id), version INTEGER NOT NULL CHECK(version > 0 AND version <= 10000), binding_digest TEXT NOT NULL,
  submission_version INTEGER NOT NULL CHECK(submission_version > 0), submission_digest TEXT NOT NULL,
  note_version INTEGER NOT NULL CHECK(note_version > 0), note_digest TEXT NOT NULL,
  rights_version INTEGER NOT NULL CHECK(rights_version > 0), rights_digest TEXT NOT NULL,
  profession TEXT NOT NULL CHECK(profession IN ('tcm_physician','pharmacist')),
  qualification_user_id TEXT NOT NULL, qualification_revision INTEGER NOT NULL CHECK(qualification_revision > 0), qualification_digest TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('manual-verification','test-fixture')),
  decision TEXT NOT NULL CHECK(decision IN ('approve','return','revoke')),
  identity_match TEXT NOT NULL CHECK(identity_match IN ('matches','uncertain','mismatch')),
  part_match TEXT NOT NULL CHECK(part_match IN ('matches','uncertain','mismatch')),
  processing_match TEXT NOT NULL CHECK(processing_match IN ('matches','uncertain','mismatch')),
  evidence_reference TEXT NOT NULL, comment TEXT NOT NULL, verification_confirmed INTEGER NOT NULL CHECK(verification_confirmed = 1),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','reviewer')),
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(candidate_id, version),
  FOREIGN KEY(candidate_id, submission_version) REFERENCES photo_submissions(candidate_id, version),
  FOREIGN KEY(candidate_id, note_version) REFERENCES photo_notes(candidate_id, version),
  FOREIGN KEY(candidate_id, rights_version) REFERENCES photo_rights_reviews(candidate_id, version),
  FOREIGN KEY(qualification_user_id, qualification_revision) REFERENCES professional_qualifications(user_id, revision));
`;
export const SQLITE_PHOTO_PROFESSIONAL_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_professional_update BEFORE UPDATE ON photo_professional_reviews BEGIN SELECT RAISE(ABORT, 'photo professional reviews are immutable'); END;
CREATE TRIGGER immutable_photo_professional_delete BEFORE DELETE ON photo_professional_reviews BEGIN SELECT RAISE(ABORT, 'photo professional reviews are immutable'); END;
`;
export const POSTGRES_PHOTO_PROFESSIONAL_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_professional_change BEFORE UPDATE OR DELETE ON photo_professional_reviews FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_photo_professional_truncate BEFORE TRUNCATE ON photo_professional_reviews FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
