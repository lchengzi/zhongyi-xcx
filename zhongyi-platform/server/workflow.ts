import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Account, ContentDraft, ContentRevision, DraftContent, DraftDetail, DraftState, ManagedSource, ReviewTask, SourceInput, WorkflowEvent, QualificationInput, ProfessionalDecisionInput } from '../shared/contracts.js';
import { AccountError, AuthRepository } from './auth.js';
import { ProfessionalRepository } from './professional.js';
import { SourceCheckRepository } from './source-checks.js';
import type { SourceCheckInput } from '../shared/contracts.js';

export function fail(status: number, code: string, message: string): never { throw new AccountError(status, code, message); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length <= max;
export const version = (value: unknown, initial = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (initial ? 0 : 1);

export function validateSource(value: unknown): SourceInput {
  if (!exact(value, ['title', 'publisher', 'url']) || !bounded(value.title, 200) || !value.title.trim() ||
    !bounded(value.publisher, 120) || !value.publisher.trim() || !bounded(value.url, 1000)) fail(400, 'invalid_source', '来源需包含标题、发布机构和有效网址。');
  let url: URL;
  try { url = new URL(value.url.trim()); } catch { return fail(400, 'invalid_source', '来源网址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 1000) fail(400, 'invalid_source', '来源仅支持不带账号密码、规范化后不超过 1000 字的 HTTP/HTTPS 网址。');
  return { title: value.title.trim(), publisher: value.publisher.trim(), url: url.href };
}
export function validateContent(value: unknown): DraftContent {
  if (!exact(value, ['ediblePart', 'latinName', 'educationText', 'safetyText', 'sourceRefs']) ||
    !bounded(value.ediblePart, 200) || !bounded(value.latinName, 200) || !bounded(value.educationText, 1600) ||
    !bounded(value.safetyText, 1000) || !Array.isArray(value.sourceRefs) || value.sourceRefs.length > 10) fail(400, 'invalid_content', '草稿字段、长度或来源数量无效。');
  const seen = new Set<string>();
  const refs = value.sourceRefs.map((ref) => {
    if (!exact(ref, ['id', 'revision', 'locator']) || !bounded(ref.id, 80) || !ref.id || !version(ref.revision) ||
      !bounded(ref.locator, 400) || !ref.locator.trim() || seen.has(ref.id)) fail(400, 'invalid_content', '来源引用需包含唯一来源、固定版本和原文定位。');
    seen.add(ref.id);
    return { id: ref.id, revision: ref.revision, locator: ref.locator.trim() };
  });
  return { ediblePart: value.ediblePart.trim(), latinName: value.latinName.trim(), educationText: value.educationText.trim(), safetyText: value.safetyText.trim(), sourceRefs: refs };
}
interface SourceRow extends SourceInput { id: string; revision: number; recordedBy: string; recordedAt: string }
interface RevisionRow { ingredientId: string; revision: number; payload: string; digest: string; baseReleaseId: string; authorId: string; author: string; createdAt: string }
interface DraftRow { revision: number; lockVersion: number; state: DraftState; ownerId: string; owner: string; updatedAt: string }
const taskColumns = `t.id, t.ingredient_id ingredientId, i.name ingredientName, t.content_revision revision, t.digest,
  t.status, t.submitted_by_id submittedById, t.submitted_by_name submittedBy, t.submitted_at submittedAt,
  t.reviewed_by_name reviewedBy, t.reviewed_at reviewedAt, t.comment`;

export function contentRevisionDigest(baseReleaseId: string, ingredientId: string, content: DraftContent, sources: ManagedSource[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ baseReleaseId, ingredientId, content, sources })).digest('hex')}`;
}
export function verifyContentRevision(current: ContentRevision): void {
  const digest = contentRevisionDigest(current.baseReleaseId, current.ingredientId, current.content, current.sources);
  if (current.content.sourceRefs.length !== current.sources.length || current.sources.some((source, index) =>
    !source || source.id !== current.content.sourceRefs[index].id || source.revision !== current.content.sourceRefs[index].revision) || digest !== current.digest) {
    fail(409, 'integrity_failure', '内容或来源版本完整性校验失败，请联系管理员。');
  }
}

export class WorkflowRepository {
  constructor(private readonly db: DatabaseSync) {}
  qualificationHistory(id: string) { return new ProfessionalRepository(this.db, this).qualificationHistory(id); }
  professionalDetail(id: string) { return new ProfessionalRepository(this.db, this).professionalDetail(id); }
  saveQualification(id: string, input: QualificationInput, expected: number, actor: Account, token?: string) { return new ProfessionalRepository(this.db, this).saveQualification(id, input, expected, actor, token); }
  recordProfessionalReview(id: string, input: ProfessionalDecisionInput, actor: Account, token?: string) { return new ProfessionalRepository(this.db, this).recordProfessionalReview(id, input, actor, token); }
  sourceCheck(id: string, revision: number) { return new SourceCheckRepository(this.db, this).sourceCheck(id, revision); }
  saveSourceCheck(id: string, input: SourceCheckInput, expected: number, actor: Account, token?: string) { return new SourceCheckRepository(this.db, this).saveSourceCheck(id, input, expected, actor, token); }
  publicationPreflight(id: string) { return new SourceCheckRepository(this.db, this).publicationPreflight(id); }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private checkAccount(actor: Account, allowed: Account['role'][], sessionToken?: string): void {
    const row = this.db.prepare('SELECT role, active, revision FROM users WHERE id = ?').get(actor.id) as { role: Account['role']; active: number; revision: number } | undefined;
    if (!row?.active || row.role !== actor.role || row.revision !== actor.revision || !allowed.includes(row.role)) fail(403, 'forbidden', '当前账号没有此操作权限，或权限已变化。');
    if (sessionToken !== undefined && new AuthRepository(this.db).session(sessionToken)?.user.id !== actor.id) fail(401, 'unauthorized', '会话已失效，请重新登录。');
  }
  private event(action: WorkflowEvent['action'], ingredientId: string | null, sourceId: string | null, revision: number, actor: Account): void {
    this.db.prepare('INSERT INTO workflow_events (ingredient_id, source_id, revision, action, actor_id, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ingredientId, sourceId, revision, action, actor.id, actor.username, new Date().toISOString());
  }
  events(): WorkflowEvent[] {
    return this.db.prepare('SELECT id, ingredient_id ingredientId, source_id sourceId, revision, action, actor_name actor, created_at createdAt FROM workflow_events ORDER BY id DESC LIMIT 50').all() as unknown as WorkflowEvent[];
  }
  source(id: string, revision?: number): ManagedSource | undefined {
    const row = this.db.prepare(`SELECT s.source_id id, s.revision, s.title, s.publisher, s.url, s.author_name recordedBy, s.created_at recordedAt
      FROM source_versions s JOIN source_records r ON r.id = s.source_id WHERE s.source_id = ? AND s.revision = COALESCE(?, r.revision)`)
      .get(id, revision ?? null) as unknown as SourceRow | undefined;
    return row ? { ...row, verificationState: 'pending', visibility: 'private' } : undefined;
  }
  sources(q: string, page: number, pageSize: number) {
    const filter = q.toLowerCase();
    const condition = "instr(lower(s.title || ' ' || s.publisher || ' ' || s.url), ?) > 0";
    const join = 'FROM source_records r JOIN source_versions s ON s.source_id = r.id AND s.revision = r.revision';
    const total = (this.db.prepare(`SELECT COUNT(*) count ${join} WHERE ${condition}`).get(filter) as { count: number }).count;
    const rows = this.db.prepare(`SELECT r.id ${join} WHERE ${condition} ORDER BY s.created_at DESC, r.id LIMIT ? OFFSET ?`).all(filter, pageSize, (page - 1) * pageSize) as { id: string }[];
    return { items: rows.map((row) => this.source(row.id)!), total, page, pageSize };
  }
  saveSource(input: SourceInput, actor: Account, id?: string, expectedRevision = 0, sessionToken?: string): ManagedSource {
    const value = validateSource(input);
    return this.transaction(() => {
      this.checkAccount(actor, ['admin', 'editor'], sessionToken);
      const current = id ? this.source(id) : undefined;
      if (id && !current) fail(404, 'not_found', '来源不存在。');
      if ((current?.revision || 0) !== expectedRevision) fail(409, 'revision_conflict', '来源已被修改，请刷新；当前输入未保存。');
      const duplicate = this.db.prepare('SELECT id FROM source_records WHERE url = ?').get(value.url) as { id: string } | undefined;
      if (duplicate && duplicate.id !== id) fail(409, 'duplicate_source', '此网址已登记，请使用已有来源。');
      const sourceId = id || randomUUID(); const revision = expectedRevision + 1;
      this.db.prepare(`INSERT INTO source_records VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, url = excluded.url`).run(sourceId, revision, value.url);
      this.db.prepare('INSERT INTO source_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sourceId, revision, value.title, value.publisher, value.url, actor.id, actor.username, new Date().toISOString());
      this.event(current ? 'source_updated' : 'source_created', null, sourceId, revision, actor);
      return this.source(sourceId)!;
    });
  }
  revision(id: string, revision: number): ContentRevision | undefined {
    const row = this.db.prepare(`SELECT ingredient_id ingredientId, revision, payload, digest, base_release_id baseReleaseId,
      author_id authorId, author_name author, created_at createdAt FROM content_revisions WHERE ingredient_id = ? AND revision = ?`)
      .get(id, revision) as unknown as RevisionRow | undefined;
    if (!row) return;
    const { payload, ...head } = row;
    const refs = this.db.prepare('SELECT source_id id, source_revision revision FROM revision_sources WHERE ingredient_id = ? AND content_revision = ? ORDER BY position').all(id, revision) as { id: string; revision: number }[];
    return { ...head, content: JSON.parse(payload), sources: refs.map((ref) => this.source(ref.id, ref.revision)!) };
  }
  draft(id: string): ContentDraft | undefined {
    const row = this.db.prepare(`SELECT revision, lock_version lockVersion, state, owner_id ownerId, owner_name owner, updated_at updatedAt FROM content_drafts WHERE ingredient_id = ?`)
      .get(id) as unknown as DraftRow | undefined;
    if (!row) return;
    return { ...this.revision(id, row.revision)!, ...row, visibility: 'private', professionalReviewState: 'pending', publicationEnabled: false };
  }
  detail(id: string): DraftDetail {
    const versions = this.db.prepare('SELECT revision FROM content_revisions WHERE ingredient_id = ? ORDER BY revision DESC LIMIT 20').all(id) as { revision: number }[];
    const tasks = this.db.prepare(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.ingredient_id = ? ORDER BY t.submitted_at DESC, t.id DESC LIMIT 20`).all(id) as unknown as ReviewTask[];
    const contributors = this.db.prepare('SELECT DISTINCT author_id id FROM content_revisions WHERE ingredient_id = ?').all(id) as { id: string }[];
    return { draft: this.draft(id) || null, revisions: versions.map((row) => this.revision(id, row.revision)!), tasks, contributorIds: contributors.map((row) => row.id) };
  }
  private editable(current: ContentDraft | undefined, expected: number, actor: Account): void {
    if ((current?.lockVersion || 0) !== expected) fail(409, 'revision_conflict', '草稿或审阅状态已被修改，请重新加载；当前输入未保存。');
    if (current && current.ownerId !== actor.id && actor.role !== 'admin') fail(403, 'forbidden', '仅草稿作者或管理员可以修订和提交。');
  }
  private verifyRevision(current: ContentRevision): void {
    verifyContentRevision(current);
  }
  saveDraft(id: string, input: DraftContent, expectedLockVersion: number, actor: Account, sessionToken?: string): ContentDraft {
    const content = validateContent(input);
    return this.transaction(() => {
      this.checkAccount(actor, ['admin', 'editor'], sessionToken);
      if (!this.db.prepare('SELECT id FROM ingredients WHERE id = ?').get(id)) fail(404, 'not_found', '食材不存在。');
      const current = this.draft(id); this.editable(current, expectedLockVersion, actor);
      if (current?.state === 'submitted') fail(409, 'submitted_locked', '已提交版本不可修改，请等待审阅结果。');
      const sources = content.sourceRefs.map((ref) => this.source(ref.id, ref.revision) || fail(400, 'invalid_source_reference', '引用的来源版本不存在。'));
      const baseReleaseId = String(this.db.prepare("SELECT value FROM metadata WHERE key = 'releaseId'").get()!.value);
      const digest = contentRevisionDigest(baseReleaseId, id, content, sources);
      const revision = (current?.revision || 0) + 1; const now = new Date().toISOString();
      this.db.prepare('INSERT INTO content_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, revision, JSON.stringify(content), digest, baseReleaseId, actor.id, actor.username, now);
      content.sourceRefs.forEach((ref, position) => this.db.prepare('INSERT INTO revision_sources VALUES (?, ?, ?, ?, ?, ?)').run(id, revision, ref.id, ref.revision, ref.locator, position));
      this.db.prepare(`INSERT INTO content_drafts VALUES (?, ?, ?, 'draft', ?, ?, ?) ON CONFLICT(ingredient_id)
        DO UPDATE SET revision = excluded.revision, lock_version = excluded.lock_version, state = 'draft', updated_at = excluded.updated_at`)
        .run(id, revision, expectedLockVersion + 1, current?.ownerId || actor.id, current?.owner || actor.username, now);
      this.event('draft_saved', id, null, revision, actor);
      return this.draft(id)!;
    });
  }
  submit(id: string, expectedLockVersion: number, actor: Account, sessionToken?: string): { draft: ContentDraft; task: ReviewTask } {
    return this.transaction(() => {
      this.checkAccount(actor, ['admin', 'editor'], sessionToken);
      const current = this.draft(id); this.editable(current, expectedLockVersion, actor);
      if (!current) fail(404, 'not_found', '请先保存内容草稿。');
      if (current.state !== 'draft') fail(409, 'invalid_transition', '仅已保存草稿可提交；退回或通过后需保存新修订。');
      this.verifyRevision(current);
      if (!current.content.educationText || !current.content.safetyText || !current.content.sourceRefs.length) fail(400, 'incomplete_draft', '提交需包含教育说明、安全边界和至少一条带定位的来源。');
      const taskId = randomUUID(); const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO review_tasks (id, ingredient_id, content_revision, digest, status, submitted_by_id, submitted_by_name, submitted_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`).run(taskId, id, current.revision, current.digest, actor.id, actor.username, now);
      this.db.prepare("UPDATE content_drafts SET state = 'submitted', lock_version = lock_version + 1, updated_at = ? WHERE ingredient_id = ?").run(now, id);
      this.event('draft_submitted', id, null, current.revision, actor);
      return { draft: this.draft(id)!, task: this.task(taskId)! };
    });
  }
  task(id: string): ReviewTask | undefined {
    return this.db.prepare(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.id = ?`).get(id) as unknown as ReviewTask | undefined;
  }
  tasks(status: ReviewTask['status'], page: number, pageSize: number) {
    const total = (this.db.prepare('SELECT COUNT(*) count FROM review_tasks WHERE status = ?').get(status) as { count: number }).count;
    const items = this.db.prepare(`SELECT ${taskColumns} FROM review_tasks t JOIN ingredients i ON i.id = t.ingredient_id WHERE t.status = ? ORDER BY t.submitted_at, t.id LIMIT ? OFFSET ?`).all(status, pageSize, (page - 1) * pageSize) as unknown as ReviewTask[];
    return { items, total, page, pageSize };
  }
  decide(taskId: string, decision: 'accept' | 'return', comment: string, expectedLockVersion: number, actor: Account, sessionToken?: string): ContentDraft {
    return this.transaction(() => {
      this.checkAccount(actor, ['admin', 'reviewer'], sessionToken);
      const task = this.task(taskId);
      if (!task) fail(404, 'not_found', '审阅任务不存在。');
      const current = this.draft(task.ingredientId);
      if (!current || task.status !== 'pending' || current.state !== 'submitted' || current.lockVersion !== expectedLockVersion ||
        current.revision !== task.revision || current.digest !== task.digest) fail(409, 'revision_conflict', '此任务已处理或草稿状态变化，请重新加载。');
      this.verifyRevision(current);
      if (task.submittedById === actor.id || this.db.prepare('SELECT 1 FROM content_revisions WHERE ingredient_id = ? AND author_id = ? LIMIT 1').get(task.ingredientId, actor.id)) {
        fail(403, 'self_review', '参与此条目编辑或提交的账号不能审阅该条目。');
      }
      if (!['accept', 'return'].includes(decision) || !bounded(comment, 1000) || !comment.trim()) fail(400, 'invalid_decision', '审阅需明确结果及最多 1000 字意见。');
      const now = new Date().toISOString();
      this.db.prepare('UPDATE review_tasks SET status = ?, reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = ?, comment = ? WHERE id = ?')
        .run(decision === 'accept' ? 'accepted' : 'returned', actor.id, actor.username, now, comment.trim(), taskId);
      this.db.prepare('UPDATE content_drafts SET state = ?, lock_version = lock_version + 1, updated_at = ? WHERE ingredient_id = ?')
        .run(decision === 'accept' ? 'editorial_accepted' : 'changes_requested', now, task.ingredientId);
      this.event(decision === 'accept' ? 'review_accepted' : 'review_returned', task.ingredientId, null, current.revision, actor);
      return this.draft(task.ingredientId)!;
    });
  }
}
