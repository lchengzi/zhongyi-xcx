import type { AuditEvent, CatalogSeed, EditorialNote, Ingredient, IngredientPage, PlatformSummary } from '../shared/contracts.js';
import type { CatalogStore, WriteAuthority } from './stores.js';
import { RevisionConflict } from './database.js';
import { validateSeed } from './seed.js';
import { checkAccount, PostgresContext, PostgresRuntime } from './postgres-runtime.js';

export class PostgresCatalog implements CatalogStore {
  private readonly seed: CatalogSeed;
  constructor(private readonly runtime: PostgresRuntime, seed: unknown) { this.seed = validateSeed(JSON.parse(JSON.stringify(seed))); }
  list(q: string, page: number, pageSize: number): Promise<IngredientPage> {
    return this.runtime.read(async (context) => {
      const total = (await context.get<{ count: number }>('SELECT COUNT(*) AS count FROM ingredients WHERE strpos(search_text, $1) > 0', [q.toLowerCase()]))!.count;
      const rows = await context.all<{ payload: string }>('SELECT payload FROM ingredients WHERE strpos(search_text, $1) > 0 ORDER BY id COLLATE "C" LIMIT $2 OFFSET $3', [q.toLowerCase(), pageSize, (page - 1) * pageSize]);
      return { items: rows.map((row) => JSON.parse(row.payload)), total, page, pageSize };
    });
  }
  ingredient(id: string): Promise<Ingredient | undefined> {
    return this.runtime.read(async (context) => {
      const row = await context.get<{ payload: string }>('SELECT payload FROM ingredients WHERE id = $1', [id]);
      return row ? JSON.parse(row.payload) : undefined;
    });
  }
  publicSnapshot(): Promise<CatalogSeed> {
    return this.runtime.read(async (context) => {
      const meta = Object.fromEntries((await context.all<{ key: string; value: string }>('SELECT key, value FROM metadata')).map((item) => [item.key, item.value]));
      for (const key of ['releaseId', 'contentVersion', 'sourceAsOf'] as const) if (meta[key] !== this.seed[key]) throw new Error('Public catalog metadata changed');
      if (meta.seedDigest !== this.seed.digest) throw new Error('Public catalog digest changed');
      const rows = await context.all<{ id: string; payload: string }>('SELECT id, payload FROM ingredients');
      if (rows.length !== this.seed.ingredients.length) throw new Error('Public catalog size changed');
      const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.payload)]));
      return validateSeed({ ...this.seed, ingredients: this.seed.ingredients.map((item) => byId.get(item.id)) });
    });
  }
  private async noteIn(context: PostgresContext, id: string): Promise<EditorialNote> {
    const row = await context.get<Omit<EditorialNote, 'ingredientId'>>('SELECT text, revision, updated_at AS "updatedAt" FROM editorial_notes WHERE ingredient_id = $1', [id]);
    return { ingredientId: id, ...(row || { text: '', revision: 0, updatedAt: null }) };
  }
  note(id: string): Promise<EditorialNote> { return this.runtime.read((context) => this.noteIn(context, id)); }
  saveNote(id: string, text: string, expectedRevision: number, actor = 'local-key', authority?: WriteAuthority): Promise<EditorialNote> {
    return this.runtime.write(async (context) => {
      if (authority) {
        await checkAccount(context, authority.account, ['admin', 'editor'], authority.token);
        if (authority.account.username !== actor) throw new Error('Actor does not match account');
      }
      const current = await this.noteIn(context, id);
      if (current.revision !== expectedRevision) throw new RevisionConflict('Note changed; reload before saving.');
      const revision = current.revision + 1; const now = new Date().toISOString();
      await context.run(`INSERT INTO editorial_notes (ingredient_id, text, revision, updated_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT (ingredient_id) DO UPDATE SET text = excluded.text, revision = excluded.revision, updated_at = excluded.updated_at`, [id, text, revision, now]);
      await context.run('INSERT INTO audit_events (ingredient_id, action, revision, created_at, actor) VALUES ($1, $2, $3, $4, $5)', [id, text ? 'note_saved' : 'note_cleared', revision, now, actor]);
      return { ingredientId: id, text, revision, updatedAt: now };
    });
  }
  summary(): Promise<PlatformSummary> {
    return this.runtime.read(async (context) => {
      const meta = Object.fromEntries((await context.all<{ key: string; value: string }>('SELECT key, value FROM metadata')).map((item) => [item.key, item.value]));
      const count = async (sql: string) => (await context.get<{ count: number }>(sql))!.count;
      return { mode: 'local_editorial_demo', releaseId: meta.releaseId, contentVersion: meta.contentVersion, sourceAsOf: meta.sourceAsOf,
        importedAt: meta.importedAt, ingredientCount: await count('SELECT COUNT(*) AS count FROM ingredients'),
        noteCount: await count("SELECT COUNT(*) AS count FROM editorial_notes WHERE text != ''"), eventCount: await count('SELECT COUNT(*) AS count FROM audit_events'), publicationEnabled: false };
    });
  }
  events(): Promise<AuditEvent[]> {
    return this.runtime.read((context) => context.all('SELECT id, ingredient_id AS "ingredientId", action, revision, created_at AS "createdAt", actor FROM audit_events ORDER BY id DESC LIMIT 20'));
  }
}
