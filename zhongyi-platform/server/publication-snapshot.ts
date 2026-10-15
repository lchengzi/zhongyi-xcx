import type { Account, ContentRevision, ManagedSource } from '../shared/contracts.js';
import type { Row, TableName } from './migration-snapshot.js';
import { fail } from './workflow.js';
import { qualificationFrom, reviewFrom } from './professional-values.js';
import { sourceCheckFrom } from './source-check-values.js';
import { approvalFrom, controlFrom, eventFrom, snapshotFrom } from './publication-values.js';
import { verifyPublicationHistory } from './publication-integrity.js';

// Shared by read-only SQLite export and PostgreSQL encrypted recovery. Hydrate
// actual historical rows, not child records copied from the publication JSON.
export function validatePublicationTables(tables: Record<TableName, Row[]>): void {
  const invalid = () => fail(409, 'publication_integrity', '发布备份缺少固定历史关系。');
  const users: Account[] = tables.users.map((row) => ({ id: String(row.id), username: String(row.username), role: row.role as Account['role'], active: row.active === 1, revision: Number(row.revision), createdAt: String(row.created_at) }));
  const sourceVersions = tables.source_versions.map((row): ManagedSource => ({ id: String(row.source_id), revision: Number(row.revision), title: String(row.title), publisher: String(row.publisher), url: String(row.url), recordedBy: String(row.author_name), recordedAt: String(row.created_at), verificationState: 'pending', visibility: 'private' }));
  const revisions: ContentRevision[] = tables.content_revisions.map((row) => {
    const content = JSON.parse(String(row.payload));
    return { ingredientId: String(row.ingredient_id), revision: Number(row.revision), content,
      sources: content.sourceRefs.map((ref: { id: string; revision: number }) => sourceVersions.find((item) => item.id === ref.id && item.revision === ref.revision) || invalid()),
      digest: String(row.digest), baseReleaseId: String(row.base_release_id), authorId: String(row.author_id), author: String(row.author_name), createdAt: String(row.created_at) };
  });
  const qualifications = tables.professional_qualifications.map(qualificationFrom).sort((a, b) => b.revision - a.revision);
  const latest = new Map(qualifications.slice().reverse().map((item) => [item.userId, item]));
  const reviews = tables.professional_reviews.map(reviewFrom).sort((a, b) => b.version - a.version);
  const checks = tables.source_checks.map(sourceCheckFrom).sort((a, b) => b.version - a.version);
  const snapshots = tables.publication_snapshots.map(snapshotFrom).sort((a, b) => b.version - a.version);
  const approvals = tables.publication_approvals.map(approvalFrom).sort((a, b) => b.version - a.version);
  const events = tables.publication_events.map(eventFrom).sort((a, b) => b.version - a.version);
  const controls = tables.publication_controls.map(controlFrom).sort((a, b) => b.version - a.version);
  const ingredients = new Map(tables.ingredients.map((row) => [String(row.id), String(row.name)]));
  const snapshotIds = new Set(snapshots.map((item) => item.id));
  if (snapshotIds.size !== snapshots.length || snapshots.some((item) => !ingredients.has(item.ingredientId)) || events.some((item) => !ingredients.has(item.ingredientId)) || approvals.some((item) => !snapshotIds.has(item.snapshotId))) invalid();
  // At least one pass validates global control actors even with no snapshots.
  const ids = new Set([ingredients.keys().next().value!, ...snapshots.map((item) => item.ingredientId), ...events.map((item) => item.ingredientId)]);
  for (const id of ids) {
    const fixed = snapshots.filter((item) => item.ingredientId === id); const fixedIds = new Set(fixed.map((item) => item.id));
    const refs = fixed.flatMap((item) => item.basis.draft.content.sourceRefs);
    verifyPublicationHistory({ ingredientId: id, ingredientName: ingredients.get(id)!,
      professional: { ingredientId: id, reviews: reviews.filter((item) => item.ingredientId === id), qualifications: [...latest.values()], users, contributorIds: [] },
      revisions: revisions.filter((item) => item.ingredientId === id), qualificationHistory: qualifications,
      sources: sourceVersions.filter((source) => refs.some((ref) => ref.id === source.id && ref.revision === source.revision)).map((source) => ({ source, checks: checks.filter((check) => check.sourceId === source.id), users,
        authorIds: tables.source_versions.filter((row) => row.source_id === source.id).map((row) => String(row.author_id)) })),
      editorial: tables.review_tasks.filter((row) => row.ingredient_id === id).map((row) => ({ taskId: String(row.id), contentRevision: Number(row.content_revision), contentDigest: String(row.digest), status: String(row.status), reviewerId: row.reviewed_by_id === null ? null : String(row.reviewed_by_id) })),
      snapshots: fixed, approvals: approvals.filter((item) => fixedIds.has(item.snapshotId)), events: events.filter((item) => item.ingredientId === id), controls });
  }
}
