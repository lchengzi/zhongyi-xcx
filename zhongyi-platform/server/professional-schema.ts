// Only additive DDL; previous migration SQL/checksums remain immutable.
export const PROFESSIONAL_TABLE_SQL = `
CREATE TABLE professional_qualifications (
  user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL CHECK(revision > 0),
  profession TEXT NOT NULL CHECK(profession IN ('tcm_physician','pharmacist')),
  status TEXT NOT NULL CHECK(status IN ('verified','revoked')),
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('manual-verification','test-fixture')),
  evidence_reference TEXT NOT NULL, valid_until TEXT NOT NULL, comment TEXT NOT NULL,
  verification_confirmed INTEGER NOT NULL CHECK(verification_confirmed IN (0,1)),
  account_revision INTEGER NOT NULL CHECK(account_revision > 0),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(user_id, revision));
CREATE TABLE professional_reviews (
  ingredient_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  content_revision INTEGER NOT NULL, content_digest TEXT NOT NULL,
  profession TEXT NOT NULL CHECK(profession IN ('tcm_physician','pharmacist')),
  decision TEXT NOT NULL CHECK(decision IN ('approve','return','revoke')),
  qualification_user_id TEXT NOT NULL, qualification_revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), comment TEXT NOT NULL,
  created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(ingredient_id, version),
  FOREIGN KEY(ingredient_id, content_revision) REFERENCES content_revisions(ingredient_id, revision),
  FOREIGN KEY(qualification_user_id, qualification_revision) REFERENCES professional_qualifications(user_id, revision));
`;
export const SQLITE_PROFESSIONAL_SQL = PROFESSIONAL_TABLE_SQL + `
CREATE TRIGGER immutable_qualification_update BEFORE UPDATE ON professional_qualifications BEGIN SELECT RAISE(ABORT, 'qualifications are immutable'); END;
CREATE TRIGGER immutable_qualification_delete BEFORE DELETE ON professional_qualifications BEGIN SELECT RAISE(ABORT, 'qualifications are immutable'); END;
CREATE TRIGGER immutable_professional_update BEFORE UPDATE ON professional_reviews BEGIN SELECT RAISE(ABORT, 'professional reviews are immutable'); END;
CREATE TRIGGER immutable_professional_delete BEFORE DELETE ON professional_reviews BEGIN SELECT RAISE(ABORT, 'professional reviews are immutable'); END;
`;
export const POSTGRES_PROFESSIONAL_SQL = PROFESSIONAL_TABLE_SQL + `
CREATE TRIGGER immutable_qualification_change BEFORE UPDATE OR DELETE ON professional_qualifications FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_qualification_truncate BEFORE TRUNCATE ON professional_qualifications FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_professional_change BEFORE UPDATE OR DELETE ON professional_reviews FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_professional_truncate BEFORE TRUNCATE ON professional_reviews FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
