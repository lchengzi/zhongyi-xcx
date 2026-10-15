import { DatabaseSync } from 'node:sqlite';
import type { AuditEvent, CatalogSeed, EditorialNote, Ingredient, IngredientPage, PlatformSummary } from '../shared/contracts.js';
import { validateSeed } from './seed.js';
import { migrateAccounts, migrateAssistant, migrateAssistantControls, migratePhotoNotes, migratePhotoSubmissions, migratePhotoRights, migratePhotoProfessional, migrateProfessional, migratePublications, migrateSourceChecks, migrateWorkflow } from './migrations.js';
import { AccountError, AuthRepository } from './auth.js';
import type { WriteAuthority } from './stores.js';

export class RevisionConflict extends Error {}

export class CatalogRepository {
  readonly db: DatabaseSync;
  private readonly publicSeed: CatalogSeed;
  constructor(filename: string, seedInput: unknown) {
    // Own a copy: subsequent mutations of the caller's input cannot move the
    // publication boundary or the digest against which database rows are checked.
    const seed = validateSeed(JSON.parse(JSON.stringify(seedInput)));
    this.publicSeed = seed;
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ingredients (id TEXT PRIMARY KEY, name TEXT NOT NULL, search_text TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS editorial_notes (
          ingredient_id TEXT PRIMARY KEY REFERENCES ingredients(id), text TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0), updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
          action TEXT NOT NULL CHECK (action IN ('note_saved','note_cleared')),
          revision INTEGER NOT NULL, created_at TEXT NOT NULL);
        INSERT OR IGNORE INTO migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
      this.seed(seed);
      migrateAccounts(this.db);
      migrateWorkflow(this.db);
      migrateAssistant(this.db);
      migrateAssistantControls(this.db);
      migrateProfessional(this.db);
      migrateSourceChecks(this.db);
      migratePublications(this.db);
      migratePhotoNotes(this.db);
      migratePhotoSubmissions(this.db);
      migratePhotoRights(this.db);
      migratePhotoProfessional(this.db);
    } catch (error) { this.db.close(); throw error; }
  }

  private seed(seed: CatalogSeed): void {
    const previous = this.db.prepare("SELECT value FROM metadata WHERE key = 'seedDigest'").get() as { value: string } | undefined;
    if (previous) {
      if (previous.value !== seed.digest) throw new Error('Catalog changed. Use a new database or an explicit migration; existing notes were preserved.');
      return;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT INTO ingredients (id, name, search_text, payload) VALUES (?, ?, ?, ?)');
      for (const item of seed.ingredients) {
        insert.run(item.id, item.name, [item.name, item.pinyin, ...item.aliases].join(' ').toLowerCase(), JSON.stringify(item));
      }
      const metadata = this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
      Object.entries({ seedDigest: seed.digest, releaseId: seed.releaseId, contentVersion: seed.contentVersion,
        sourceAsOf: seed.sourceAsOf, importedAt: new Date().toISOString() }).forEach(([key, value]) => metadata.run(key, value));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  list(q: string, page: number, pageSize: number): IngredientPage {
    // instr treats %, _ and quotes as literal search text; every value is bound.
    const query = q.toLowerCase();
    const total = (this.db.prepare('SELECT COUNT(*) count FROM ingredients WHERE instr(search_text, ?) > 0').get(query) as { count: number }).count;
    const rows = this.db.prepare('SELECT payload FROM ingredients WHERE instr(search_text, ?) > 0 ORDER BY id LIMIT ? OFFSET ?')
      .all(query, pageSize, (page - 1) * pageSize) as { payload: string }[];
    return { items: rows.map((row) => JSON.parse(row.payload)), total, page, pageSize };
  }

  ingredient(id: string): Ingredient | undefined {
    const row = this.db.prepare('SELECT payload FROM ingredients WHERE id = ?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }

  publicSnapshot(): CatalogSeed {
    const meta = Object.fromEntries((this.db.prepare('SELECT key, value FROM metadata').all() as { key: string; value: string }[])
      .map((item) => [item.key, item.value]));
    for (const key of ['releaseId', 'contentVersion', 'sourceAsOf'] as const) {
      if (meta[key] !== this.publicSeed[key]) throw new Error('Public catalog metadata changed');
    }
    if (meta.seedDigest !== this.publicSeed.digest) throw new Error('Public catalog digest changed');
    const rows = this.db.prepare('SELECT id, payload FROM ingredients').all() as { id: string; payload: string }[];
    if (rows.length !== this.publicSeed.ingredients.length) throw new Error('Public catalog size changed');
    const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.payload)]));
    // Preserve the imported snapshot's order; validateSeed checks exact nested
    // fields and recomputes the trusted digest over the actual SQL payloads.
    return validateSeed({ ...this.publicSeed, ingredients: this.publicSeed.ingredients.map((item) => byId.get(item.id)) });
  }

  note(id: string): EditorialNote {
    const row = this.db.prepare('SELECT text, revision, updated_at updatedAt FROM editorial_notes WHERE ingredient_id = ?').get(id) as Omit<EditorialNote, 'ingredientId'> | undefined;
    return { ingredientId: id, ...(row || { text: '', revision: 0, updatedAt: null }) };
  }

  saveNote(id: string, text: string, expectedRevision: number, actor = 'local-key', authority?: WriteAuthority): EditorialNote {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (authority) {
        const session = new AuthRepository(this.db).session(authority.token);
        if (!session || session.user.id !== authority.account.id || session.user.revision !== authority.account.revision || session.user.username !== actor || session.user.role === 'reviewer') {
          throw new AccountError(403, 'forbidden', '会话或编辑权限已变化，请重新登录。');
        }
      }
      const current = this.note(id);
      if (current.revision !== expectedRevision) throw new RevisionConflict('Note changed; reload before saving.');
      const revision = current.revision + 1;
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO editorial_notes (ingredient_id, text, revision, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (ingredient_id) DO UPDATE SET text = excluded.text, revision = excluded.revision, updated_at = excluded.updated_at`)
        .run(id, text, revision, now);
      this.db.prepare('INSERT INTO audit_events (ingredient_id, action, revision, created_at, actor) VALUES (?, ?, ?, ?, ?)')
        .run(id, text ? 'note_saved' : 'note_cleared', revision, now, actor);
      this.db.exec('COMMIT');
      return { ingredientId: id, text, revision, updatedAt: now };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  summary(): PlatformSummary {
    const meta = Object.fromEntries((this.db.prepare('SELECT key, value FROM metadata').all() as { key: string; value: string }[]).map((item) => [item.key, item.value]));
    const count = (sql: string) => (this.db.prepare(sql).get() as { count: number }).count;
    return { mode: 'local_editorial_demo', releaseId: meta.releaseId, contentVersion: meta.contentVersion, sourceAsOf: meta.sourceAsOf,
      importedAt: meta.importedAt, ingredientCount: count('SELECT COUNT(*) count FROM ingredients'),
      noteCount: count("SELECT COUNT(*) count FROM editorial_notes WHERE text != ''"), eventCount: count('SELECT COUNT(*) count FROM audit_events'), publicationEnabled: false };
  }

  events(): AuditEvent[] {
    return this.db.prepare('SELECT id, ingredient_id ingredientId, action, revision, created_at createdAt, actor FROM audit_events ORDER BY id DESC LIMIT 20').all() as unknown as AuditEvent[];
  }
  close(): void { this.db.close(); }
}
