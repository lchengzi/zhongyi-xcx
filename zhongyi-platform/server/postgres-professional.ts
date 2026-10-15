import type { Account, ContentDraft, ContentRevision, ProfessionalDecisionInput, QualificationInput } from '../shared/contracts.js';
import { checkAccount, PostgresContext, PostgresRuntime, accountColumns, toAccount, type StoredAccount } from './postgres-runtime.js';
import { fail, version } from './workflow.js';
import { CONTRIBUTOR_SQL, QUALIFICATION_INSERT, REVIEW_INSERT, newProfessionalReview, newQualification, professionalDetail, qualificationFrom, qualificationValues, reviewFrom, reviewValues, type ProfessionalFacts } from './professional-values.js';
import { latestQualifications } from './professional.js';

type Reader = { draft(id: string): Promise<ContentDraft | undefined>; revision(id: string, revision: number): Promise<ContentRevision | undefined> };
// Only fixed source-code SQL is translated; user values remain bound separately.
const pg = (sql: string) => { let parameter = 0; return sql.replace(/\?/g, () => `$${++parameter}`); };
export class PostgresProfessional {
  constructor(private readonly runtime: PostgresRuntime, private readonly reader: (context: PostgresContext) => Reader) {}
  private async history(context: PostgresContext, userId: string) {
    return (await context.all<Record<string, any>>('SELECT * FROM professional_qualifications WHERE user_id = $1 ORDER BY revision DESC LIMIT 20', [userId])).map(qualificationFrom);
  }
  private async facts(context: PostgresContext, id: string): Promise<ProfessionalFacts> {
    if (!await context.get('SELECT id FROM ingredients WHERE id = $1', [id])) fail(404, 'not_found', '食材不存在。');
    return { ingredientId: id, draft: await this.reader(context).draft(id), reviews: (await context.all<Record<string, any>>('SELECT * FROM professional_reviews WHERE ingredient_id = $1 ORDER BY version DESC', [id])).map(reviewFrom),
      qualifications: (await context.all<Record<string, any>>(latestQualifications)).map(qualificationFrom), users: (await context.all<StoredAccount>(`SELECT ${accountColumns} FROM users ORDER BY username`)).map(toAccount),
      contributorIds: (await context.all<{ id: string }>(pg(CONTRIBUTOR_SQL), [id, id, id, id])).map((row) => row.id) };
  }
  qualificationHistory(userId: string) { return this.runtime.read((context) => this.history(context, userId)); }
  professionalDetail(id: string) { return this.runtime.read(async (context) => professionalDetail(await this.facts(context, id))); }
  async detailInTransaction(context: PostgresContext, id: string) { return professionalDetail(await this.facts(context, id)); }
  async factsInTransaction(context: PostgresContext, id: string) { return this.facts(context, id); }
  saveQualification(userId: string, input: QualificationInput, expectedRevision: number, actor: Account, token?: string) {
    if (!version(expectedRevision, true)) fail(400, 'invalid_qualification', '资格修订号无效。');
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin'], token);
      const row = await context.get<StoredAccount>(`SELECT ${accountColumns} FROM users WHERE id = $1`, [userId]);
      if (!row) fail(404, 'not_found', '账号不存在。');
      const item = newQualification(input, (await this.history(context, userId))[0], expectedRevision, toAccount(row), actor);
      await context.run(pg(QUALIFICATION_INSERT), qualificationValues(item)); return item;
    });
  }
  recordProfessionalReview(id: string, input: ProfessionalDecisionInput, actor: Account, token?: string) {
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'reviewer'], token);
      const item = newProfessionalReview(id, input, await this.facts(context, id), await this.reader(context).revision(id, input.contentRevision), actor);
      await context.run(pg(REVIEW_INSERT), reviewValues(item)); return professionalDetail(await this.facts(context, id));
    });
  }
}
