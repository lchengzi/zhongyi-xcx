import type { Account, ContentDraft, ContentRevision, ManagedSource, SourceCheckInput } from '../shared/contracts.js';
import { checkAccount, PostgresContext, PostgresRuntime, accountColumns, toAccount, type StoredAccount } from './postgres-runtime.js';
import { PostgresProfessional } from './postgres-professional.js';
import { fail, version } from './workflow.js';
import { newSourceCheck, publicationPreflight, sourceCheckDetail, sourceCheckFrom, sourceCheckValues, SOURCE_CHECK_INSERT, type SourceCheckFacts } from './source-check-values.js';

type Reader = { source(id: string, revision?: number): Promise<ManagedSource | undefined>; draft(id: string): Promise<ContentDraft | undefined>; revision(id: string, revision: number): Promise<ContentRevision | undefined> };
export class PostgresSourceChecks {
  constructor(private readonly runtime: PostgresRuntime, private readonly reader: (context: PostgresContext) => Reader) {}
  private async facts(context: PostgresContext, id: string, revision: number): Promise<SourceCheckFacts> {
    const source = await this.reader(context).source(id, revision) || fail(404, 'not_found', '固定来源版本不存在。');
    return { source, checks: (await context.all<Record<string, any>>('SELECT * FROM source_checks WHERE source_id = $1 ORDER BY version DESC', [id])).map(sourceCheckFrom),
      users: (await context.all<StoredAccount>(`SELECT ${accountColumns} FROM users ORDER BY username`)).map(toAccount),
      authorIds: (await context.all<{ id: string }>('SELECT DISTINCT author_id AS id FROM source_versions WHERE source_id = $1', [id])).map((item) => item.id) };
  }
  sourceCheck(id: string, revision: number) { return this.runtime.read(async (context) => sourceCheckDetail(await this.facts(context, id, revision))); }
  async factsInTransaction(context: PostgresContext, id: string, revision: number) { return this.facts(context, id, revision); }
  saveSourceCheck(id: string, input: SourceCheckInput, expectedVersion: number, actor: Account, token?: string) {
    if (!version(expectedVersion, true)) fail(400, 'invalid_source_check', '核验协作版本无效。');
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'reviewer'], token);
      const facts = await this.facts(context, id, input.sourceRevision); const item = newSourceCheck(input, expectedVersion, facts, actor);
      for (const ingredientId of item.ingredientIds) if (!await context.get('SELECT id FROM ingredients WHERE id = $1', [ingredientId])) fail(400, 'invalid_source_scope', '适用范围包含未知食材。');
      let index = 0; const sql = SOURCE_CHECK_INSERT.replace(/\?/g, () => `$${++index}`);
      await context.run(sql, sourceCheckValues(item)); return sourceCheckDetail(await this.facts(context, id, input.sourceRevision));
    });
  }
  publicationPreflight(id: string) {
    return this.runtime.read(async (context) => {
      const professional = await new PostgresProfessional(this.runtime, this.reader).detailInTransaction(context, id);
      const details = [];
      for (const ref of professional.draft?.content.sourceRefs || []) details.push(sourceCheckDetail(await this.facts(context, ref.id, ref.revision)));
      return publicationPreflight(id, professional, details);
    });
  }
}
