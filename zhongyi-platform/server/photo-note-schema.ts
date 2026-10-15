// New migration only. Candidate payloads never include local paths or EXIF.
const TABLE_SQL = `
CREATE TABLE photo_notes (
  candidate_id TEXT NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  version INTEGER NOT NULL CHECK(version > 0), candidate_payload TEXT NOT NULL, binding_digest TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('identity','processing','rights','general')),
  text TEXT NOT NULL, evidence_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
  account_revision INTEGER NOT NULL CHECK(account_revision > 0), created_at TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(candidate_id, version));
`;
export const SQLITE_PHOTO_NOTE_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_note_update BEFORE UPDATE ON photo_notes BEGIN SELECT RAISE(ABORT, 'photo notes are immutable'); END;
CREATE TRIGGER immutable_photo_note_delete BEFORE DELETE ON photo_notes BEGIN SELECT RAISE(ABORT, 'photo notes are immutable'); END;
`;
export const POSTGRES_PHOTO_NOTE_SQL = TABLE_SQL + `
CREATE TRIGGER immutable_photo_note_change BEFORE UPDATE OR DELETE ON photo_notes FOR EACH ROW EXECUTE FUNCTION deny_history_change();
CREATE TRIGGER immutable_photo_note_truncate BEFORE TRUNCATE ON photo_notes FOR EACH STATEMENT EXECUTE FUNCTION deny_history_change();
`;
