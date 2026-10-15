import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Account, AssistantEvent, AssistantLimits, AssistantQuota, AssistantReservation, EvidenceLeaseRef, ExcerptInput, EvidenceExcerpt } from '../shared/contracts.js';
import { AuthRepository } from './auth.js';
import { fail } from './workflow.js';
import { checkEvidence, eventFrom, excerptDigest, excerptFrom, permissionDigest, validateExcerpt, withPermission, type AssistantEventRow, type ExcerptRow, type PermissionRow } from './assistant-values.js';
import { checkQuota, dayKey, leaseFrom, leaseRefs, quotaPolicy, type QuotaDayRow, type ReservationRow } from './assistant-limits.js';

export class AssistantRepository {
  constructor(private readonly db: DatabaseSync) {}
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private now(): number { return Number(this.db.prepare("SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) now").get()!.now); }
  private present(row: ExcerptRow): EvidenceExcerpt {
    const permission = this.db.prepare('SELECT * FROM excerpt_permissions WHERE excerpt_id = ? ORDER BY revision DESC LIMIT 1').get(row.id) as unknown as PermissionRow | undefined;
    return withPermission(excerptFrom(row), permission);
  }
  authorize(actor: Account, token: string): void {
    const current = new AuthRepository(this.db).session(token)?.user;
    if (!current || current.id !== actor.id || current.revision !== actor.revision || current.role === 'reviewer') fail(403, 'forbidden', '会话或编辑权限已变化。');
  }
  excerpts(ingredientId: string, q = ''): EvidenceExcerpt[] {
    const rows = this.db.prepare('SELECT * FROM editorial_excerpts WHERE ingredient_id = ? AND instr(lower(text || locator), ?) > 0 ORDER BY created_at DESC, id DESC LIMIT 50')
      .all(ingredientId, q.toLowerCase()) as unknown as ExcerptRow[];
    return rows.map((row) => this.present(row));
  }
  excerpt(id: string): EvidenceExcerpt | undefined {
    const row = this.db.prepare('SELECT * FROM editorial_excerpts WHERE id = ?').get(id) as unknown as ExcerptRow | undefined;
    return row ? this.present(row) : undefined;
  }
  saveExcerpt(ingredientId: string, input: ExcerptInput, actor: Account, token: string): EvidenceExcerpt {
    const value = validateExcerpt(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.authorize(actor, token);
      if (!this.db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(ingredientId)) fail(404, 'not_found', '食材不存在。');
      if (!this.db.prepare('SELECT 1 FROM source_versions WHERE source_id = ? AND revision = ?').get(value.sourceId, value.sourceRevision)) fail(400, 'invalid_source_reference', '来源固定版本不存在。');
      const id = randomUUID();
      this.db.prepare('INSERT INTO editorial_excerpts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, ingredientId, value.sourceId, value.sourceRevision,
        value.locator, value.text, value.allowExternal ? 1 : 0, excerptDigest(ingredientId, value), actor.id, actor.username, new Date().toISOString());
      const result = this.excerpt(id)!; this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  record(event: AssistantEvent): void {
    // Service-owned terminal audit. No prompt, response, password or API key.
    this.db.prepare('INSERT INTO assistant_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(event.id, event.ingredientId, event.actorId,
      event.actor, event.provider, event.model, event.status, event.requestDigest, event.resultDigest, event.errorCode, JSON.stringify(event.metrics), event.createdAt);
  }
  events(): AssistantEvent[] { return (this.db.prepare('SELECT * FROM assistant_events ORDER BY created_at DESC, id DESC LIMIT 50').all() as unknown as AssistantEventRow[]).map(eventFrom); }
  permission(id: string, allowed: boolean, expectedRevision: number, actor: Account, token: string): EvidenceExcerpt {
    return this.transaction(() => {
      this.authorize(actor, token);
      const row = this.db.prepare('SELECT * FROM editorial_excerpts WHERE id = ?').get(id) as unknown as ExcerptRow | undefined;
      if (!row) fail(404, 'not_found', '摘录不存在。');
      if (row.author_id !== actor.id && actor.role !== 'admin') fail(403, 'forbidden', '只有录入者或管理员可更改此摘录的外部许可。');
      const excerpt = this.present(row);
      if (excerpt.externalPermission.revision !== expectedRevision) fail(409, 'permission_conflict', '外部许可已被其他窗口修改，请重新读取。');
      const change = { id: randomUUID(), excerpt_id: id, revision: expectedRevision + 1, allow_external: allowed ? 1 : 0, actor_id: actor.id, actor_name: actor.username, created_at: new Date(this.now()).toISOString() };
      this.db.prepare('INSERT INTO excerpt_permissions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(change.id, id, change.revision, change.allow_external, actor.id, actor.username, change.created_at, permissionDigest(excerpt, change));
      return this.present(row);
    });
  }
  private quotaIn(actorId: string, limits: AssistantLimits, now: number): AssistantQuota {
    const day = dayKey(now); const stored = this.db.prepare('SELECT * FROM assistant_quota_days WHERE day_key = ?').get(day) as unknown as QuotaDayRow | undefined;
    const policy = quotaPolicy(stored, limits);
    const counts = this.db.prepare('SELECT COUNT(*) total, COALESCE(SUM(actor_id = ?), 0) actor FROM assistant_reservations WHERE day_key = ?').get(actorId, day)!;
    const active = this.db.prepare('SELECT COUNT(*) total, COALESCE(SUM(r.actor_id = ?), 0) actor FROM assistant_reservations r LEFT JOIN assistant_events e ON e.id = r.id WHERE e.id IS NULL AND r.expires_at > ?').get(actorId, now)!;
    return { day, ...policy, usedTotal: Number(counts.total), usedByActor: Number(counts.actor), activeTotal: Number(active.total), activeByActor: Number(active.actor) };
  }
  quota(actorId: string, limits: AssistantLimits): AssistantQuota { return this.transaction(() => this.quotaIn(actorId, limits, this.now())); }
  reserve(id: string, ingredientId: string, refs: EvidenceLeaseRef[], requestDigest: string, limits: AssistantLimits, actor: Account, token: string): AssistantReservation {
    return this.transaction(() => {
      this.authorize(actor, token); const now = this.now(); const quota = this.quotaIn(actor.id, limits, now); checkQuota(quota);
      const row: ReservationRow = { id, ingredient_id: ingredientId, actor_id: actor.id, day_key: quota.day, request_digest: requestDigest, evidence_payload: JSON.stringify(refs), created_at: now, expires_at: now + quota.limits.leaseMs };
      for (const ref of leaseRefs(row)) checkEvidence(this.excerpt(ref.id), ingredientId, ref);
      if (!this.db.prepare('SELECT 1 FROM assistant_quota_days WHERE day_key = ?').get(quota.day)) this.db.prepare('INSERT INTO assistant_quota_days VALUES (?, ?, ?)').run(quota.day, JSON.stringify(quota.limits), now);
      this.db.prepare('INSERT INTO assistant_reservations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ingredientId, actor.id, quota.day, requestDigest, row.evidence_payload, now, row.expires_at);
      return leaseFrom(row);
    });
  }
  complete(event: AssistantEvent, actor: Account, token: string): void {
    this.transaction(() => {
      this.authorize(actor, token);
      const row = this.db.prepare('SELECT * FROM assistant_reservations WHERE id = ?').get(event.id) as unknown as ReservationRow | undefined;
      if (!row || row.actor_id !== actor.id || row.ingredient_id !== event.ingredientId || row.request_digest !== event.requestDigest) fail(409, 'integrity_failure', '调用授权与结果不一致。');
      if (leaseFrom(row).expiresAt <= this.now()) fail(409, 'assistant_lease_expired', '调用授权已过期，未交付迟到结果。');
      for (const ref of leaseRefs(row)) checkEvidence(this.excerpt(ref.id), row.ingredient_id, ref);
      this.record(event);
    });
  }
}
