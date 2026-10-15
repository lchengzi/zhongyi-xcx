import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, lstatSync, realpathSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CatalogRepository } from '../server/database.js';
import type { DatabaseSync } from 'node:sqlite';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { AssistantRepository } from '../server/assistant-repository.js';
import { AssistantService } from '../server/assistant-service.js';
import { PublicationRepository } from '../server/publication.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { PhotoSubmissionRepository } from '../server/photo-submissions.js';
import { PhotoRightsRepository } from '../server/photo-rights.js';
import { PhotoProfessionalRepository } from '../server/photo-professional.js';
import { fixtureAssistant } from './assistant-fixture.js';
import { readSqliteSnapshot } from '../server/migration-snapshot.js';
import type { CatalogSeed } from '../shared/contracts.js';
import { fixtureSeed } from './fixture.js';

export const fixturePassword = 'migration-test-only-password-2026';
export const fileDigest = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex');

// Used ONLY on the owned fixture to construct genuine historical databases.
// Refuse to discard populated governance history.
export function removeEmptyPublicationTables(db: DatabaseSync): void {
  removeEmptyPhotoNotes(db);
  const tables = ['publication_events', 'publication_approvals', 'publication_snapshots', 'publication_controls'];
  for (const table of tables) if (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n !== 0) throw new Error('Fixture publication history must be empty');
  for (const table of tables) db.exec(`DROP TABLE ${table}`);
  db.exec('DELETE FROM migrations WHERE version = 8');
}
export function removeEmptyPhotoNotes(db: DatabaseSync): void {
  removeEmptyPhotoSubmissions(db);
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_notes'").get()) {
    if (db.prepare('SELECT COUNT(*) n FROM photo_notes').get()!.n !== 0) throw new Error('Fixture photo history must be empty');
    db.exec('DROP TABLE photo_notes; DELETE FROM migrations WHERE version = 9');
  }
}

export function removeEmptyPhotoSubmissions(db: DatabaseSync): void {
  removeEmptyPhotoRights(db);
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_submissions'").get()) {
    if (db.prepare('SELECT COUNT(*) n FROM photo_submissions').get()!.n !== 0) throw new Error('Fixture photo submission history must be empty');
    db.exec('DROP TABLE photo_submissions; DELETE FROM migrations WHERE version = 10');
  }
}

export function removeEmptyPhotoRights(db: DatabaseSync): void {
  removeEmptyPhotoProfessional(db);
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_rights_reviews'").get()) {
    if (db.prepare('SELECT COUNT(*) n FROM photo_rights_reviews').get()!.n !== 0) throw new Error('Fixture rights review history must be empty');
    db.exec('DROP TABLE photo_rights_reviews; DELETE FROM migrations WHERE version = 11');
  }
}

export function removeEmptyPhotoProfessional(db: DatabaseSync): void {
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_professional_reviews'").get()) {
    if (db.prepare('SELECT COUNT(*) n FROM photo_professional_reviews').get()!.n !== 0) throw new Error('Fixture professional image history must be empty');
    db.exec('DROP TABLE photo_professional_reviews; DELETE FROM migrations WHERE version = 12');
  }
}

export async function migrationFixture(seed: CatalogSeed = fixtureSeed(), includeAssistant = true) {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-migration-test-'));
  const filename = join(directory, 'source.sqlite');
  const repo = new CatalogRepository(filename, seed);
  try {
    const auth = new AuthRepository(repo.db);
    const admin = await auth.createUser('migration-admin', fixturePassword, 'admin', 'test-fixture');
    const editor = await auth.createUser('migration-editor', fixturePassword, 'editor', 'test-fixture');
    const reviewer = await auth.createUser('migration-reviewer', fixturePassword, 'reviewer', 'test-fixture');
    const login = await auth.login(admin.username, fixturePassword, '127.0.0.1');
    repo.saveNote('huang-qi', "中文旧备注 ' SQL 字面值，非正式资料。", 0, 'legacy-local-key');
    repo.saveNote('huang-qi', '第二版备注，仍未专业审核。', 1, editor.username);
    repo.saveNote('huang-qi', '', 2, editor.username);
    repo.saveNote('huang-qi', '第四版私有备注 🌿', 3, editor.username);
    const work = new WorkflowRepository(repo.db);
    let source = work.saveSource({ title: "私有来源 v1 ' 非正式", publisher: '测试机构', url: 'https://example.org/migration-source' }, editor);
    const sourceId = source.id;
    const content = { ediblePart: '测试资料部位', latinName: '', educationText: '私有测试草稿 v1', safetyText: '非专业签审，不发布。', sourceRefs: [{ id: source.id, revision: 1, locator: '第 2 页第 3 段（测试）' }] };
    let draft = work.saveDraft('huang-qi', content, 0, editor);
    let submitted = work.submit('huang-qi', draft.lockVersion, editor);
    draft = work.decide(submitted.task.id, 'return', '测试退回意见', submitted.draft.lockVersion, reviewer);
    source = work.saveSource({ title: '私有来源 v2，不改变历史引用', publisher: source.publisher, url: source.url }, editor, source.id, 1);
    draft = work.saveDraft('huang-qi', { ...content, educationText: '私有测试草稿 v2 🌿' }, draft.lockVersion, editor);
    submitted = work.submit('huang-qi', draft.lockVersion, editor);
    work.decide(submitted.task.id, 'accept', '只通过编辑质量，不是专业或发布批准。', submitted.draft.lockVersion, reviewer);
    const other = work.saveDraft('jiang', { ...content, sourceRefs: [{ id: source.id, revision: 2, locator: '第 4 页（测试）' }] }, 0, admin);
    work.submit('jiang', other.lockVersion, admin);
    if (includeAssistant) {
      const assistant = new AssistantRepository(repo.db);
      const excerpt = assistant.saveExcerpt('huang-qi', { sourceId, sourceRevision: 1, locator: '第 2 页身份段落（测试）', text: '测试记录所列部位为根，形态为干燥切片。', allowExternal: true }, admin, login.token);
      const service = new AssistantService({ engine: 'sqlite', catalog: repo, auth, workflow: work, assistant, publication: new PublicationRepository(repo.db, work), photoNotes: new PhotoNoteRepository(repo.db), photoSubmissions: new PhotoSubmissionRepository(repo.db), photoRights: new PhotoRightsRepository(repo.db), photoProfessional: new PhotoProfessionalRepository(repo.db), close: () => repo.close() }, fixtureAssistant());
      await service.generate('huang-qi', [excerpt.id], true, admin, login.token, new AbortController().signal);
      assistant.permission(excerpt.id, false, 0, admin, login.token);
      assistant.permission(excerpt.id, true, 1, admin, login.token);
    }
    // Preserve the sequence high-water mark, not merely MAX(id).
    repo.db.prepare("UPDATE sqlite_sequence SET seq = seq + 100 WHERE name = 'security_events'").run();
    return { directory, filename, seed, admin, editor, reviewer, sourceId, token: login.token,
      read: () => readSqliteSnapshot(filename, seed),
      dispose: () => {
        // Delete only this fixture's known regular file and now-empty directory.
        const actual = realpathSync(filename); const parent = realpathSync(directory);
        if (actual.toLowerCase() !== resolve(parent, 'source.sqlite').toLowerCase() || lstatSync(filename).isSymbolicLink() || !lstatSync(filename).isFile()) throw new Error('Unsafe fixture cleanup target');
        unlinkSync(actual); rmdirSync(parent);
      }
    };
  } finally { repo.close(); }
}
