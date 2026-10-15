import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Account, PublicationActionInput, PublicationApprovalInput, PublicationControlInput, PublicationSnapshotInput } from '../shared/contracts.js';
import { AuthRepository } from './auth.js';
import { ProfessionalRepository } from './professional.js';
import { SourceCheckRepository } from './source-checks.js';
import { fail, type WorkflowRepository } from './workflow.js';
import { qualificationFrom } from './professional-values.js';
import { verifyPublicationControls, verifyPublicationHistory } from './publication-integrity.js';
import { APPROVAL_INSERT, CONTROL_INSERT, PUBLICATION_EVENT_INSERT, SNAPSHOT_INSERT, approvalFrom, approvalValues, controlFrom, controlValues, eventFrom, newApproval, newControl, newPublicationEvent, newSnapshot, publicEducation, publicationEventValues, publicationWorkspace, snapshotFrom, snapshotValues, type EditorialProof, type PublicationFacts } from './publication-values.js';

type Reader = Pick<WorkflowRepository, 'source' | 'draft' | 'revision'>;
export class PublicationRepository {
  constructor(private readonly db: DatabaseSync, private readonly reader: Reader) {}
  private transaction<T>(work: () => T, write = false): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private authorize(actor: Account, roles: Account['role'][], token?: string) {
    const auth = new AuthRepository(this.db); const current = auth.users().find((user) => user.id === actor.id);
    if (!current?.active || current.role !== actor.role || current.revision !== actor.revision || !roles.includes(current.role)) fail(403, 'forbidden', '账号权限已变化或不能执行发布操作。');
    if (token !== undefined && auth.session(token)?.user.id !== actor.id) fail(401, 'unauthorized', '会话已失效。');
  }
  private controls() {
    const controls = this.db.prepare('SELECT * FROM publication_controls ORDER BY version DESC').all().map(controlFrom);
    verifyPublicationControls(controls); return controls;
  }
  factsInTransaction(id: string): PublicationFacts {
    const ingredient = this.db.prepare('SELECT name FROM ingredients WHERE id = ?').get(id) as { name: string } | undefined;
    if (!ingredient) fail(404, 'not_found', '食材不存在。');
    const professional = new ProfessionalRepository(this.db, this.reader).factsInTransaction(id);
    const snapshots = this.db.prepare('SELECT * FROM publication_snapshots WHERE ingredient_id = ? ORDER BY version DESC').all(id).map(snapshotFrom);
    const refs = new Map([...professional.draft?.content.sourceRefs || [], ...snapshots.flatMap((item) => item.basis.draft.content.sourceRefs)].map((ref) => [`${ref.id}:${ref.revision}`, ref]));
    const sourceRepository = new SourceCheckRepository(this.db, this.reader);
    const facts: PublicationFacts = { ingredientId: id, ingredientName: ingredient.name, professional, snapshots,
      revisions: [...new Set(snapshots.map((item) => item.basis.draft.revision))].map((revision) => this.reader.revision(id, revision) || fail(409, 'publication_integrity', '固定正文版本缺失。')),
      qualificationHistory: this.db.prepare('SELECT * FROM professional_qualifications ORDER BY user_id, revision DESC').all().map(qualificationFrom),
      sources: [...refs.values()].map((ref) => sourceRepository.factsInTransaction(ref.id, ref.revision)),
      editorial: this.db.prepare('SELECT id AS taskId, content_revision AS contentRevision, digest AS contentDigest, status, reviewed_by_id AS reviewerId FROM review_tasks WHERE ingredient_id = ?').all(id) as unknown as EditorialProof[],
      approvals: this.db.prepare('SELECT a.* FROM publication_approvals a JOIN publication_snapshots s ON s.id = a.snapshot_id WHERE s.ingredient_id = ? ORDER BY a.version DESC, a.snapshot_id').all(id).map(approvalFrom),
      events: this.db.prepare('SELECT * FROM publication_events WHERE ingredient_id = ? ORDER BY version DESC').all(id).map(eventFrom), controls: this.controls() };
    verifyPublicationHistory(facts); return facts;
  }
  workspace(id: string, enabled = false, focusVersion?: number) { return this.transaction(() => publicationWorkspace(this.factsInTransaction(id), enabled, focusVersion)); }
  snapshot(id: string, snapshotId: string) { return this.transaction(() => this.factsInTransaction(id).snapshots.find((item) => item.id === snapshotId) || fail(404, 'not_found', '固定快照不存在。')); }
  createSnapshot(id: string, input: PublicationSnapshotInput, actor: Account, token?: string) {
    return this.transaction(() => { this.authorize(actor, ['admin', 'editor'], token); const item = newSnapshot(input, this.factsInTransaction(id), actor);
      this.db.prepare(SNAPSHOT_INSERT).run(...snapshotValues(item) as SQLInputValue[]); return item; }, true);
  }
  approve(id: string, input: PublicationApprovalInput, actor: Account, token?: string) {
    return this.transaction(() => { this.authorize(actor, ['admin'], token); const item = newApproval(input, this.factsInTransaction(id), actor);
      this.db.prepare(APPROVAL_INSERT).run(...approvalValues(item) as SQLInputValue[]); return item; }, true);
  }
  action(id: string, input: PublicationActionInput, actor: Account, token?: string, enabled = false) {
    return this.transaction(() => { this.authorize(actor, ['admin'], token); const item = newPublicationEvent(input, this.factsInTransaction(id), actor, enabled);
      this.db.prepare(PUBLICATION_EVENT_INSERT).run(...publicationEventValues(item) as SQLInputValue[]); return item; }, true);
  }
  control(input: PublicationControlInput, actor: Account, token?: string) {
    return this.transaction(() => { this.authorize(actor, ['admin'], token); const item = newControl(input, this.controls()[0], actor);
      this.db.prepare(CONTROL_INSERT).run(...controlValues(item) as SQLInputValue[]); return item; }, true);
  }
  controlHistory() { return this.transaction(() => this.controls().slice(0, 20)); }
  published(id: string, enabled = false) { return this.transaction(() => publicEducation(this.factsInTransaction(id), enabled)); }
}
