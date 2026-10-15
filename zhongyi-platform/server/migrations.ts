import type { DatabaseSync } from 'node:sqlite';
import { SQLITE_PROFESSIONAL_SQL } from './professional-schema.js';
import { SQLITE_SOURCE_CHECK_SQL } from './source-check-schema.js';
import { SQLITE_PUBLICATION_SQL } from './publication-schema.js';
import { SQLITE_PHOTO_NOTE_SQL } from './photo-note-schema.js';
import { SQLITE_PHOTO_SUBMISSION_SQL } from './photo-submission-schema.js';
import { SQLITE_PHOTO_RIGHTS_SQL } from './photo-rights-schema.js';
import { SQLITE_PHOTO_PROFESSIONAL_SQL } from './photo-professional-schema.js';

export function migratePhotoProfessional(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 12').get()) {
      db.exec(SQLITE_PHOTO_PROFESSIONAL_SQL);
      db.prepare('INSERT INTO migrations VALUES (12, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migratePhotoRights(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 11').get()) {
      db.exec(SQLITE_PHOTO_RIGHTS_SQL);
      db.prepare('INSERT INTO migrations VALUES (11, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migratePhotoSubmissions(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 10').get()) {
      db.exec(SQLITE_PHOTO_SUBMISSION_SQL);
      db.prepare('INSERT INTO migrations VALUES (10, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migratePhotoNotes(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 9').get()) {
      db.exec(SQLITE_PHOTO_NOTE_SQL);
      db.prepare('INSERT INTO migrations VALUES (9, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migratePublications(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 8').get()) {
      db.exec(SQLITE_PUBLICATION_SQL);
      db.prepare('INSERT INTO migrations VALUES (8, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateSourceChecks(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 7').get()) {
      db.exec(SQLITE_SOURCE_CHECK_SQL);
      db.prepare('INSERT INTO migrations VALUES (7, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateProfessional(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 6').get()) {
      db.exec(SQLITE_PROFESSIONAL_SQL);
      db.prepare('INSERT INTO migrations VALUES (6, ?)').run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Additive migration: preserve P1 notes and label pre-account events honestly.
export function migrateAccounts(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const applied = db.prepare('SELECT version FROM migrations WHERE version = 2').get();
    if (!applied) {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin','editor','reviewer')),
          active INTEGER NOT NULL CHECK (active IN (0,1)),
          revision INTEGER NOT NULL CHECK (revision > 0), created_at TEXT NOT NULL);
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX sessions_user ON sessions(user_id);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
        CREATE TABLE security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT, created_at TEXT NOT NULL);
        ALTER TABLE audit_events ADD COLUMN actor TEXT NOT NULL DEFAULT 'legacy-local-key';
        INSERT INTO migrations VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateWorkflow(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 3').get()) {
      db.exec(`
        CREATE TABLE source_records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), url TEXT NOT NULL UNIQUE);
        CREATE TABLE source_versions (
          source_id TEXT NOT NULL REFERENCES source_records(id), revision INTEGER NOT NULL CHECK(revision > 0),
          title TEXT NOT NULL, publisher TEXT NOT NULL, url TEXT NOT NULL,
          author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(source_id, revision));
        CREATE TABLE content_revisions (
          ingredient_id TEXT NOT NULL REFERENCES ingredients(id), revision INTEGER NOT NULL CHECK(revision > 0),
          payload TEXT NOT NULL, digest TEXT NOT NULL, base_release_id TEXT NOT NULL,
          author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(ingredient_id, revision));
        CREATE TABLE revision_sources (
          ingredient_id TEXT NOT NULL, content_revision INTEGER NOT NULL,
          source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, locator TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position >= 0),
          PRIMARY KEY(ingredient_id, content_revision, source_id),
          FOREIGN KEY(ingredient_id, content_revision) REFERENCES content_revisions(ingredient_id, revision),
          FOREIGN KEY(source_id, source_revision) REFERENCES source_versions(source_id, revision));
        CREATE TABLE content_drafts (
          ingredient_id TEXT PRIMARY KEY REFERENCES ingredients(id), revision INTEGER NOT NULL,
          lock_version INTEGER NOT NULL CHECK(lock_version > 0),
          state TEXT NOT NULL CHECK(state IN ('draft','submitted','changes_requested','editorial_accepted')),
          owner_id TEXT NOT NULL REFERENCES users(id), owner_name TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(ingredient_id, revision) REFERENCES content_revisions(ingredient_id, revision));
        CREATE TABLE review_tasks (
          id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL, content_revision INTEGER NOT NULL, digest TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','accepted','returned')),
          submitted_by_id TEXT NOT NULL REFERENCES users(id), submitted_by_name TEXT NOT NULL, submitted_at TEXT NOT NULL,
          reviewed_by_id TEXT REFERENCES users(id), reviewed_by_name TEXT, reviewed_at TEXT, comment TEXT,
          FOREIGN KEY(ingredient_id, content_revision) REFERENCES content_revisions(ingredient_id, revision));
        CREATE UNIQUE INDEX one_pending_review ON review_tasks(ingredient_id) WHERE status = 'pending';
        CREATE INDEX review_task_queue ON review_tasks(status, submitted_at);
        CREATE TABLE workflow_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id TEXT REFERENCES ingredients(id), source_id TEXT REFERENCES source_records(id),
          revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('source_created','source_updated','draft_saved','draft_submitted','review_returned','review_accepted')),
          actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TRIGGER immutable_source_version_update BEFORE UPDATE ON source_versions BEGIN SELECT RAISE(ABORT, 'source versions are immutable'); END;
        CREATE TRIGGER immutable_source_version_delete BEFORE DELETE ON source_versions BEGIN SELECT RAISE(ABORT, 'source versions are immutable'); END;
        CREATE TRIGGER immutable_content_revision_update BEFORE UPDATE ON content_revisions BEGIN SELECT RAISE(ABORT, 'content revisions are immutable'); END;
        CREATE TRIGGER immutable_content_revision_delete BEFORE DELETE ON content_revisions BEGIN SELECT RAISE(ABORT, 'content revisions are immutable'); END;
        CREATE TRIGGER immutable_revision_source_update BEFORE UPDATE ON revision_sources BEGIN SELECT RAISE(ABORT, 'revision references are immutable'); END;
        CREATE TRIGGER immutable_revision_source_delete BEFORE DELETE ON revision_sources BEGIN SELECT RAISE(ABORT, 'revision references are immutable'); END;
        INSERT INTO migrations VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateAssistant(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 4').get()) {
      db.exec(`
        CREATE TABLE editorial_excerpts (
          id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
          source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL,
          allow_external INTEGER NOT NULL CHECK(allow_external IN (0,1)), digest TEXT NOT NULL,
          author_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(source_id, source_revision) REFERENCES source_versions(source_id, revision));
        CREATE INDEX excerpt_ingredient ON editorial_excerpts(ingredient_id, created_at);
        CREATE TABLE assistant_events (
          id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
          actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
          provider TEXT NOT NULL CHECK(provider IN ('disabled','openai','test-fixture')), model TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('completed','failed','refused')),
          request_digest TEXT NOT NULL, result_digest TEXT, error_code TEXT, metrics_payload TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX assistant_event_actor ON assistant_events(actor_id, created_at);
        CREATE TRIGGER immutable_excerpt_update BEFORE UPDATE ON editorial_excerpts BEGIN SELECT RAISE(ABORT, 'excerpts are immutable'); END;
        CREATE TRIGGER immutable_excerpt_delete BEFORE DELETE ON editorial_excerpts BEGIN SELECT RAISE(ABORT, 'excerpts are immutable'); END;
        CREATE TRIGGER immutable_assistant_event_update BEFORE UPDATE ON assistant_events BEGIN SELECT RAISE(ABORT, 'assistant events are immutable'); END;
        CREATE TRIGGER immutable_assistant_event_delete BEFORE DELETE ON assistant_events BEGIN SELECT RAISE(ABORT, 'assistant events are immutable'); END;
        INSERT INTO migrations VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateAssistantControls(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT version FROM migrations WHERE version = 5').get()) {
      db.exec(`
        CREATE TABLE excerpt_permissions (id TEXT PRIMARY KEY, excerpt_id TEXT NOT NULL REFERENCES editorial_excerpts(id),
          revision INTEGER NOT NULL CHECK(revision > 0), allow_external INTEGER NOT NULL CHECK(allow_external IN (0,1)),
          actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL,
          UNIQUE(excerpt_id, revision));
        CREATE TABLE assistant_quota_days (day_key TEXT PRIMARY KEY, limits_payload TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE assistant_reservations (id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
          actor_id TEXT NOT NULL REFERENCES users(id), day_key TEXT NOT NULL REFERENCES assistant_quota_days(day_key), request_digest TEXT NOT NULL,
          evidence_payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at = created_at + 45000));
        CREATE INDEX assistant_reservation_actor ON assistant_reservations(day_key, actor_id);
        CREATE INDEX assistant_reservation_expiry ON assistant_reservations(expires_at);
        CREATE TRIGGER immutable_permission_update BEFORE UPDATE ON excerpt_permissions BEGIN SELECT RAISE(ABORT, 'permissions are immutable'); END;
        CREATE TRIGGER immutable_permission_delete BEFORE DELETE ON excerpt_permissions BEGIN SELECT RAISE(ABORT, 'permissions are immutable'); END;
        CREATE TRIGGER immutable_quota_day_update BEFORE UPDATE ON assistant_quota_days BEGIN SELECT RAISE(ABORT, 'quota days are immutable'); END;
        CREATE TRIGGER immutable_quota_day_delete BEFORE DELETE ON assistant_quota_days BEGIN SELECT RAISE(ABORT, 'quota days are immutable'); END;
        CREATE TRIGGER immutable_reservation_update BEFORE UPDATE ON assistant_reservations BEGIN SELECT RAISE(ABORT, 'reservations are immutable'); END;
        CREATE TRIGGER immutable_reservation_delete BEFORE DELETE ON assistant_reservations BEGIN SELECT RAISE(ABORT, 'reservations are immutable'); END;
        INSERT INTO migrations VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
