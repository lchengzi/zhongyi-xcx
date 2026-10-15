import { randomUUID } from 'node:crypto';
import type { Account, AssistantEvent, AssistantLimits, AssistantQuota, AssistantReservation, EvidenceLeaseRef, ExcerptInput, EvidenceExcerpt } from '../shared/contracts.js';
import type { AssistantStore } from './stores.js';
import { checkAccount, PostgresContext, PostgresRuntime } from './postgres-runtime.js';
import { fail } from './workflow.js';
import { checkEvidence, eventFrom, excerptDigest, excerptFrom, permissionDigest, validateExcerpt, withPermission, type AssistantEventRow, type ExcerptRow, type PermissionRow } from './assistant-values.js';
import { checkQuota, dayKey, leaseFrom, leaseRefs, quotaPolicy, type QuotaDayRow, type ReservationRow } from './assistant-limits.js';

export class PostgresAssistant implements AssistantStore {
  constructor(private readonly runtime: PostgresRuntime) {}
  private async present(context: PostgresContext, row: ExcerptRow): Promise<EvidenceExcerpt> {
    const permission = await context.get<PermissionRow>('SELECT * FROM excerpt_permissions WHERE excerpt_id = $1 ORDER BY revision DESC LIMIT 1', [row.id]);
    return withPermission(excerptFrom(row), permission);
  }
  private async excerptIn(context: PostgresContext, id: string): Promise<EvidenceExcerpt | undefined> {
    const row = await context.get<ExcerptRow>('SELECT * FROM editorial_excerpts WHERE id = $1', [id]); return row ? this.present(context, row) : undefined;
  }
  private async now(context: PostgresContext): Promise<number> { return (await context.get<{ now: number }>('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now'))!.now; }
  authorize(actor: Account, token: string): Promise<void> { return this.runtime.read((context) => checkAccount(context, actor, ['admin', 'editor'], token)); }
  excerpts(ingredientId: string, q = ''): Promise<EvidenceExcerpt[]> {
    return this.runtime.read(async (context) => Promise.all((await context.all<ExcerptRow>('SELECT * FROM editorial_excerpts WHERE ingredient_id = $1 AND strpos(lower(text || locator), $2) > 0 ORDER BY created_at DESC, id DESC LIMIT 50', [ingredientId, q.toLowerCase()])).map((row) => this.present(context, row))));
  }
  excerpt(id: string): Promise<EvidenceExcerpt | undefined> {
    return this.runtime.read((context) => this.excerptIn(context, id));
  }
  saveExcerpt(ingredientId: string, input: ExcerptInput, actor: Account, token: string): Promise<EvidenceExcerpt> {
    const value = validateExcerpt(input);
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'editor'], token);
      if (!await context.get('SELECT 1 FROM ingredients WHERE id = $1', [ingredientId])) fail(404, 'not_found', '食材不存在。');
      if (!await context.get('SELECT 1 FROM source_versions WHERE source_id = $1 AND revision = $2', [value.sourceId, value.sourceRevision])) fail(400, 'invalid_source_reference', '来源固定版本不存在。');
      const id = randomUUID();
      await context.run('INSERT INTO editorial_excerpts VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [id, ingredientId, value.sourceId, value.sourceRevision,
        value.locator, value.text, value.allowExternal ? 1 : 0, excerptDigest(ingredientId, value), actor.id, actor.username, new Date().toISOString()]);
      return excerptFrom((await context.get<ExcerptRow>('SELECT * FROM editorial_excerpts WHERE id = $1', [id]))!);
    });
  }
  record(event: AssistantEvent): Promise<void> {
    return this.runtime.write((context) => context.run('INSERT INTO assistant_events VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [event.id, event.ingredientId,
      event.actorId, event.actor, event.provider, event.model, event.status, event.requestDigest, event.resultDigest, event.errorCode, JSON.stringify(event.metrics), event.createdAt]));
  }
  events(): Promise<AssistantEvent[]> {
    return this.runtime.read(async (context) => (await context.all<AssistantEventRow>('SELECT * FROM assistant_events ORDER BY created_at DESC, id DESC LIMIT 50')).map(eventFrom));
  }
  permission(id: string, allowed: boolean, expectedRevision: number, actor: Account, token: string): Promise<EvidenceExcerpt> {
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'editor'], token);
      const row = await context.get<ExcerptRow>('SELECT * FROM editorial_excerpts WHERE id = $1', [id]);
      if (!row) fail(404, 'not_found', '摘录不存在。');
      if (row.author_id !== actor.id && actor.role !== 'admin') fail(403, 'forbidden', '只有录入者或管理员可更改此摘录的外部许可。');
      const excerpt = await this.present(context, row);
      if (excerpt.externalPermission.revision !== expectedRevision) fail(409, 'permission_conflict', '外部许可已被其他窗口修改，请重新读取。');
      const change = { id: randomUUID(), excerpt_id: id, revision: expectedRevision + 1, allow_external: allowed ? 1 : 0, actor_id: actor.id, actor_name: actor.username, created_at: new Date(await this.now(context)).toISOString() };
      await context.run('INSERT INTO excerpt_permissions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [change.id, id, change.revision, change.allow_external, actor.id, actor.username, change.created_at, permissionDigest(excerpt, change)]);
      return this.present(context, row);
    });
  }
  private async quotaIn(context: PostgresContext, actorId: string, limits: AssistantLimits, now: number): Promise<AssistantQuota> {
    const day = dayKey(now); const stored = await context.get<QuotaDayRow>('SELECT * FROM assistant_quota_days WHERE day_key = $1', [day]); const policy = quotaPolicy(stored, limits);
    const counts = (await context.get<{ total: number; actor: number }>('SELECT COUNT(*) total, COUNT(*) FILTER (WHERE actor_id = $1) actor FROM assistant_reservations WHERE day_key = $2', [actorId, day]))!;
    const active = (await context.get<{ total: number; actor: number }>('SELECT COUNT(*) total, COUNT(*) FILTER (WHERE r.actor_id = $1) actor FROM assistant_reservations r LEFT JOIN assistant_events e ON e.id = r.id WHERE e.id IS NULL AND r.expires_at > $2', [actorId, now]))!;
    return { day, ...policy, usedTotal: counts.total, usedByActor: counts.actor, activeTotal: active.total, activeByActor: active.actor };
  }
  quota(actorId: string, limits: AssistantLimits): Promise<AssistantQuota> { return this.runtime.read(async (context) => this.quotaIn(context, actorId, limits, await this.now(context))); }
  reserve(id: string, ingredientId: string, refs: EvidenceLeaseRef[], requestDigest: string, limits: AssistantLimits, actor: Account, token: string): Promise<AssistantReservation> {
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'editor'], token); const now = await this.now(context); const quota = await this.quotaIn(context, actor.id, limits, now); checkQuota(quota);
      const row: ReservationRow = { id, ingredient_id: ingredientId, actor_id: actor.id, day_key: quota.day, request_digest: requestDigest, evidence_payload: JSON.stringify(refs), created_at: now, expires_at: now + quota.limits.leaseMs };
      for (const ref of leaseRefs(row)) checkEvidence(await this.excerptIn(context, ref.id), ingredientId, ref);
      if (!await context.get('SELECT 1 FROM assistant_quota_days WHERE day_key = $1', [quota.day])) await context.run('INSERT INTO assistant_quota_days VALUES ($1, $2, $3)', [quota.day, JSON.stringify(quota.limits), now]);
      await context.run('INSERT INTO assistant_reservations VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, ingredientId, actor.id, quota.day, requestDigest, row.evidence_payload, now, row.expires_at]);
      return leaseFrom(row);
    });
  }
  private recordIn(context: PostgresContext, event: AssistantEvent): Promise<void> {
    return context.run('INSERT INTO assistant_events VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [event.id, event.ingredientId, event.actorId, event.actor, event.provider, event.model, event.status, event.requestDigest, event.resultDigest, event.errorCode, JSON.stringify(event.metrics), event.createdAt]);
  }
  complete(event: AssistantEvent, actor: Account, token: string): Promise<void> {
    return this.runtime.write(async (context) => {
      await checkAccount(context, actor, ['admin', 'editor'], token);
      const row = await context.get<ReservationRow>('SELECT * FROM assistant_reservations WHERE id = $1', [event.id]);
      if (!row || row.actor_id !== actor.id || row.ingredient_id !== event.ingredientId || row.request_digest !== event.requestDigest) fail(409, 'integrity_failure', '调用授权与结果不一致。');
      if (leaseFrom(row).expiresAt <= await this.now(context)) fail(409, 'assistant_lease_expired', '调用授权已过期，未交付迟到结果。');
      for (const ref of leaseRefs(row)) checkEvidence(await this.excerptIn(context, ref.id), row.ingredient_id, ref);
      await this.recordIn(context, event);
    });
  }
}
