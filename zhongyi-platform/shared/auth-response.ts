import type { Account, AuthConfig, SessionInfo } from './contracts.js';
import { parseAccount } from './account-response.js';
import { choice, date, invalid, literal, object, text } from './workflow-response.js';

export function parseAuthConfig(value: unknown): AuthConfig {
  const item = object(value, 'mode'); return { mode: choice(item.mode, ['accounts', 'local-key']) };
}
export function parseSession(value: unknown, now = Date.now()): SessionInfo {
  const item = object(value, 'user csrfToken expiresAt'), user = parseAccount(item.user);
  const csrfToken = text(item.csrfToken, 64), expiresAt = date(item.expiresAt);
  if (!user.active || !/^[a-f0-9]{64}$/.test(csrfToken) || !Number.isFinite(now) || Date.parse(expiresAt) <= now) invalid();
  return { user, csrfToken, expiresAt };
}
export function parseLoginSession(value: unknown, username: string, now = Date.now()): SessionInfo {
  const result = parseSession(value, now);
  if (result.user.username !== username.trim().toLowerCase()) invalid();
  return result;
}
function sameAccount(user: Account, previous: Account): boolean {
  return user.id === previous.id && user.username === previous.username && user.createdAt === previous.createdAt &&
    user.revision === previous.revision && user.role === previous.role && user.active === previous.active;
}
export function parseRetainedSession(value: unknown, previous: SessionInfo, now = Date.now()): SessionInfo {
  const result = parseSession(value, now);
  // A different live browser session must not silently replace the credential
  // backing an unsaved workspace, even when its username happens to match.
  if (!sameAccount(result.user, previous.user) || result.csrfToken !== previous.csrfToken || result.expiresAt !== previous.expiresAt) invalid();
  return result;
}
export function parseLogoutReceipt(value: unknown): { ok: true } {
  const item = object(value, 'ok'); return { ok: literal(item.ok, true) };
}
