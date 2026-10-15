import type { Account, ContentDraft, ContentRevision, ManagedSource, PublicationActionInput, PublicationApprovalInput, PublicationControlInput, PublicationSnapshotInput } from '../shared/contracts.js';
import { PostgresContext, PostgresRuntime, checkAccount } from './postgres-runtime.js';
import { PostgresProfessional } from './postgres-professional.js';
import { PostgresSourceChecks } from './postgres-source-checks.js';
import { fail } from './workflow.js';
import { qualificationFrom } from './professional-values.js';
import { verifyPublicationControls, verifyPublicationHistory } from './publication-integrity.js';
import { APPROVAL_INSERT, CONTROL_INSERT, PUBLICATION_EVENT_INSERT, SNAPSHOT_INSERT, approvalFrom, approvalValues, controlFrom, controlValues, eventFrom, newApproval, newControl, newPublicationEvent, newSnapshot, publicEducation, publicationEventValues, publicationWorkspace, snapshotFrom, snapshotValues, type EditorialProof, type PublicationFacts } from './publication-values.js';

type Reader = { source(id: string, revision?: number): Promise<ManagedSource | undefined>; draft(id: string): Promise<ContentDraft | undefined>; revision(id: string, revision: number): Promise<ContentRevision | undefined> };
const pg = (sql: string) => { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); };
export class PostgresPublication {
  constructor(private readonly runtime: PostgresRuntime, private readonly reader: (context: PostgresContext) => Reader) {}
  private async controls(context: PostgresContext) {
    const controls = (await context.all<Record<string, any>>('SELECT * FROM publication_controls ORDER BY version DESC')).map(controlFrom);
    verifyPublicationControls(controls); return controls;
  }
  async factsInTransaction(context: PostgresContext, id: string): Promise<PublicationFacts> {
    const ingredient = await context.get<{ name: string }>('SELECT name FROM ingredients WHERE id = $1', [id]) || fail(404, 'not_found', '食材不存在。');
    const professional = await new PostgresProfessional(this.runtime, this.reader).factsInTransaction(context, id);
    const snapshots = (await context.all<Record<string, any>>('SELECT * FROM publication_snapshots WHERE ingredient_id = $1 ORDER BY version DESC', [id])).map(snapshotFrom);
    const refs = new Map([...professional.draft?.content.sourceRefs || [], ...snapshots.flatMap((item) => item.basis.draft.content.sourceRefs)].map((ref) => [`${ref.id}:${ref.revision}`, ref]));
    const repository = new PostgresSourceChecks(this.runtime, this.reader); const sources = [];
    for (const ref of refs.values()) sources.push(await repository.factsInTransaction(context, ref.id, ref.revision));
    const revisions = [];
    for (const revision of new Set(snapshots.map((item) => item.basis.draft.revision))) revisions.push(await this.reader(context).revision(id, revision) || fail(409, 'publication_integrity', '固定正文版本缺失。'));
    const facts: PublicationFacts = { ingredientId: id, ingredientName: ingredient.name, professional, snapshots, sources, revisions,
      qualificationHistory: (await context.all<Record<string, any>>('SELECT * FROM professional_qualifications ORDER BY user_id, revision DESC')).map(qualificationFrom),
      editorial: await context.all<EditorialProof>('SELECT id AS "taskId", content_revision AS "contentRevision", digest AS "contentDigest", status, reviewed_by_id AS "reviewerId" FROM review_tasks WHERE ingredient_id = $1', [id]),
      approvals: (await context.all<Record<string, any>>('SELECT a.* FROM publication_approvals a JOIN publication_snapshots s ON s.id = a.snapshot_id WHERE s.ingredient_id = $1 ORDER BY a.version DESC, a.snapshot_id', [id])).map(approvalFrom),
      events: (await context.all<Record<string, any>>('SELECT * FROM publication_events WHERE ingredient_id = $1 ORDER BY version DESC', [id])).map(eventFrom), controls: await this.controls(context) };
    verifyPublicationHistory(facts); return facts;
  }
  workspace(id: string, enabled = false, focusVersion?: number) { return this.runtime.read(async (context) => publicationWorkspace(await this.factsInTransaction(context, id), enabled, focusVersion)); }
  snapshot(id: string, snapshotId: string) { return this.runtime.read(async (context) => (await this.factsInTransaction(context, id)).snapshots.find((item) => item.id === snapshotId) || fail(404, 'not_found', '固定快照不存在。')); }
  createSnapshot(id: string, input: PublicationSnapshotInput, actor: Account, token?: string) {
    return this.runtime.write(async (context) => { await checkAccount(context, actor, ['admin', 'editor'], token); const item = newSnapshot(input, await this.factsInTransaction(context, id), actor);
      await context.run(pg(SNAPSHOT_INSERT), snapshotValues(item)); return item; });
  }
  approve(id: string, input: PublicationApprovalInput, actor: Account, token?: string) {
    return this.runtime.write(async (context) => { await checkAccount(context, actor, ['admin'], token); const item = newApproval(input, await this.factsInTransaction(context, id), actor);
      await context.run(pg(APPROVAL_INSERT), approvalValues(item)); return item; });
  }
  action(id: string, input: PublicationActionInput, actor: Account, token?: string, enabled = false) {
    return this.runtime.write(async (context) => { await checkAccount(context, actor, ['admin'], token); const item = newPublicationEvent(input, await this.factsInTransaction(context, id), actor, enabled);
      await context.run(pg(PUBLICATION_EVENT_INSERT), publicationEventValues(item)); return item; });
  }
  control(input: PublicationControlInput, actor: Account, token?: string) {
    return this.runtime.write(async (context) => { await checkAccount(context, actor, ['admin'], token); const item = newControl(input, (await this.controls(context))[0], actor);
      await context.run(pg(CONTROL_INSERT), controlValues(item)); return item; });
  }
  controlHistory() { return this.runtime.read(async (context) => (await this.controls(context)).slice(0, 20)); }
  published(id: string, enabled = false) { return this.runtime.read(async (context) => publicEducation(await this.factsInTransaction(context, id), enabled)); }
}
