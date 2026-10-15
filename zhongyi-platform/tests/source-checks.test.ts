import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { AuthRepository } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { publicationPreflight, sourceCheckDetail, sourceCheckDigest, sourceCheckValues, sourceDigest } from '../server/source-check-values.js';
import { snapshotDigest, validateSnapshot, TABLES } from '../server/migration-snapshot.js';
import { encryptBackup, decryptBackup, validatePostgresBackup } from '../server/postgres-backup.js';
import { unitBackup, rehashBackup } from './backup-fixture.js';
import { fixturePassword, migrationFixture } from './migration-fixture.js';
import { sourceCheckInput } from './source-check-fixture.js';
import type { Account, SourceCheck, SourceCheckInput } from '../shared/contracts.js';

async function setup() {
  const fixture = await migrationFixture(undefined, false); const catalog = new CatalogRepository(fixture.filename, fixture.seed); const workflow = new WorkflowRepository(catalog.db); const auth = new AuthRepository(catalog.db);
  const origin = 'https://source-check.example.test'; const server = createApp(catalog, { mode: 'accounts', allowedOrigins: [origin] }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const sessions = new Map<string, { cookie: string; csrfToken: string }>();
  for (const actor of [fixture.admin, fixture.editor, fixture.reviewer]) {
    const response = await fetch(`${root}/api/v1/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password: fixturePassword }) }); assert.equal(response.status, 200);
    const session = await response.json(); sessions.set(actor.id, { cookie: response.headers.get('set-cookie')!.split(';')[0], csrfToken: session.csrfToken });
  }
  const api = (path: string, actor: Account = fixture.admin, method = 'GET', body?: unknown, extra = {}) => fetch(`${root}/api/v1${path}`, { method,
    headers: { Origin: origin, Cookie: sessions.get(actor.id)!.cookie, 'X-CSRF-Token': sessions.get(actor.id)!.csrfToken, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const source = workflow.draft('huang-qi')!.sources[0];
  return { ...fixture, catalog, workflow, auth, api, source, root, adminToken: sessions.get(fixture.admin.id)!.cookie.split('=')[1], close: async () => { await new Promise<void>((done) => server.close(() => done())); catalog.close(); fixture.dispose(); } };
}

test('source checks require independent current accounts, exact scope/time/digest inputs and CSRF; parallel writes have one winner', async () => {
  const state = await setup();
  try {
    const input = sourceCheckInput(state.source); const path = `/editorial/source-checks/${state.source.id}`;
    const write = (check: SourceCheckInput | object, actor = state.admin, extra = {}) => state.api(path, actor, 'POST', { check, expectedVersion: 0 }, extra);
    assert.equal((await write(input, state.editor)).status, 403);
    const own = state.workflow.saveSource({ title: 'admin owned', publisher: 'engineering', url: 'https://example.org/own-source-check' }, state.admin);
    assert.equal((await state.api(`/editorial/source-checks/${own.id}`, state.admin, 'POST', { check: sourceCheckInput(own), expectedVersion: 0 })).status, 403);
    assert.equal((await write(input, state.admin, { 'X-CSRF-Token': '' })).status, 403);
    for (const patch of [{ ingredientIds: [] }, { ingredientIds: ['missing'] }, { domains: ['unknown'] }, { domains: ['identity', 'identity'] }, { checkedAt: new Date(Date.now() + 3600000).toISOString() }, { verificationConfirmed: false }, { validUntil: input.checkedAt }, { publicationEnabled: true }]) assert.equal((await write({ ...input, ...patch })).status, 400);
    assert.equal((await write({ ...input, sourceDigest: 'sha256:' + '0'.repeat(64) })).status, 409);
    const results = await Promise.all([write(input), write(input, state.reviewer)]); assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
    const detail = await (await state.api(`${path}/1`)).json(); assert.equal(detail.checkVersion, 1); assert.equal(detail.state, 'recorded'); assert.equal(detail.publicationEnabled, false);
    assert.equal((await state.api(`${path}/1?unexpected=1`)).status, 400);
    assert.equal((await fetch(`${state.root}/api/v1/editorial/publication-preflight/huang-qi`)).status, 401);
  } finally { await state.close(); }
});

test('source checks stay separate from immutable content; new source versions start pending and revocation/reverification never publishes', async () => {
  const state = await setup();
  try {
    const content = state.workflow.draft('huang-qi'); const publicBefore = await (await fetch(`${state.root}/api/v1/public/catalog`)).text();
    const input = sourceCheckInput(state.source); state.workflow.saveSourceCheck(state.source.id, input, 0, state.reviewer);
    assert.deepEqual(state.workflow.draft('huang-qi'), content);
    const next = state.workflow.saveSource({ title: 'new source version', publisher: state.source.publisher, url: state.source.url }, state.editor, state.source.id, state.workflow.source(state.source.id)!.revision);
    assert.equal(state.workflow.sourceCheck(next.id, next.revision).state, 'pending'); assert.equal(state.workflow.sourceCheck(next.id, 1).state, 'recorded');
    state.workflow.saveSourceCheck(next.id, { ...input, decision: 'revoke' }, 1, state.admin);
    assert.equal(state.workflow.sourceCheck(next.id, 1).state, 'revoked');
    assert.throws(() => state.workflow.saveSourceCheck(next.id, { ...input, decision: 'revoke' }, 2, state.admin), (e: any) => e.code === 'invalid_transition');
    state.workflow.saveSourceCheck(next.id, input, 2, state.reviewer); assert.equal(state.workflow.sourceCheck(next.id, 1).state, 'recorded');
    const preflight = await (await state.api('/editorial/publication-preflight/huang-qi')).json();
    assert.equal(preflight.readyForReleaseApproval, false); assert.equal(preflight.publicationEnabled, false); assert(preflight.reasons.includes('professional_review_required'));
    assert(preflight.sources[0].reasons.includes('source_check_test_fixture'));
    assert.equal(await (await fetch(`${state.root}/api/v1/public/catalog`)).text(), publicBefore);
    assert.throws(() => state.catalog.db.exec("UPDATE source_checks SET comment='changed'"), /immutable/); assert.throws(() => state.catalog.db.exec('DELETE FROM source_checks'), /immutable/);
  } finally { await state.close(); }
});

test('account changes invalidate old source checks; only original assessor or admin can revoke, including opinions outside the recent window', async () => {
  const state = await setup();
  try {
    const second = state.workflow.saveSource({ title: 'second independent source', publisher: 'test-only', url: 'https://example.org/source-check-second' }, state.editor);
    const input = sourceCheckInput(state.source); state.workflow.saveSourceCheck(state.source.id, input, 0, state.reviewer);
    const other = await state.auth.createUser('source-other-reviewer', fixturePassword, 'reviewer', state.admin.username, false, undefined, state.adminToken);
    assert.throws(() => state.workflow.saveSourceCheck(state.source.id, { ...input, decision: 'revoke' }, 1, other), (e: any) => e.code === 'forbidden');
    const next = state.workflow.saveSource({ title: 'updated', publisher: 'test', url: state.source.url }, state.editor, state.source.id, state.workflow.source(state.source.id)!.revision);
    for (let index = 0; index < 21; index++) state.workflow.saveSourceCheck(next.id, sourceCheckInput(next), index + 1, state.reviewer);
    const old = state.workflow.sourceCheck(next.id, 1); assert.equal(old.checks.length, 20); assert.equal(old.latest!.version, 1);
    const updated = await state.auth.updateUser(state.reviewer.id, 'reviewer', false, state.reviewer.revision, state.admin.username, state.adminToken);
    assert.equal(state.workflow.sourceCheck(next.id, 1).state, 'invalidated');
    assert.throws(() => state.workflow.saveSourceCheck(second.id, sourceCheckInput(second), 0, updated), (e: any) => e.code === 'forbidden');
    state.workflow.saveSourceCheck(next.id, { ...input, decision: 'revoke' }, old.checkVersion, state.admin); assert.equal(state.workflow.sourceCheck(next.id, 1).state, 'revoked');
  } finally { await state.close(); }
});

test('pure prerequisite policy requires real manual source scope, all domains and an official directory basis, and remains private even when ready', async () => {
  const state = await setup();
  try {
    const recorded = state.workflow.saveSourceCheck(state.source.id, sourceCheckInput(state.source), 0, state.reviewer).latest!;
    // In-memory policy specimen only, not a persisted real verification record.
    const { digest: _, ...testRecord } = recorded; const manualPayload = { ...testRecord, evidenceKind: 'manual-check' as const };
    const manual = { ...manualPayload, digest: sourceCheckDigest(manualPayload) };
    const facts = { source: state.source, checks: [manual], users: state.auth.users(), authorIds: [state.editor.id] };
    const valid = sourceCheckDetail(facts); assert.equal(valid.state, 'verified');
    assert.equal(sourceCheckDetail(facts, Date.parse(manual.validUntil)).state, 'expired');
    const professional = { ...state.workflow.professionalDetail('huang-qi'), state: 'eligible_for_publication_approval' as const };
    const ready = publicationPreflight('huang-qi', professional, [valid]); assert.equal(ready.readyForReleaseApproval, true); assert.equal(ready.publicationEnabled, false); assert.equal(ready.visibility, 'private');
    const changed = (patch: Partial<SourceCheck>) => { const { digest: _d, ...payload } = { ...manual, ...patch }; return sourceCheckDetail({ ...facts, checks: [{ ...payload, digest: sourceCheckDigest(payload) }] }); };
    assert(publicationPreflight('huang-qi', professional, [changed({ ingredientIds: ['jiang'] })]).sources[0].reasons.includes('source_scope_mismatch'));
    assert(publicationPreflight('huang-qi', professional, [changed({ authority: 'research' })]).reasons.includes('official_directory_scope_required'));
    assert(publicationPreflight('huang-qi', professional, [changed({ domains: ['directory_scope'] })]).missingDomains.includes('processing'));
    assert.equal(publicationPreflight('huang-qi', professional, [state.workflow.sourceCheck(state.source.id, 1)]).readyForReleaseApproval, false);
  } finally { await state.close(); }
});

test('source checks survive actual SQLite reopen and encrypted backup; a rehashed forged source relation is rejected', async () => {
  const state = await setup();
  try {
    const detail = state.workflow.saveSourceCheck(state.source.id, sourceCheckInput(state.source), 0, state.reviewer); const snapshot = state.read();
    assert.equal(snapshot.tables.source_checks.length, 1); const backup = unitBackup(snapshot); const key = randomBytes(32); assert.deepEqual(decryptBackup(encryptBackup(backup, key), key, state.seed), backup);
    const { digest: _, ...payload } = detail.latest!; const wrong = { ...payload, sourceRevision: 99 }; const values = sourceCheckValues({ ...wrong, digest: sourceCheckDigest(wrong) });
    const bad = structuredClone(backup); bad.data.tables.source_checks = [Object.fromEntries(TABLES.source_checks.columns.map((column, index) => [column, values[index]]))]; rehashBackup(bad);
    assert.throws(() => validatePostgresBackup(bad, state.seed), (e: any) => e.code === 'source_check_changed');
    const changed = structuredClone(snapshot); changed.tables.source_checks[0].comment = 'changed'; const { digest: old, ...rest } = changed; changed.digest = snapshotDigest(rest); assert.throws(() => validateSnapshot(changed, state.seed));
    const reopened = new CatalogRepository(state.filename, state.seed); try { assert.deepEqual(new WorkflowRepository(reopened.db).sourceCheck(state.source.id, 1), detail); } finally { reopened.close(); }
    assert.equal(sourceDigest(state.source), detail.sourceDigest);
  } finally { await state.close(); }
});
