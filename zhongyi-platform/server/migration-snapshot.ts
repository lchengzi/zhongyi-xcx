import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CatalogSeed, ManagedSource } from '../shared/contracts.js';
import { validateSeed } from './seed.js';
import { validateContent } from './workflow.js';
import { excerptFrom, withPermission, type ExcerptRow, type PermissionRow } from './assistant-values.js';
import { dayKey, leaseFrom, leaseRefs, validateLimits, type ReservationRow } from './assistant-limits.js';
import { qualificationFrom, reviewFrom } from './professional-values.js';
import { sourceCheckFrom, sourceDigest } from './source-check-values.js';
import { validatePublicationTables } from './publication-snapshot.js';
import { PHOTO_NOTE_COLUMNS, photoNoteFrom } from './photo-note-values.js';
import { PHOTO_SUBMISSION_COLUMNS, photoSubmissionFrom } from './photo-submission-values.js';
import { PHOTO_RIGHTS_COLUMNS } from './photo-rights-values.js';
import { validPhotoRightsTables } from './photo-rights-snapshot.js';
import { PHOTO_PROFESSIONAL_COLUMNS } from './photo-professional-values.js';
import { validPhotoProfessionalTables } from './photo-professional-snapshot.js';

// Dependency order for the destination. The source is never altered to fit it.
export const TABLES = {
  migrations: { columns: ['version', 'applied_at'], order: ['version'] },
  ingredients: { columns: ['id', 'name', 'search_text', 'payload'], order: ['id'] },
  metadata: { columns: ['key', 'value'], order: ['key'] },
  editorial_notes: { columns: ['ingredient_id', 'text', 'revision', 'updated_at'], order: ['ingredient_id'] },
  audit_events: { columns: ['id', 'ingredient_id', 'action', 'revision', 'created_at', 'actor'], order: ['id'] },
  users: { columns: ['id', 'username', 'password_hash', 'password_salt', 'role', 'active', 'revision', 'created_at'], order: ['id'] },
  sessions: { columns: ['token_hash', 'user_id', 'csrf_token', 'expires_at'], order: ['token_hash'] },
  login_attempts: { columns: ['key', 'attempts', 'reset_at'], order: ['key'] },
  security_events: { columns: ['id', 'actor', 'action', 'target', 'created_at'], order: ['id'] },
  source_records: { columns: ['id', 'revision', 'url'], order: ['id'] },
  source_versions: { columns: ['source_id', 'revision', 'title', 'publisher', 'url', 'author_id', 'author_name', 'created_at'], order: ['source_id', 'revision'] },
  content_revisions: { columns: ['ingredient_id', 'revision', 'payload', 'digest', 'base_release_id', 'author_id', 'author_name', 'created_at'], order: ['ingredient_id', 'revision'] },
  revision_sources: { columns: ['ingredient_id', 'content_revision', 'source_id', 'source_revision', 'locator', 'position'], order: ['ingredient_id', 'content_revision', 'position'] },
  content_drafts: { columns: ['ingredient_id', 'revision', 'lock_version', 'state', 'owner_id', 'owner_name', 'updated_at'], order: ['ingredient_id'] },
  review_tasks: { columns: ['id', 'ingredient_id', 'content_revision', 'digest', 'status', 'submitted_by_id', 'submitted_by_name', 'submitted_at', 'reviewed_by_id', 'reviewed_by_name', 'reviewed_at', 'comment'], order: ['id'] },
  workflow_events: { columns: ['id', 'ingredient_id', 'source_id', 'revision', 'action', 'actor_id', 'actor_name', 'created_at'], order: ['id'] },
  editorial_excerpts: { columns: ['id', 'ingredient_id', 'source_id', 'source_revision', 'locator', 'text', 'allow_external', 'digest', 'author_id', 'author_name', 'created_at'], order: ['id'] },
  assistant_events: { columns: ['id', 'ingredient_id', 'actor_id', 'actor_name', 'provider', 'model', 'status', 'request_digest', 'result_digest', 'error_code', 'metrics_payload', 'created_at'], order: ['id'] },
  excerpt_permissions: { columns: ['id', 'excerpt_id', 'revision', 'allow_external', 'actor_id', 'actor_name', 'created_at', 'digest'], order: ['excerpt_id', 'revision'] },
  assistant_quota_days: { columns: ['day_key', 'limits_payload', 'created_at'], order: ['day_key'] },
  assistant_reservations: { columns: ['id', 'ingredient_id', 'actor_id', 'day_key', 'request_digest', 'evidence_payload', 'created_at', 'expires_at'], order: ['id'] },
  professional_qualifications: { columns: ['user_id', 'revision', 'profession', 'status', 'evidence_kind', 'evidence_reference', 'valid_until', 'comment', 'verification_confirmed', 'account_revision', 'actor_id', 'actor_name', 'created_at', 'digest'], order: ['user_id', 'revision'] },
  professional_reviews: { columns: ['ingredient_id', 'version', 'content_revision', 'content_digest', 'profession', 'decision', 'qualification_user_id', 'qualification_revision', 'actor_id', 'actor_name', 'account_revision', 'comment', 'created_at', 'digest'], order: ['ingredient_id', 'version'] },
  source_checks: { columns: ['source_id', 'version', 'source_revision', 'source_digest', 'decision', 'evidence_kind', 'scope_payload', 'authority', 'checked_at', 'valid_until', 'evidence_reference', 'comment', 'verification_confirmed', 'actor_id', 'actor_name', 'account_revision', 'created_at', 'digest'], order: ['source_id', 'version'] },
  publication_snapshots: { columns: ['id', 'ingredient_id', 'version', 'content_revision', 'basis_payload', 'basis_digest', 'actor_id', 'actor_name', 'account_revision', 'comment', 'created_at', 'digest'], order: ['ingredient_id', 'version'] },
  publication_approvals: { columns: ['snapshot_id', 'version', 'snapshot_digest', 'decision', 'control_epoch', 'actor_id', 'actor_name', 'account_revision', 'comment', 'created_at', 'digest'], order: ['snapshot_id', 'version'] },
  publication_events: { columns: ['ingredient_id', 'version', 'action', 'snapshot_id', 'approval_version', 'control_epoch', 'previous_digest', 'actor_id', 'actor_name', 'account_revision', 'comment', 'created_at', 'digest'], order: ['ingredient_id', 'version'] },
  publication_controls: { columns: ['version', 'action', 'epoch', 'kind', 'actor_id', 'actor_name', 'account_revision', 'evidence_reference', 'comment', 'created_at', 'digest'], order: ['version'] },
  photo_notes: { columns: PHOTO_NOTE_COLUMNS, order: ['candidate_id', 'version'] },
  photo_submissions: { columns: PHOTO_SUBMISSION_COLUMNS, order: ['candidate_id', 'version'] },
  photo_rights_reviews: { columns: PHOTO_RIGHTS_COLUMNS, order: ['candidate_id', 'version'] },
  photo_professional_reviews: { columns: PHOTO_PROFESSIONAL_COLUMNS, order: ['candidate_id', 'version'] }
} as const;
export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];
export const BASE_TABLE_NAMES = TABLE_NAMES.slice(0, 16);
export const EXCERPT_TABLE_NAMES = TABLE_NAMES.slice(0, 18);
export const CONTROL_TABLE_NAMES = TABLE_NAMES.slice(0, 21);
export const PROFESSIONAL_TABLE_NAMES = TABLE_NAMES.slice(0, 23);
export const SOURCE_CHECK_TABLE_NAMES = TABLE_NAMES.slice(0, 24);
export const PUBLICATION_TABLE_NAMES = TABLE_NAMES.slice(24, 28);
export const snapshotTableNames = (snapshot: Pick<MigrationSnapshot, 'schemaVersion'>): TableName[] => snapshot.schemaVersion === 1 ? BASE_TABLE_NAMES : snapshot.schemaVersion === 2 ? EXCERPT_TABLE_NAMES : snapshot.schemaVersion === 3 ? CONTROL_TABLE_NAMES : snapshot.schemaVersion === 4 ? PROFESSIONAL_TABLE_NAMES : snapshot.schemaVersion === 5 ? SOURCE_CHECK_TABLE_NAMES : snapshot.schemaVersion === 6 ? TABLE_NAMES.slice(0, 28) : snapshot.schemaVersion === 7 ? TABLE_NAMES.slice(0, 29) : snapshot.schemaVersion === 8 ? TABLE_NAMES.slice(0, 30) : snapshot.schemaVersion === 9 ? TABLE_NAMES.slice(0, 31) : TABLE_NAMES;
export const SEQUENCE_TABLES = ['audit_events', 'security_events', 'workflow_events'] as const;
export type Row = Record<string, string | number | null>;
export interface MigrationSnapshot {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  sourceSchemaVersion: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  seedDigest: string;
  tables: Record<TableName, Row[]>;
  sequences: Record<typeof SEQUENCE_TABLES[number], number>;
  digest: string;
}
export const SOURCE_SCHEMA_VERSIONS: readonly MigrationSnapshot['sourceSchemaVersion'][] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export class MigrationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new MigrationError(code, message); };
export const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const snapshotDigest = (snapshot: Omit<MigrationSnapshot, 'digest'>) => hash(JSON.stringify(snapshot));
export const rowCounts = (snapshot: MigrationSnapshot) => Object.fromEntries(snapshotTableNames(snapshot).map((name) => [name, snapshot.tables[name].length]));
export const identifier = (name: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name) || name.startsWith('pg_') || ['public', 'information_schema'].includes(name)) {
    return fail('invalid_schema', '目标必须是专用、有效的 schema 名称，不能使用 public 或系统 schema。');
  }
  return `"${name}"`;
};

export function normalizeRow(name: TableName, raw: Record<string, unknown>): Row {
  const columns = TABLES[name].columns;
  if (Object.keys(raw).length !== columns.length || columns.some((key) => !Object.hasOwn(raw, key))) fail('invalid_row', '迁移行字段不完整或包含未知字段。');
  const result: Row = {};
  for (const key of columns) {
    const value = raw[key];
    if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
      fail('invalid_value', '迁移只接受文本、空值及安全范围内的整数。');
    }
    if (typeof value === 'string' && value.includes('\0')) fail('invalid_value', '迁移文本包含 PostgreSQL 不支持的空字符。');
    result[key] = value as Row[string];
  }
  return result;
}

export function validateSnapshot(value: MigrationSnapshot, seedInput: unknown): MigrationSnapshot {
  const seed = validateSeed(seedInput);
  if (!value || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(value.schemaVersion) || value.sourceSchemaVersion !== value.schemaVersion + 2 || value.seedDigest !== seed.digest ||
    Object.keys(value).sort().join() !== ['schemaVersion', 'sourceSchemaVersion', 'seedDigest', 'tables', 'sequences', 'digest'].sort().join() ||
    !value.tables || Object.keys(value.tables).sort().join() !== snapshotTableNames(value).slice().sort().join() ||
    !value.sequences || Object.keys(value.sequences).sort().join() !== SEQUENCE_TABLES.slice().sort().join()) {
    return fail('invalid_snapshot', '迁移快照结构或基础目录版本不匹配。');
  }
  const { digest, ...payload } = value;
  if (snapshotDigest(payload) !== digest) fail('snapshot_changed', '迁移快照摘要不匹配。');
  validateBusinessTables(value.tables, value.sequences, seed, value.sourceSchemaVersion, value.schemaVersion);
  return value;
}

// A PostgreSQL backup has CURRENT business tables but retains the historical
// SQLite migration journal (possibly v3/v4). Validate these independently;
// never manufacture SQLite migration rows to describe PostgreSQL upgrades.
export function validateBusinessTables(tables: Record<TableName, Row[]>, sequences: MigrationSnapshot['sequences'], seedInput: unknown,
  sqliteVersion: MigrationSnapshot['sourceSchemaVersion'], format: MigrationSnapshot['schemaVersion'] = 10): void {
  const seed = validateSeed(seedInput); const value = { tables, sequences, sourceSchemaVersion: sqliteVersion, schemaVersion: format };
  if (!SOURCE_SCHEMA_VERSIONS.includes(sqliteVersion) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(format) || !tables || Object.keys(tables).sort().join() !== snapshotTableNames(value).slice().sort().join() ||
    !sequences || Object.keys(sequences).sort().join() !== SEQUENCE_TABLES.slice().sort().join()) fail('invalid_snapshot', '业务表、序列或历史迁移版本无效。');
  for (const name of snapshotTableNames(value)) {
    if (!Array.isArray(value.tables[name])) fail('invalid_snapshot', '迁移表必须是数组。');
    value.tables[name].forEach((row) => normalizeRow(name, row));
  }
  for (const name of SEQUENCE_TABLES) {
    const sequence = value.sequences[name];
    if (!Number.isSafeInteger(sequence) || sequence < 0 || value.tables[name].some((row) => Number(row.id) > sequence)) {
      fail('invalid_sequence', '源库自增序列不能小于现有记录，或超出安全整数范围。');
    }
  }
  if (value.tables.migrations.map((row) => row.version).sort((a, b) => Number(a) - Number(b)).join() !== Array.from({ length: value.sourceSchemaVersion }, (_, index) => index + 1).join()) fail('unsupported_source', '只接受 schema v3 至 v12 源库，不在只读迁移中修改源库。');
  const metadata = Object.fromEntries(value.tables.metadata.map((row) => [String(row.key), row.value]));
  if (metadata.seedDigest !== seed.digest || metadata.releaseId !== seed.releaseId ||
    metadata.contentVersion !== seed.contentVersion || metadata.sourceAsOf !== seed.sourceAsOf || !metadata.importedAt) {
    fail('catalog_changed', '源库目录元数据与受验证导入不匹配。');
  }
  const ingredients = new Map(value.tables.ingredients.map((row) => [row.id, row]));
  if (ingredients.size !== seed.ingredients.length) fail('catalog_changed', '源库目录条目数不匹配。');
  validateSeed({ ...seed, ingredients: seed.ingredients.map((item) => {
    const row = ingredients.get(item.id) || fail('catalog_changed', '源库目录缺少条目。');
    const parsed = JSON.parse(String(row.payload));
    if (row.name !== parsed.name || row.id !== parsed.id || row.search_text !== [parsed.name, parsed.pinyin, ...parsed.aliases].join(' ').toLowerCase()) fail('catalog_changed', '源库目录索引与正文不匹配。');
    return parsed;
  }) });
  const sources = new Map(value.tables.source_versions.map((row) => [`${row.source_id}:${row.revision}`, row]));
  for (const head of value.tables.source_records) {
    const row = sources.get(`${head.id}:${head.revision}`);
    if (!row || row.url !== head.url) fail('source_head_changed', '来源头未指向一致的固定版本。');
  }
  const revisions = new Map(value.tables.content_revisions.map((row) => [`${row.ingredient_id}:${row.revision}`, row]));
  for (const row of value.tables.content_revisions) {
    const content = JSON.parse(String(row.payload)); validateContent(content);
    const refs = value.tables.revision_sources.filter((ref) => ref.ingredient_id === row.ingredient_id && ref.content_revision === row.revision)
      .sort((a, b) => Number(a.position) - Number(b.position));
    if (refs.length !== content.sourceRefs.length || refs.some((ref, i) => ref.position !== i || ref.source_id !== content.sourceRefs[i].id ||
      ref.source_revision !== content.sourceRefs[i].revision || ref.locator !== content.sourceRefs[i].locator)) fail('revision_changed', '固定来源引用或定位不完整。');
    const managed = refs.map((ref): ManagedSource => {
      const source = sources.get(`${ref.source_id}:${ref.source_revision}`); if (!source) return fail('revision_changed', '引用来源版本缺失。');
      return { id: String(source.source_id), revision: Number(source.revision), title: String(source.title), publisher: String(source.publisher),
        url: String(source.url), recordedBy: String(source.author_name), recordedAt: String(source.created_at), verificationState: 'pending', visibility: 'private' };
    });
    if (hash(JSON.stringify({ baseReleaseId: row.base_release_id, ingredientId: row.ingredient_id, content, sources: managed })) !== row.digest) {
      fail('revision_changed', '内容修订与固定来源摘要不一致。');
    }
  }
  for (const task of value.tables.review_tasks) {
    if (revisions.get(`${task.ingredient_id}:${task.content_revision}`)?.digest !== task.digest) fail('task_changed', '审阅任务与修订摘要不一致。');
  }
  for (const draft of value.tables.content_drafts) {
    if (!revisions.has(`${draft.ingredient_id}:${draft.revision}`)) fail('draft_changed', '草稿头缺少对应修订。');
    const pending = value.tables.review_tasks.filter((task) => task.ingredient_id === draft.ingredient_id && task.status === 'pending');
    if (draft.state === 'submitted' ? pending.length !== 1 || pending[0].content_revision !== draft.revision : pending.length !== 0) {
      fail('draft_changed', '草稿状态和待处理任务不一致。');
    }
  }
  if (value.schemaVersion >= 2) {
    for (const row of value.tables.editorial_excerpts) {
      const item = excerptFrom(row as unknown as ExcerptRow);
      if (!ingredients.has(item.ingredientId) || !sources.has(`${item.sourceId}:${item.sourceRevision}`)) fail('excerpt_changed', '摘录的条目或固定来源缺失。');
    }
    for (const row of value.tables.assistant_events) {
      const metrics = JSON.parse(String(row.metrics_payload));
      if (!ingredients.has(row.ingredient_id) || !['disabled', 'openai', 'test-fixture'].includes(String(row.provider)) ||
        !['completed', 'failed', 'refused'].includes(String(row.status)) || !Number.isSafeInteger(metrics.durationMs) || metrics.durationMs < 0 ||
        ['inputTokens', 'outputTokens'].some((key) => metrics[key] !== null && (!Number.isSafeInteger(metrics[key]) || metrics[key] < 0)) ||
        (metrics.estimatedCostUsd !== null && (typeof metrics.estimatedCostUsd !== 'number' || !Number.isFinite(metrics.estimatedCostUsd) || metrics.estimatedCostUsd < 0))) fail('event_changed', '辅助调用元数据无效。');
    }
  }
  if (value.schemaVersion >= 3) {
    const users = new Set(value.tables.users.map((row) => row.id));
    const excerpts = new Map(value.tables.editorial_excerpts.map((row) => [row.id, excerptFrom(row as unknown as ExcerptRow)]));
    const permissionVersions = new Map<string, number>();
    const permissions = value.tables.excerpt_permissions.slice().sort((a, b) => String(a.excerpt_id).localeCompare(String(b.excerpt_id)) || Number(a.revision) - Number(b.revision));
    for (const row of permissions) {
      const item = excerpts.get(row.excerpt_id); const prior = permissionVersions.get(String(row.excerpt_id)) || 0;
      if (!item || !users.has(row.actor_id) || row.revision !== prior + 1) fail('permission_changed', '外部许可历史缺失或顺序不一致。');
      withPermission(item!, row as unknown as PermissionRow); permissionVersions.set(String(row.excerpt_id), Number(row.revision));
    }
    const days = new Set(value.tables.assistant_quota_days.map((row) => row.day_key));
    for (const row of value.tables.assistant_quota_days) {
      validateLimits(JSON.parse(String(row.limits_payload)));
      if (!Number.isSafeInteger(row.created_at) || dayKey(Number(row.created_at)) !== row.day_key) fail('quota_changed', '每日额度记录无效。');
    }
    for (const row of value.tables.assistant_reservations) {
      const reservation = row as unknown as ReservationRow; leaseFrom(reservation);
      if (!users.has(row.actor_id) || !ingredients.has(row.ingredient_id) || !days.has(row.day_key) || !/^sha256:[a-f0-9]{64}$/.test(String(row.request_digest))) fail('reservation_changed', '调用授权关系无效。');
      for (const ref of leaseRefs(reservation)) {
        const item = excerpts.get(ref.id);
        if (!item || item.digest !== ref.digest || item.ingredientId !== row.ingredient_id || ref.permissionRevision > (permissionVersions.get(ref.id) || 0)) fail('reservation_changed', '调用授权固定引用无效。');
      }
    }
  }
  if (value.schemaVersion >= 4) {
    const users = new Map(tables.users.map((row) => [row.id, row]));
    const qualifications = new Map<string, ReturnType<typeof qualificationFrom>>();
    const credentialVersions = new Map<string, number>();
    for (const row of tables.professional_qualifications.slice().sort((a, b) => String(a.user_id).localeCompare(String(b.user_id)) || Number(a.revision) - Number(b.revision))) {
      const item = qualificationFrom(row); const prior = credentialVersions.get(item.userId) || 0;
      if (item.revision !== prior + 1 || !users.has(item.userId) || !users.has(item.recordedById) || item.accountRevision > Number(users.get(item.userId)!.revision) ||
        (item.status === 'verified' && item.userId === item.recordedById)) fail('qualification_changed', '资格核验历史关系或版本无效。');
      qualifications.set(`${item.userId}:${item.revision}`, item); credentialVersions.set(item.userId, item.revision);
    }
    const reviewVersions = new Map<string, number>();
    for (const row of tables.professional_reviews.slice().sort((a, b) => String(a.ingredient_id).localeCompare(String(b.ingredient_id)) || Number(a.version) - Number(b.version))) {
      const item = reviewFrom(row); const qualification = qualifications.get(`${item.qualificationUserId}:${item.qualificationRevision}`);
      const revision = revisions.get(`${item.ingredientId}:${item.contentRevision}`);
      if (item.version !== (reviewVersions.get(item.ingredientId) || 0) + 1 || !qualification || qualification.profession !== item.profession ||
        !users.has(item.actorId) || item.accountRevision > Number(users.get(item.actorId)!.revision) || revision?.digest !== item.contentDigest ||
        (item.decision !== 'revoke' && (qualification.status !== 'verified' || item.actorId !== item.qualificationUserId || item.accountRevision !== qualification.accountRevision ||
          Date.parse(item.recordedAt) < Date.parse(qualification.recordedAt) || Date.parse(item.recordedAt) >= Date.parse(qualification.validUntil)))) fail('professional_changed', '审校历史与内容/资格固定版本不匹配。');
      reviewVersions.set(item.ingredientId, item.version);
    }
  }
  if (value.schemaVersion >= 5) {
    const users = new Map(tables.users.map((row) => [row.id, row])); const heads = new Map<string, number>();
    const decisions = new Map<string, ReturnType<typeof sourceCheckFrom>>();
    for (const row of tables.source_checks.slice().sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)) || Number(a.version) - Number(b.version))) {
      const item = sourceCheckFrom(row); const source = sources.get(`${item.sourceId}:${item.sourceRevision}`) || fail('source_check_changed', '来源核验缺少对应来源。');
      const actor = users.get(item.actorId) || fail('source_check_changed', '来源核验缺少账号。');
      if (item.version !== (heads.get(item.sourceId) || 0) + 1 || item.accountRevision > Number(actor.revision) ||
        item.ingredientIds.some((id) => !ingredients.has(id)) || Date.parse(item.checkedAt) > Date.parse(item.recordedAt)) fail('source_check_changed', '来源核验历史关系无效。');
      const managed: ManagedSource = { id: String(source.source_id), revision: Number(source.revision), title: String(source.title), publisher: String(source.publisher), url: String(source.url),
        recordedBy: String(source.author_name), recordedAt: String(source.created_at), verificationState: 'pending', visibility: 'private' };
      if (sourceDigest(managed) !== item.sourceDigest) fail('source_check_changed', '来源核验摘要未绑定对应固定来源。');
      const key = `${item.sourceId}:${item.sourceRevision}`; const previous = decisions.get(key);
      if (item.decision === 'revoke' && (!previous || previous.decision !== 'verified' || previous.evidenceKind !== item.evidenceKind)) fail('source_check_changed', '来源核验撤销历史不完整。');
      if (item.decision === 'verified' && Date.parse(item.recordedAt) >= Date.parse(item.validUntil)) fail('source_check_changed', '来源核验通过时已过期。');
      heads.set(item.sourceId, item.version); decisions.set(key, item);
    }
  }
  if (value.schemaVersion >= 6) validatePublicationTables(tables);
  if (value.schemaVersion >= 7) {
    const users = new Map(tables.users.map(row => [row.id, row]));
    const heads = new Map<string, { version: number; ingredientId: string }>();
    for (const row of tables.photo_notes.slice().sort((a, b) => String(a.candidate_id).localeCompare(String(b.candidate_id)) || Number(a.version) - Number(b.version))) {
      let note: ReturnType<typeof photoNoteFrom>;
      try { note = photoNoteFrom(row); } catch { return fail('photo_note_changed', '图片核对历史摘要或字段无效。'); }
      const actor = users.get(note.actorId), previous = heads.get(note.candidate.id);
      if (!actor || actor.username !== note.actorName || note.accountRevision > Number(actor.revision) || !ingredients.has(note.candidate.ingredientId) || note.version !== (previous?.version ?? 0) + 1 || (previous && previous.ingredientId !== note.candidate.ingredientId)) fail('photo_note_changed', '图片核对历史的食材、账号或修订关系无效。');
      heads.set(note.candidate.id, { version: note.version, ingredientId: note.candidate.ingredientId });
    }
  }
  if (value.schemaVersion >= 8) {
    const users = new Map(tables.users.map(row => [row.id, row]));
    const notes = new Map(tables.photo_notes.map(row => { const note = photoNoteFrom(row); return [`${note.candidate.id}:${note.version}`, note] as const; }));
    const heads = new Map<string, { version: number; ingredientId: string; noteVersion: number }>();
    for (const row of tables.photo_submissions.slice().sort((a, b) => String(a.candidate_id).localeCompare(String(b.candidate_id)) || Number(a.version) - Number(b.version))) {
      let item: ReturnType<typeof photoSubmissionFrom>;
      try { item = photoSubmissionFrom(row); } catch { return fail('photo_submission_changed', '图片送审历史摘要或字段无效。'); }
      const actor = users.get(item.actorId), previous = heads.get(item.candidate.id), note = notes.get(`${item.candidate.id}:${item.noteVersion}`);
      if (!actor || actor.username !== item.actorName || item.accountRevision > Number(actor.revision) || !ingredients.has(item.candidate.ingredientId) || item.version !== (previous?.version ?? 0) + 1 ||
        (previous && (previous.ingredientId !== item.candidate.ingredientId || previous.noteVersion > item.noteVersion)) || !note || note.digest !== item.noteDigest || note.bindingDigest !== item.bindingDigest ||
        JSON.stringify(note.candidate) !== JSON.stringify(item.candidate)) fail('photo_submission_changed', '图片送审历史的核对依据、食材、账号或修订关系无效。');
      heads.set(item.candidate.id, { version: item.version, ingredientId: item.candidate.ingredientId, noteVersion: item.noteVersion });
    }
  }
  if (value.schemaVersion >= 9 && !validPhotoRightsTables(tables)) fail('photo_rights_changed', '图片权利审核的版本、送审依据、账号或独立性关系无效。');
  if (value.schemaVersion >= 10 && !validPhotoProfessionalTables(tables)) fail('photo_professional_changed', '图片专业审校的固定依据、资格或独立性历史关系无效。');
}

export function readSqliteSnapshot(filename: string, seed: CatalogSeed): MigrationSnapshot {
  const absolute = resolve(filename);
  if (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink() || realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) {
    return fail('invalid_source', '源库必须是明确的普通文件，不能通过链接或目录定位。');
  }
  const db = new DatabaseSync(absolute, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN');
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      fail('source_integrity', '源库完整性或关系外键校验失败。');
    }
    const actual = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    const versions = db.prepare('SELECT version FROM migrations ORDER BY version').all().map((row) => row.version).join();
    if (!SOURCE_SCHEMA_VERSIONS.some((version) => Array.from({ length: version }, (_, index) => index + 1).join() === versions)) fail('unsupported_source', '只读迁移支持 schema v3 至 v12，不修改源库。');
    const sourceSchemaVersion = versions.split(',').length as MigrationSnapshot['sourceSchemaVersion'];
    const schemaVersion = (sourceSchemaVersion - 2) as MigrationSnapshot['schemaVersion'];
    const names = snapshotTableNames({ schemaVersion });
    if (actual.map((row) => row.name).join() !== names.slice().sort().join()) fail('unsupported_source', '源库表结构未知，拒绝遗漏数据。');
    const tables = {} as Record<TableName, Row[]>;
    for (const name of names) {
      const { columns, order } = TABLES[name];
      const actualColumns = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
      if (actualColumns.map((row) => row.name).sort().join() !== columns.slice().sort().join()) fail('unsupported_source', '源库包含未知或缺失字段。');
      tables[name] = db.prepare(`SELECT ${columns.map((key) => `"${key}"`).join(',')} FROM "${name}" ORDER BY ${order.map((key) => `"${key}"`).join(',')}`)
        .all().map((row) => normalizeRow(name, row));
    }
    const sequences = Object.fromEntries(SEQUENCE_TABLES.map((name) => [name,
      Number(db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name)?.seq || 0)])) as MigrationSnapshot['sequences'];
    const payload = { schemaVersion, sourceSchemaVersion, seedDigest: seed.digest, tables, sequences };
    const snapshot = validateSnapshot({ ...payload, digest: snapshotDigest(payload) }, seed);
    db.exec('COMMIT'); return snapshot;
  } finally { db.close(); }
}
