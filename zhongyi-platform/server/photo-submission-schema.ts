// Append-only submission evidence; this table contains no approval/public flag.
const TABLE_SQL = `
CREATE TABLE photo_submissions (
  candidate_id TEXT NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  version INTEGER NOT NULL CHECK(version > 0), candidate_payload TEXT NOT NULL, binding_digest TEXT NOT NULL,
  note_version INTEGER NOT NULL CHECK(note_version > 0), note_digest TEXT NOT NULL,
  caption TEXT NOT NULL, part_description TEXT NOT NULL, processing_description TEXT NOT NULL, evidence_reference TEXT NOT NULL,
  submission_confirmed INTEGER NOT NULL CHECK(submission_confirmed = 1),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(candidate_id, version), FOREIGN KEY(candidate_id, note_version) REFERENCES photo_notes(candidate_id, version));
`;
export const SQLITE_PHOTO_SUBMISSION_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_submission_update BEFORE UPDATE ON photo_submissions BEGIN SELECT RAISE(ABORT, 'photo submissions are immutable'); END;
CREATE TRIGGER immutable_photo_submission_delete BEFORE DELETE ON photo_submissions BEGIN SELECT RAISE(ABORT, 'photo submissions are immutable'); END;
`;
export const POSTGRES_PHOTO_SUBMISSION_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_submission_change BEFORE UPDATE OR DELETE ON photo_submissions FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_photo_submission_truncate BEFORE TRUNCATE ON photo_submissions FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
