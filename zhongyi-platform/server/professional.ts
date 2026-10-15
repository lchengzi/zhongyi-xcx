import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Account, ProfessionalDecisionInput, ProfessionalQualification, QualificationInput } from '../shared/contracts.js';
import { AuthRepository } from './auth.js';
import { fail, version } from './workflow.js';
import { CONTRIBUTOR_SQL, QUALIFICATION_INSERT, REVIEW_INSERT, newProfessionalReview, newQualification, professionalDetail, qualificationFrom, qualificationValues, reviewFrom, reviewValues, type ProfessionalFacts } from './professional-values.js';

type Reader = Pick<import('./workflow.js').WorkflowRepository, 'draft' | 'revision'>;
const latestQualifications = 'SELECT q.* FROM professional_qualifications q WHERE NOT EXISTS (SELECT 1 FROM professional_qualifications newer WHERE newer.user_id = q.user_id AND newer.revision > q.revision) ORDER BY q.user_id';
export { latestQualifications };

export class ProfessionalRepository {
  constructor(private readonly db: DatabaseSync, private readonly reader: Reader) {}
  private transaction<T>(work: () => T, write = false): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private authorize(actor: Account, roles: Account['role'][], token?: string): void {
    const auth = new AuthRepository(this.db); const user = auth.users().find((item) => item.id === actor.id);
    if (!user?.active || user.role !== actor.role || user.revision !== actor.revision || !roles.includes(user.role)) fail(403, 'forbidden', '账号权限已变化或不能执行此操作。');
    if (token !== undefined && auth.session(token)?.user.id !== actor.id) fail(401, 'unauthorized', '会话已失效。');
  }
  private facts(id: string): ProfessionalFacts {
    if (!this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(id)) fail(404, 'not_found', '食材不存在。');
    return { ingredientId: id, draft: this.reader.draft(id), reviews: this.db.prepare('SELECT * FROM professional_reviews WHERE ingredient_id = ? ORDER BY version DESC').all(id).map(reviewFrom),
      qualifications: this.db.prepare(latestQualifications).all().map(qualificationFrom), users: new AuthRepository(this.db).users(),
      contributorIds: (this.db.prepare(CONTRIBUTOR_SQL).all(id, id, id, id) as { id: string }[]).map((row) => row.id) };
  }
  qualificationHistory(userId: string): ProfessionalQualification[] {
    return this.db.prepare('SELECT * FROM professional_qualifications WHERE user_id = ? ORDER BY revision DESC LIMIT 20').all(userId).map(qualificationFrom);
  }
  professionalDetail(id: string) { return this.transaction(() => professionalDetail(this.facts(id))); }
  detailInTransaction(id: string) { return professionalDetail(this.facts(id)); }
  factsInTransaction(id: string) { return this.facts(id); }
  saveQualification(userId: string, input: QualificationInput, expectedRevision: number, actor: Account, token?: string): ProfessionalQualification {
    if (!version(expectedRevision, true)) fail(400, 'invalid_qualification', '资格修订号无效。');
    return this.transaction(() => {
      this.authorize(actor, ['admin'], token);
      const target = new AuthRepository(this.db).users().find((item) => item.id === userId) || fail(404, 'not_found', '账号不存在。');
      const item = newQualification(input, this.qualificationHistory(userId)[0], expectedRevision, target, actor);
      this.db.prepare(QUALIFICATION_INSERT).run(...qualificationValues(item) as SQLInputValue[]); return item;
    }, true);
  }
  recordProfessionalReview(id: string, input: ProfessionalDecisionInput, actor: Account, token?: string) {
    return this.transaction(() => {
      this.authorize(actor, ['admin', 'reviewer'], token);
      const facts = this.facts(id); const item = newProfessionalReview(id, input, facts, this.reader.revision(id, input.contentRevision), actor);
      this.db.prepare(REVIEW_INSERT).run(...reviewValues(item) as SQLInputValue[]);
      return professionalDetail(this.facts(id));
    }, true);
  }
}
