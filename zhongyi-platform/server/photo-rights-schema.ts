// Append-only rights evidence; no public approval or professional claims.
const TABLE_SQL = `
CREATE TABLE photo_rights_reviews (
  candidate_id TEXT NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id), version INTEGER NOT NULL CHECK(version > 0),
  submission_version INTEGER NOT NULL CHECK(submission_version > 0), submission_digest TEXT NOT NULL, binding_digest TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','return','revoke')),
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('manual-verification','test-fixture')), evidence_reference TEXT NOT NULL,
  attribution_plan TEXT NOT NULL, alteration_plan TEXT NOT NULL, valid_until TEXT NOT NULL, comment TEXT NOT NULL,
  verification_confirmed INTEGER NOT NULL CHECK(verification_confirmed = 1),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','reviewer')), account_revision INTEGER NOT NULL CHECK(account_revision > 0), created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(candidate_id, version), FOREIGN KEY(candidate_id, submission_version) REFERENCES photo_submissions(candidate_id, version));
`;
export const SQLITE_PHOTO_RIGHTS_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_rights_update BEFORE UPDATE ON photo_rights_reviews BEGIN SELECT RAISE(ABORT, 'photo rights reviews are immutable'); END;
CREATE TRIGGER immutable_photo_rights_delete BEFORE DELETE ON photo_rights_reviews BEGIN SELECT RAISE(ABORT, 'photo rights reviews are immutable'); END;
`;
export const POSTGRES_PHOTO_RIGHTS_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_rights_change BEFORE UPDATE OR DELETE ON photo_rights_reviews FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_photo_rights_truncate BEFORE TRUNCATE ON photo_rights_reviews FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
