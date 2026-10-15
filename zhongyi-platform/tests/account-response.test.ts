import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, AccountUpdateInput, SecurityEvent } from '../shared/contracts.js';
import { parseAccount, parseAccountList, parseAccountRole, parseCreatedAccount, parseRefreshedAccountList, parseReloadedAccount, parseSecurityEventList, parseUpdatedAccount } from '../shared/account-response.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { fixtureSeed } from './fixture.js';

const time = '2026-10-11T00:00:00.000Z';
const user: Account = { id: 'engineering-user', username: 'engineering-user', role: 'editor', active: true, revision: 1, createdAt: time };
test('account creation acknowledgement binds normalized non-secret intent, initial revision, role and activation', () => {
  const input = { username: ' ENGINEERING-USER ', role: 'editor' as const };
  const result = parseCreatedAccount(user, input); assert.deepEqual(result, user); result.username = 'changed'; assert.equal(user.username, 'engineering-user');
  for (const patch of [{ username: 'other-user' }, { role: 'admin' }, { revision: 2 }, { active: false }, { password: 'PRIVATE-MUST-NOT-PASS' }, { password_hash: 'PRIVATE-MUST-NOT-PASS' }]) assert.throws(() => parseCreatedAccount({ ...user, ...patch }, input));
  for (const username of ['UPPER', ' two ', 'ab', 'bad/name', 'bad\nname']) assert.throws(() => parseAccount({ ...user, username }));
  assert.equal(parseAccountRole('reviewer'), 'reviewer'); assert.throws(() => parseAccountRole('root'));
  assert.throws(() => parseCreatedAccount(user, input, [user]));
  assert.throws(() => parseCreatedAccount(user, input, [{ ...user, username: 'other-user' }]));
});
test('account update acknowledgement binds immutable identity and exact next optimistic revision, not arbitrary success JSON', () => {
  const input: AccountUpdateInput = { role: 'reviewer', active: false, expectedRevision: 1 }, saved = { ...user, role: input.role, active: input.active, revision: 2 };
  assert.deepEqual(parseUpdatedAccount(saved, user, input), saved);
  for (const patch of [{ id: 'other' }, { username: 'other' }, { createdAt: '2026-10-12T00:00:00.000Z' }, { role: 'admin' }, { active: true }, { revision: 1 }, { revision: 3 }, { csrfToken: 'PRIVATE-MUST-NOT-PASS' }]) assert.throws(() => parseUpdatedAccount({ ...saved, ...patch }, user, input));
  assert.throws(() => parseUpdatedAccount(saved, user, { ...input, expectedRevision: 2 }));
});
test('explicit row reread requires the selected identity, immutable fields and non-regressing revisions; unrelated accounts cannot resolve it', () => {
  assert.deepEqual(parseReloadedAccount({ items: [user] }, user), user);
  const changed = { ...user, active: false, role: 'reviewer' as const, revision: 4 }; assert.deepEqual(parseReloadedAccount({ items: [changed] }, user), changed);
  for (const items of [[], [{ ...user, id: 'other' }], [{ ...user, username: 'other' }], [{ ...user, createdAt: '2026-10-12T00:00:00.000Z' }], [{ ...user, active: false }], [{ ...user, role: 'admin' }], [user, user]]) assert.throws(() => parseReloadedAccount({ items }, user));
  assert.throws(() => parseReloadedAccount({ items: [user] }, changed));
});
test('security history explicitly projects bounded descending IDs with legitimate gaps, null targets and no private fields', () => {
  const event: SecurityEvent = { id: 12, actor: 'engineering-fixture', action: 'login_failed', target: null, createdAt: time };
  const value = { items: [event, { ...event, id: 4, action: 'account_created' as const, target: 'engineering-user' }] };
  assert.deepEqual(parseSecurityEventList(value), value); assert.deepEqual(parseSecurityEventList({ items: [] }), { items: [] });
  for (const items of [[event, event], [{ ...event, id: 4 }, event], [{ ...event, id: '12' }], [{ ...event, action: 'authenticated' }], [{ ...event, createdAt: 'not-a-date' }], [{ ...event, password: 'PRIVATE-MUST-NOT-PASS' }], Array.from({ length: 51 }, (_, index) => ({ ...event, id: 100 - index }))]) assert.throws(() => parseSecurityEventList({ items }));
  const parsed = parseSecurityEventList(value); parsed.items[0].actor = 'changed'; assert.equal(event.actor, 'engineering-fixture');
});
test('complete account refresh cannot erase known rows, rewrite immutable identity or silently rebase unchanged revisions', () => {
  const other = { ...user, id: 'other-user', username: 'other-user' }, changed = { ...user, role: 'reviewer' as const, revision: 3 };
  assert.deepEqual(parseRefreshedAccountList({ items: [other, changed] }, [user]), { items: [other, changed] });
  for (const items of [[], [other], [{ ...user, username: 'substituted-user' }], [{ ...user, role: 'admin' }]]) assert.throws(() => parseRefreshedAccountList({ items }, [user]));
  assert.throws(() => parseRefreshedAccountList({ items: [user] }, [changed]));
});
test('real SQLite account writes and session revocation satisfy response parsers without reading a working database', async () => {
  const repository = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repository.db);
  try {
    const input = { username: 'response-engineering-user', role: 'editor' as const }, password = 'engineering-test-only-password-2026';
    const created = await auth.createUser(input.username, password, input.role, 'engineering-fixture'); assert.deepEqual(parseCreatedAccount(created, input), created);
    const signed = await auth.login(input.username, password, 'engineering-ip'); assert(auth.session(signed.token));
    const update: AccountUpdateInput = { role: 'reviewer', active: false, expectedRevision: 1 };
    const saved = auth.updateUser(created.id, update.role, update.active, update.expectedRevision, 'engineering-fixture'); assert.deepEqual(parseUpdatedAccount(saved, created, update), saved);
    assert.equal(auth.session(signed.token), undefined); assert.deepEqual(parseReloadedAccount({ items: auth.users() }, created), saved);
    assert.deepEqual(parseAccountList({ items: auth.users() }), { items: auth.users() });
    const eventWire: unknown = JSON.parse(JSON.stringify({ items: auth.events() })); // HTTP JSON removes SQLite row prototypes.
    assert.deepEqual(parseSecurityEventList(eventWire), eventWire);
  } finally { repository.close(); }
});
