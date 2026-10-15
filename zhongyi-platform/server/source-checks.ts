import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Account, SourceCheckInput } from '../shared/contracts.js';
import { AuthRepository } from './auth.js';
import { ProfessionalRepository } from './professional.js';
import { fail, version, type WorkflowRepository } from './workflow.js';
import { newSourceCheck, publicationPreflight, sourceCheckDetail, sourceCheckFrom, sourceCheckValues, SOURCE_CHECK_INSERT, type SourceCheckFacts } from './source-check-values.js';

type Reader = Pick<WorkflowRepository, 'source' | 'draft' | 'revision'>;
export class SourceCheckRepository {
  constructor(private readonly db: DatabaseSync, private readonly reader: Reader) {}
  private transaction<T>(work: () => T, write = false): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private facts(id: string, revision: number): SourceCheckFacts {
    const source = this.reader.source(id, revision) || fail(404, 'not_found', '固定来源版本不存在。');
    return { source, checks: this.db.prepare('SELECT * FROM source_checks WHERE source_id = ? ORDER BY version DESC').all(id).map(sourceCheckFrom),
      users: new AuthRepository(this.db).users(), authorIds: (this.db.prepare('SELECT DISTINCT author_id id FROM source_versions WHERE source_id = ?').all(id) as { id: string }[]).map((item) => item.id) };
  }
  sourceCheck(id: string, revision: number) { return this.transaction(() => sourceCheckDetail(this.facts(id, revision))); }
  factsInTransaction(id: string, revision: number) { return this.facts(id, revision); }
  saveSourceCheck(id: string, input: SourceCheckInput, expectedVersion: number, actor: Account, token?: string) {
    if (!version(expectedVersion, true)) fail(400, 'invalid_source_check', '核验协作版本无效。');
    return this.transaction(() => {
      const auth = new AuthRepository(this.db); const user = auth.users().find((item) => item.id === actor.id);
      if (!user?.active || user.role !== actor.role || user.revision !== actor.revision || !['admin', 'reviewer'].includes(user.role)) fail(403, 'forbidden', '需启用的管理员或独立审阅账号。');
      if (token !== undefined && auth.session(token)?.user.id !== actor.id) fail(401, 'unauthorized', '会话已失效。');
      const facts = this.facts(id, input.sourceRevision); const item = newSourceCheck(input, expectedVersion, facts, actor);
      if (item.ingredientIds.some((ingredientId) => !this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(ingredientId))) fail(400, 'invalid_source_scope', '适用范围包含未知食材。');
      this.db.prepare(SOURCE_CHECK_INSERT).run(...sourceCheckValues(item) as SQLInputValue[]);
      return sourceCheckDetail(this.facts(id, input.sourceRevision));
    }, true);
  }
  publicationPreflight(id: string) {
    return this.transaction(() => {
      const professional = new ProfessionalRepository(this.db, this.reader).detailInTransaction(id);
      const details = professional.draft?.content.sourceRefs.map((ref) => sourceCheckDetail(this.facts(ref.id, ref.revision))) || [];
      return publicationPreflight(id, professional, details);
    });
  }
}
