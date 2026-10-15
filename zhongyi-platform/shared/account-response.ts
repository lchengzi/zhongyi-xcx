// Explicit account projection for management responses; not authorization.
import type { Account, AccountCreationIntent, AccountUpdateInput, SecurityEvent, UserRole } from './contracts.js';
import { choice, date, id, invalid, list, number, object, text, unique } from './workflow-response.js';
export function parseAccount(value: unknown): Account {
  const item = object(value, 'id username role active revision createdAt');
  if (typeof item.active !== 'boolean' || typeof item.username !== 'string' || !/^[a-z][a-z0-9._-]{2,39}$/.test(item.username)) invalid();
  return { id: id(item.id), username: text(item.username, 40), role: choice(item.role, ['admin', 'editor', 'reviewer']), active: item.active,
    revision: number(item.revision), createdAt: date(item.createdAt) };
}
export function parseAccountList(value: unknown): { items: Account[] } {
  const item = object(value, 'items'); const items = list(item.items, parseAccount, 10000);
  unique(items.map(user => user.id)); unique(items.map(user => user.username)); return { items };
}
export function parseAccountRole(value: unknown): UserRole { return choice(value, ['admin', 'editor', 'reviewer']); }
export function parseCreatedAccount(value: unknown, input: AccountCreationIntent, previous: readonly Account[] = []): Account {
  const result = parseAccount(value);
  if (result.username !== input.username.trim().toLowerCase() || result.role !== input.role || !result.active || result.revision !== 1 || previous.some(user => user.id === result.id || user.username === result.username)) invalid();
  return result;
}
export function parseUpdatedAccount(value: unknown, previous: Account, input: AccountUpdateInput): Account {
  const result = parseAccount(value);
  if (result.id !== previous.id || result.username !== previous.username || result.createdAt !== previous.createdAt || input.expectedRevision !== previous.revision ||
      result.revision !== previous.revision + 1 || result.role !== input.role || result.active !== input.active) invalid();
  return result;
}
export function parseReloadedAccount(value: unknown, previous: Account): Account {
  const result = parseAccountList(value).items.find(user => user.id === previous.id);
  if (!result || !consistent(result, previous)) invalid();
  return result;
}
function consistent(current: Account, previous: Account): boolean {
  return current.username === previous.username && current.createdAt === previous.createdAt && current.revision >= previous.revision &&
    (current.revision !== previous.revision || (current.role === previous.role && current.active === previous.active));
}
export function parseRefreshedAccountList(value: unknown, previous: readonly Account[]): { items: Account[] } {
  const result = parseAccountList(value), byId = new Map(result.items.map(user => [user.id, user]));
  // This endpoint returns ALL accounts; there is no account deletion API. A
  // silently omitted row must not unmount and discard its unsaved permissions.
  for (const prior of previous) { const current = byId.get(prior.id); if (!current || !consistent(current, prior)) invalid(); }
  return result;
}
export function parseSecurityEventList(value: unknown): { items: SecurityEvent[] } {
  const item = object(value, 'items');
  const items = list(item.items, value => {
    const event = object(value, 'id actor action target createdAt');
    return { id: number(event.id), actor: text(event.actor, 200), action: choice(event.action, ['account_created', 'account_updated', 'login_succeeded', 'login_failed', 'logout']),
      target: event.target === null ? null : text(event.target, 200), createdAt: date(event.createdAt) };
  }, 50);
  // Sequence allocation can leave gaps after transaction rollback, especially
  // in PostgreSQL. Only descending unique IDs are part of this read contract.
  if (items.some((event, index) => index > 0 && event.id >= items[index - 1].id)) invalid();
  return { items };
}
