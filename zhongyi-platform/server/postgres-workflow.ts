import { randomUUID } from 'node:crypto';
import type { Account, ContentDraft, ContentRevision, DraftContent, DraftDetail, DraftState, ManagedSource, ReviewTask, SourceInput, WorkflowEvent, QualificationInput, ProfessionalDecisionInput } from '../shared/contracts.js';
import { PostgresProfessional } from './postgres-professional.js';
import { PostgresSourceChecks } from './postgres-source-checks.js';
import type { SourceCheckInput } from '../shared/contracts.js';
import type { WorkflowStore } from './stores.js';
import { checkAccount, PostgresContext, PostgresRuntime } from './postgres-runtime.js';
import { contentRevisionDigest, fail, validateContent, validateSource, verifyContentRevision } from './workflow.js';

interface SourceRow extends SourceInput { id: string; revision: number; recordedBy: string; recordedAt: string }
interface RevisionRow { ingredientId: string; revision: number; payload: string; digest: string; baseReleaseId: string; authorId: string; author: string; createdAt: string }
interface DraftRow { revision: number; lockVersion: number; state: DraftState; ownerId: string; owner: string; updatedAt: string }
const taskColumns = `t.id, t.ingredient_id AS "ingredientId", i.name AS "ingredientName", t.content_revision AS revision, t.digest,
  t.status, t.submitted_by_id AS "submittedById", t.submitted_by_name AS "submittedBy", t.submitted_at AS "submittedAt",
  t.reviewed_by_name AS "reviewedBy", t.reviewed_at AS "reviewedAt", t.comment`;

// All calls in a view share one transaction/client, including nested reads of
// fixed versions. Never reacquire a pool connection from inside a transaction.
export class WorkflowView {
  constructor(readonly context: PostgresContext) {}
  async source(id: string, revision?: number): Promise<ManagedSource | undefined> {
    const row = await this.context.get<SourceRow>(`SELECT s.source_id AS id, s.revision, s.title, s.publisher, s.url,
      s.author_name AS "recordedBy", s.created_at AS "recordedAt" FROM source_versions s JOIN source_records r ON r.id = s.source_id
      WHERE s.source_id = $1 AND s.revision = COALESCE($2, r.revision)`, [id, revision ?? null]);
    return row ? { ...row, verificationState: 'pending', visibility: 'private' } : undefined;
  }
  async sources(q: string, page: number, pageSize: number) {
    const condition = "strpos(lower(s.title || ' ' || s.publisher || ' ' || s.url), $1) > 0";
    const join = 'FROM source_records r JOIN source_versions s ON s.source_id = r.id AND s.revision = r.revision';
    const total = (await this.context.get<{ count: number }>(`SELECT COUNT(*) AS count ${join} WHERE ${condition}`, [q.toLowerCase()]))!.count;
    const rows = await this.context.all<{ id: string }>(`SELECT r.id ${join} WHERE ${condition} ORDER BY s.created_at DESC, r.id COLLATE "C" LIMIT $2 OFFSET $3`, [q.toLowerCase(), pageSize, (page - 1) * pageSize]);
    const items: ManagedSource[] = [];
    for (const row of rows) items.push((await this.source(row.id))!);
    return { items, total, page, pageSize };
  }
  async revision(id: string, revision: number): Promise<ContentRevision | undefined> {
    const row = await this.context.get<RevisionRow>(`SELECT ingredient_id AS "ingredientId", revision, payload, digest,
      base_release_id AS "baseReleaseId", author_id AS "authorId", author_name AS author, created_at AS "createdAt"
      FROM content_revisions WHERE ingredient_id = $1 AND revision = $2`, [id, revision]);
    if (!row) return;
    const { payload, ...head } = row;
    const refs = await this.context.all<{ id: string; revision: number }>('SELECT source_id AS id, source_revision AS revision FROM revision_sources WHERE ingredient_id = $1 AND content_revision = $2 ORDER BY position', [id, revision]);
    const sources: ManagedSource[] = [];
    for (const ref of refs) sources.push((await this.source(ref.id, ref.revision))!);
    return { ...head, content: JSON.parse(payload), sources };
  }
  async draft(id: string): Promise<ContentDraft | undefined> {
    const row = await this.context.get<DraftRow>('SELECT revision, lock_version AS "lockVersion", state, owner_id AS "ownerId", owner_name AS owner, updated_at AS "updatedAt" FROM content_drafts WHERE ingredient_id = $1', [id]);
    if (!row) return;
    return { ...(await this.revision(id, row.revision))!, ...row, visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false };
  }
  async detail(id: string): Promise<DraftDetail> {
    const versions = await this.context.all<{ revision: number }>('SELECT revision FROM content_revisions WHERE ingredient_id = $1 ORDER BY revision DESC LIMIT 20', [id]);
    const tasks = await this.context.all<ReviewTask>(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.ingredient_id = $1 ORDER BY t.submitted_at DESC, t.id DESC LIMIT 20`, [id]);
    const contributors = await this.context.all<{ id: string }>('SELECT DISTINCT author_id AS id FROM content_revisions WHERE ingredient_id = $1', [id]);
    const revisions: ContentRevision[] = [];
    for (const version of versions) revisions.push((await this.revision(id, version.revision))!);
    return { draft: await this.draft(id) || null, revisions, tasks, contributorIds: contributors.map((row) => row.id) };
  }
  task(id: string): Promise<ReviewTask | undefined> {
    return this.context.get(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.id = $1`, [id]);
  }
  async tasks(status: ReviewTask['status'], page: number, pageSize: number) {
    const total = (await this.context.get<{ count: number }>('SELECT COUNT(*) AS count FROM review_tasks WHERE status = $1', [status]))!.count;
    const items = await this.context.all<ReviewTask>(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.status = $1 ORDER BY t.submitted_at, t.id LIMIT $2 OFFSET $3`, [status, pageSize, (page - 1) * pageSize]);
    return { items, total, page, pageSize };
  }
  event(action: WorkflowEvent['action'], ingredientId: string | null, sourceId: string | null, revision: number, actor: Account): Promise<void> {
    return this.context.run('INSERT INTO workflow_events (ingredient_id, source_id, revision, action, actor_id, actor_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [ingredientId, sourceId, revision, action, actor.id, actor.username, new Date().toISOString()]);
  }
  events(): Promise<WorkflowEvent[]> {
    return this.context.all('SELECT id, ingredient_id AS "ingredientId", source_id AS "sourceId", revision, action, actor_name AS actor, created_at AS "createdAt" FROM workflow_events ORDER BY id DESC LIMIT 50');
  }
}

function editable(current: ContentDraft | undefined, expected: number, actor: Account): void {
  if ((current?.lockVersion || 0) !== expected) fail(409, 'revision_conflict', '草稿或审阅状态已被修改，请重新加载；当前输入未保存。');
  if (current && current.ownerId !== actor.id && actor.role !== 'admin') fail(403, 'forbidden', '仅草稿作者或管理员可以修订和提交。');
}

export class PostgresWorkflow implements WorkflowStore {
  constructor(private readonly runtime: PostgresRuntime) {}
  private professional() { return new PostgresProfessional(this.runtime, (context) => new WorkflowView(context)); }
  qualificationHistory(id: string) { return this.professional().qualificationHistory(id); }
  professionalDetail(id: string) { return this.professional().professionalDetail(id); }
  saveQualification(id: string, input: QualificationInput, expected: number, actor: Account, token?: string) { return this.professional().saveQualification(id, input, expected, actor, token); }
  recordProfessionalReview(id: string, input: ProfessionalDecisionInput, actor: Account, token?: string) { return this.professional().recordProfessionalReview(id, input, actor, token); }
  sourceCheck(id: string, revision: number) { return new PostgresSourceChecks(this.runtime, (context) => new WorkflowView(context)).sourceCheck(id, revision); }
  saveSourceCheck(id: string, input: SourceCheckInput, expected: number, actor: Account, token?: string) { return new PostgresSourceChecks(this.runtime, (context) => new WorkflowView(context)).saveSourceCheck(id, input, expected, actor, token); }
  publicationPreflight(id: string) { return new PostgresSourceChecks(this.runtime, (context) => new WorkflowView(context)).publicationPreflight(id); }
  private read<T>(work: (view: WorkflowView) => Promise<T>): Promise<T> { return this.runtime.read((context) => work(new WorkflowView(context))); }
  private write<T>(actor: Account, roles: Account['role'][], token: string | undefined, work: (view: WorkflowView) => Promise<T>): Promise<T> {
    return this.runtime.write(async (context) => { await checkAccount(context, actor, roles, token); return work(new WorkflowView(context)); });
  }
  source(id: string, revision?: number) { return this.read((view) => view.source(id, revision)); }
  sources(q: string, page: number, pageSize: number) { return this.read((view) => view.sources(q, page, pageSize)); }
  revision(id: string, revision: number) { return this.read((view) => view.revision(id, revision)); }
  draft(id: string) { return this.read((view) => view.draft(id)); }
  detail(id: string) { return this.read((view) => view.detail(id)); }
  task(id: string) { return this.read((view) => view.task(id)); }
  tasks(status: ReviewTask['status'], page: number, pageSize: number) { return this.read((view) => view.tasks(status, page, pageSize)); }
  events() { return this.read((view) => view.events()); }
  saveSource(input: SourceInput, actor: Account, id?: string, expectedRevision = 0, sessionToken?: string): Promise<ManagedSource> {
    const value = validateSource(input);
    return this.write(actor, ['admin', 'editor'], sessionToken, async (view) => {
      const current = id ? await view.source(id) : undefined;
      if (id && !current) fail(404, 'not_found', '来源不存在。');
      if ((current?.revision || 0) !== expectedRevision) fail(409, 'revision_conflict', '来源已被修改，请刷新；当前输入未保存。');
      const duplicate = await view.context.get<{ id: string }>('SELECT id FROM source_records WHERE url = $1', [value.url]);
      if (duplicate && duplicate.id !== id) fail(409, 'duplicate_source', '此网址已登记，请使用已有来源。');
      const sourceId = id || randomUUID(); const revision = expectedRevision + 1;
      await view.context.run(`INSERT INTO source_records (id, revision, url) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, url = excluded.url`, [sourceId, revision, value.url]);
      await view.context.run('INSERT INTO source_versions (source_id, revision, title, publisher, url, author_id, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [sourceId, revision, value.title, value.publisher, value.url, actor.id, actor.username, new Date().toISOString()]);
      await view.event(current ? 'source_updated' : 'source_created', null, sourceId, revision, actor);
      return (await view.source(sourceId))!;
    });
  }
  saveDraft(id: string, input: DraftContent, expectedLockVersion: number, actor: Account, sessionToken?: string): Promise<ContentDraft> {
    const content = validateContent(input);
    return this.write(actor, ['admin', 'editor'], sessionToken, async (view) => {
      if (!await view.context.get('SELECT id FROM ingredients WHERE id = $1', [id])) fail(404, 'not_found', '食材不存在。');
      const current = await view.draft(id); editable(current, expectedLockVersion, actor);
      if (current?.state === 'submitted') fail(409, 'submitted_locked', '已提交版本不可修改，请等待审阅结果。');
      const sources: ManagedSource[] = [];
      for (const ref of content.sourceRefs) sources.push(await view.source(ref.id, ref.revision) || fail(400, 'invalid_source_reference', '引用的来源版本不存在。'));
      const baseReleaseId = (await view.context.get<{ value: string }>("SELECT value FROM metadata WHERE key = 'releaseId'"))!.value;
      const digest = contentRevisionDigest(baseReleaseId, id, content, sources);
      const revision = (current?.revision || 0) + 1; const now = new Date().toISOString();
      await view.context.run('INSERT INTO content_revisions (ingredient_id, revision, payload, digest, base_release_id, author_id, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, revision, JSON.stringify(content), digest, baseReleaseId, actor.id, actor.username, now]);
      for (const [position, ref] of content.sourceRefs.entries()) await view.context.run('INSERT INTO revision_sources (ingredient_id, content_revision, source_id, source_revision, locator, position) VALUES ($1, $2, $3, $4, $5, $6)', [id, revision, ref.id, ref.revision, ref.locator, position]);
      await view.context.run(`INSERT INTO content_drafts (ingredient_id, revision, lock_version, state, owner_id, owner_name, updated_at) VALUES ($1, $2, $3, 'draft', $4, $5, $6)
        ON CONFLICT (ingredient_id) DO UPDATE SET revision = excluded.revision, lock_version = excluded.lock_version, state = 'draft', updated_at = excluded.updated_at`, [id, revision, expectedLockVersion + 1, current?.ownerId || actor.id, current?.owner || actor.username, now]);
      await view.event('draft_saved', id, null, revision, actor);
      return (await view.draft(id))!;
    });
  }
  submit(id: string, expectedLockVersion: number, actor: Account, sessionToken?: string): Promise<{ draft: ContentDraft; task: ReviewTask }> {
    return this.write(actor, ['admin', 'editor'], sessionToken, async (view) => {
      const current = await view.draft(id); editable(current, expectedLockVersion, actor);
      if (!current) fail(404, 'not_found', '请先保存内容草稿。');
      if (current.state !== 'draft') fail(409, 'invalid_transition', '仅已保存草稿可提交；退回或通过后需保存新修订。');
      verifyContentRevision(current);
      if (!current.content.educationText || !current.content.safetyText || !current.content.sourceRefs.length) fail(400, 'incomplete_draft', '提交需包含教育说明、安全边界和至少一条带定位的来源。');
      const taskId = randomUUID(); const now = new Date().toISOString();
      await view.context.run(`INSERT INTO review_tasks (id, ingredient_id, content_revision, digest, status, submitted_by_id, submitted_by_name, submitted_at)
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`, [taskId, id, current.revision, current.digest, actor.id, actor.username, now]);
      await view.context.run("UPDATE content_drafts SET state = 'submitted', lock_version = lock_version + 1, updated_at = $1 WHERE ingredient_id = $2", [now, id]);
      await view.event('draft_submitted', id, null, current.revision, actor);
      return { draft: (await view.draft(id))!, task: (await view.task(taskId))! };
    });
  }
  decide(taskId: string, decision: 'accept' | 'return', comment: string, expectedLockVersion: number, actor: Account, sessionToken?: string): Promise<ContentDraft> {
    return this.write(actor, ['admin', 'reviewer'], sessionToken, async (view) => {
      const task = await view.task(taskId);
      if (!task) fail(404, 'not_found', '审阅任务不存在。');
      const current = await view.draft(task.ingredientId);
      if (!current || task.status !== 'pending' || current.state !== 'submitted' || current.lockVersion !== expectedLockVersion || current.revision !== task.revision || current.digest !== task.digest) fail(409, 'revision_conflict', '此任务已处理或草稿状态变化，请重新加载。');
      verifyContentRevision(current);
      if (task.submittedById === actor.id || await view.context.get('SELECT 1 FROM content_revisions WHERE ingredient_id = $1 AND author_id = $2 LIMIT 1', [task.ingredientId, actor.id])) fail(403, 'self_review', '参与此条目编辑或提交的账号不能审阅该条目。');
      if (!['accept', 'return'].includes(decision) || typeof comment !== 'string' || comment.trim().length > 1000 || !comment.trim()) fail(400, 'invalid_decision', '审阅需明确结果及最多 1000 字意见。');
      const now = new Date().toISOString();
      await view.context.run('UPDATE review_tasks SET status = $1, reviewed_by_id = $2, reviewed_by_name = $3, reviewed_at = $4, comment = $5 WHERE id = $6', [decision === 'accept' ? 'accepted' : 'returned', actor.id, actor.username, now, comment.trim(), taskId]);
      await view.context.run('UPDATE content_drafts SET state = $1, lock_version = lock_version + 1, updated_at = $2 WHERE ingredient_id = $3', [decision === 'accept' ? 'editorial_accepted' : 'changes_requested', now, task.ingredientId]);
      await view.event(decision === 'accept' ? 'review_accepted' : 'review_returned', task.ingredientId, null, current.revision, actor);
      return (await view.draft(task.ingredientId))!;
    });
  }
}
