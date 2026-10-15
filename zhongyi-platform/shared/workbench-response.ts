// Browser-safe read boundaries, not source authentication or publication approval.
import type { AuditEvent, IngredientPage, PlatformSummary, WorkflowEvent } from './contracts.js';
import { choice, date, id, invalid, list, literal, number, object, parseIngredientPage, text } from './workflow-response.js';

function calendarDate(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00.000Z`)) ||
    new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) invalid();
  return result;
}
export function parsePlatformSummary(value: unknown): PlatformSummary {
  const item = object(value, 'mode releaseId contentVersion sourceAsOf importedAt ingredientCount noteCount eventCount publicationEnabled');
  const result: PlatformSummary = { mode: literal(item.mode, 'local_editorial_demo'), releaseId: text(item.releaseId, 200),
    contentVersion: text(item.contentVersion, 200), sourceAsOf: calendarDate(item.sourceAsOf), importedAt: date(item.importedAt),
    ingredientCount: number(item.ingredientCount, 0), noteCount: number(item.noteCount, 0), eventCount: number(item.eventCount, 0),
    publicationEnabled: literal(item.publicationEnabled, false) };
  if (result.noteCount > result.ingredientCount) invalid();
  return result;
}
export function parseCatalogPage(value: unknown, expected: { page: number; pageSize: number; query: string }): IngredientPage {
  const result = parseIngredientPage(value, expected), query = expected.query.trim().toLowerCase();
  // Both catalog repositories use literal substring matching and ascending IDs.
  // A short/empty successful page must not hide rows implied by its own total.
  const offset = (result.page - 1) * result.pageSize;
  if (!Number.isSafeInteger(offset) || result.items.length !== Math.min(result.pageSize, Math.max(0, result.total - offset)) ||
    result.items.some((item, index) => ![item.name, item.pinyin, ...item.aliases].join(' ').toLowerCase().includes(query) ||
      (index > 0 && result.items[index - 1].id >= item.id))) invalid();
  return result;
}
function descending(items: readonly { id: number }[]): void {
  // PostgreSQL sequences may have gaps after rollback. Never require contiguity.
  if (items.some((item, index) => index > 0 && items[index - 1].id <= item.id)) invalid();
}
export function parseAuditEventList(value: unknown): { items: AuditEvent[] } {
  const envelope = object(value, 'items');
  const items = list(envelope.items, entry => {
    const item = object(entry, 'id ingredientId action revision createdAt actor');
    return { id: number(item.id), ingredientId: id(item.ingredientId), action: choice(item.action, ['note_saved', 'note_cleared']),
      revision: number(item.revision), createdAt: date(item.createdAt), actor: text(item.actor, 80) };
  }, 20);
  descending(items);
  return { items };
}
export function parseWorkflowEventList(value: unknown): { items: WorkflowEvent[] } {
  const envelope = object(value, 'items');
  const items = list(envelope.items, entry => {
    const item = object(entry, 'id ingredientId sourceId revision action actor createdAt');
    const event: WorkflowEvent = { id: number(item.id), ingredientId: item.ingredientId === null ? null : id(item.ingredientId),
      sourceId: item.sourceId === null ? null : id(item.sourceId), revision: number(item.revision),
      action: choice(item.action, ['source_created', 'source_updated', 'draft_saved', 'draft_submitted', 'review_returned', 'review_accepted']),
      actor: text(item.actor, 80), createdAt: date(item.createdAt) };
    const sourceEvent = event.action === 'source_created' || event.action === 'source_updated';
    if (sourceEvent ? event.sourceId === null || event.ingredientId !== null : event.ingredientId === null || event.sourceId !== null) invalid();
    if ((event.action === 'source_created' && event.revision !== 1) || (event.action === 'source_updated' && event.revision < 2)) invalid();
    return event;
  }, 50);
  descending(items);
  return { items };
}
