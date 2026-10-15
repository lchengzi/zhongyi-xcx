// New DDL only: source snapshots and all previous migration checksums stay fixed.
export const SOURCE_CHECK_TABLE_SQL = `
CREATE TABLE source_checks (
  source_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  source_revision INTEGER NOT NULL, source_digest TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('verified','return','revoke')),
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('manual-check','test-fixture')),
  scope_payload TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority IN ('official','research','reference')),
  checked_at TEXT NOT NULL, valid_until TEXT NOT NULL, evidence_reference TEXT NOT NULL, comment TEXT NOT NULL,
  verification_confirmed INTEGER NOT NULL CHECK(verification_confirmed IN (0,1)),
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(source_id, version),
  FOREIGN KEY(source_id, source_revision) REFERENCES source_versions(source_id, revision));
`;
export const SQLITE_SOURCE_CHECK_SQL = SOURCE_CHECK_TABLE_SQL + `
CREATE TRIGGER immutable_source_check_update BEFORE UPDATE ON source_checks BEGIN SELECT RAISE(ABORT, 'source checks are immutable'); END;
CREATE TRIGGER immutable_source_check_delete BEFORE DELETE ON source_checks BEGIN SELECT RAISE(ABORT, 'source checks are immutable'); END;
`;
export const POSTGRES_SOURCE_CHECK_SQL = SOURCE_CHECK_TABLE_SQL + `
CREATE TRIGGER immutable_source_check_change BEFORE UPDATE OR DELETE ON source_checks FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_source_check_truncate BEFORE TRUNCATE ON source_checks FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
