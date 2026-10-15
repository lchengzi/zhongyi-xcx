import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionInfo } from '../shared/contracts.js';
import { parseAuthConfig, parseLoginSession, parseLogoutReceipt, parseRetainedSession, parseSession } from '../shared/auth-response.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { fixtureSeed } from './fixture.js';

const time = Date.parse('2026-10-11T00:00:00.000Z');
const session: SessionInfo = { user: { id: 'test-user', username: 'test-editor', role: 'editor', active: true, revision: 2, createdAt: '2026-10-10T00:00:00.000Z' },
  csrfToken: 'a'.repeat(64), expiresAt: '2026-10-11T08:00:00.000Z' };
test('authentication mode has an exact projection; malformed data never selects a fallback login mode', () => {
  assert.deepEqual(parseAuthConfig({ mode: 'accounts' }), { mode: 'accounts' }); assert.equal(parseAuthConfig({ mode: 'local-key' }).mode, 'local-key');
  for (const value of [null, {}, [], { mode: 'production' }, { mode: 'accounts', password: 'private' }, { mode: true }]) assert.throws(() => parseAuthConfig(value));
});
test('live session checks active account, CSRF, expiry and exact nested projection without mutating input', () => {
  assert.deepEqual(parseSession(session, time), session);
  for (const value of [{ ...session, user: { ...session.user, active: false } }, { ...session, user: { ...session.user, role: 'superuser' } },
    { ...session, user: { ...session.user, passwordHash: 'private' } }, { ...session, csrfToken: 'short' }, { ...session, csrfToken: 'g'.repeat(64) },
    { ...session, csrfToken: 'A'.repeat(64) }, { ...session, token: 'private' }, { ...session, expiresAt: '2026-10-11T00:00:00.000Z' },
    { ...session, expiresAt: '2026-02-30T08:00:00.000Z' }]) assert.throws(() => parseSession(value, time));
  const parsed = parseSession(session, time); parsed.user.username = 'changed'; assert.equal(session.user.username, 'test-editor');
});
test('login binds normalized username and retained workspace cannot accept a substituted account or rotated session', () => {
  assert.deepEqual(parseLoginSession(session, ' TEST-EDITOR ', time), session);
  assert.throws(() => parseLoginSession(session, 'other-user', time));
  assert.deepEqual(parseRetainedSession(session, session, time), session);
  for (const value of [{ ...session, csrfToken: 'b'.repeat(64) }, { ...session, expiresAt: '2026-10-11T09:00:00.000Z' },
    { ...session, user: { ...session.user, id: 'other-id' } }, { ...session, user: { ...session.user, revision: 3 } },
    { ...session, user: { ...session.user, role: 'admin' } }]) assert.throws(() => parseRetainedSession(value, session, time));
});
test('logout requires a positive exact acknowledgement, never arbitrary successful JSON', () => {
  assert.deepEqual(parseLogoutReceipt({ ok: true }), { ok: true });
  for (const value of [null, {}, { ok: false }, { ok: 'true' }, { ok: true, token: 'private' }]) assert.throws(() => parseLogoutReceipt(value));
});
test('actual SQLite login and restored session pass while logout really revokes the original session', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const auth = new AuthRepository(repo.db), password = 'test-only-auth-boundary-password-2026';
    const user = await auth.createUser('test-auth-editor', password, 'editor', 'test-fixture');
    const login = await auth.login(user.username, password, '127.0.0.1');
    const decoded = parseLoginSession(login.info, user.username);
    assert.deepEqual(parseRetainedSession(auth.session(login.token), decoded), decoded);
    auth.logout(login.token, user.username); assert.equal(auth.session(login.token), undefined);
  } finally { repo.close(); }
});
