// Additive schema only; earlier DDL and source/content digests remain unchanged.
export const PUBLICATION_TABLE_SQL = `
CREATE TABLE publication_snapshots (
  id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), content_revision INTEGER NOT NULL,
  basis_payload TEXT NOT NULL, basis_digest TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), comment TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL,
  UNIQUE(ingredient_id, version), UNIQUE(ingredient_id, basis_digest),
  FOREIGN KEY(ingredient_id, content_revision) REFERENCES content_revisions(ingredient_id, revision));
CREATE TABLE publication_approvals (
  snapshot_id TEXT NOT NULL REFERENCES publication_snapshots(id), version INTEGER NOT NULL CHECK(version > 0), snapshot_digest TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','revoke')), control_epoch TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, account_revision INTEGER NOT NULL CHECK(account_revision > 0),
  comment TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(snapshot_id, version));
CREATE TABLE publication_events (
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id), version INTEGER NOT NULL CHECK(version > 0),
  action TEXT NOT NULL CHECK(action IN ('publish','withdraw','rollback')), snapshot_id TEXT NOT NULL,
  approval_version INTEGER NOT NULL CHECK(approval_version > 0), control_epoch TEXT NOT NULL, previous_digest TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, account_revision INTEGER NOT NULL CHECK(account_revision > 0),
  comment TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(ingredient_id, version),
  FOREIGN KEY(snapshot_id, approval_version) REFERENCES publication_approvals(snapshot_id, version));
CREATE TABLE publication_controls (
  version INTEGER PRIMARY KEY CHECK(version > 0), action TEXT NOT NULL CHECK(action IN ('freeze','resume')), epoch TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('operator','recovery')), actor_id TEXT REFERENCES users(id), actor_name TEXT NOT NULL, account_revision INTEGER,
  evidence_reference TEXT NOT NULL, comment TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL,
  CHECK((kind='operator' AND actor_id IS NOT NULL AND account_revision > 0) OR
    (kind='recovery' AND action='freeze' AND actor_id IS NULL AND account_revision IS NULL AND actor_name='backup-restore')));
`;
const tables = ['publication_snapshots', 'publication_approvals', 'publication_events', 'publication_controls'];
export const SQLITE_PUBLICATION_SQL = PUBLICATION_TABLE_SQL + tables.map((table) => `
CREATE TRIGGER immutable_${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'publication history is immutable'); END;
CREATE TRIGGER immutable_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'publication history is immutable'); END;
`).join('');
export const POSTGRES_PUBLICATION_SQL = PUBLICATION_TABLE_SQL + tables.map((table) => `
CREATE TRIGGER immutable_${table}_change BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_${table}_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`).join('');
