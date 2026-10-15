import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantConfig, AssistantQuota, EvidenceExcerpt, ExcerptInput } from '../shared/contracts.js';
import { matchesExcerptInput, parseAssistantConfig, parseAssistantQuota, parseEvidenceExcerpt, parseExcerptList, parseReloadedExcerpt, parseSavedExcerpt, parseSavedPermission } from '../shared/assistant-response.js';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { WorkflowRepository } from '../server/workflow.js';
import { AssistantRepository } from '../server/assistant-repository.js';
import { fixtureSeed } from './fixture.js';

const config: AssistantConfig = { enabled: true, provider: 'test-fixture', model: 'test-only', simulated: true, scope: 'editorial_extracts_summary_and_review' };
const quota: AssistantQuota = { day: '2026-10-12', limits: { dailyTotal: 20, dailyPerActor: 5, concurrentTotal: 2, concurrentPerActor: 1, leaseMs: 45000 }, usedTotal: 0, usedByActor: 0, activeTotal: 1, activeByActor: 1, policyMatches: true };
const input: ExcerptInput = { sourceId: 'test-source', sourceRevision: 1, locator: ' 原文位置 ', text: ' 测试原文，不用于食用指导。 ', allowExternal: true };
const excerpt: EvidenceExcerpt = { id: 'excerpt-b', ingredientId: 'huang-qi', ...input, locator: input.locator.trim(), text: input.text.trim(), digest: `sha256:${'a'.repeat(64)}`, recordedBy: 'test-editor', recordedAt: '2026-10-12T00:00:00.000Z', visibility: 'private', verificationState: 'pending', externalPermission: { allowed: true, revision: 0, updatedBy: 'test-editor', updatedAt: '2026-10-12T00:00:00.000Z' } };

test('assistant configuration is exact and cannot silently select a provider or expose private fields', () => {
  assert.deepEqual(parseAssistantConfig(config), config);
  assert.equal(parseAssistantConfig({ ...config, enabled: false, provider: 'disabled', model: '', simulated: false }).enabled, false);
  for (const value of [null, { ...config, apiKey: 'private' }, { ...config, simulated: false }, { ...config, provider: 'unknown' }, { ...config, enabled: false }, { ...config, model: ' ' }, { ...config, provider: 'disabled' }]) assert.throws(() => parseAssistantConfig(value));
});
test('quota checks exact limits and UTC date while allowing active leases across midnight', () => {
  assert.deepEqual(parseAssistantQuota(quota), quota); // active can exceed today's used count
  for (const value of [{ ...quota, day: '2026-02-30' }, { ...quota, usedTotal: -1 }, { ...quota, usedByActor: 1 }, { ...quota, activeByActor: 2 }, { ...quota, policyMatches: 'true' }, { ...quota, limits: { ...quota.limits, leaseMs: 45001 } }, { ...quota, limits: { ...quota.limits, dailyPerActor: 21 } }, { ...quota, limits: { ...quota.limits, concurrentTotal: 21 } }, { ...quota, privateLedger: [] }]) assert.throws(() => parseAssistantQuota(value));
});
test('private excerpt projection binds food and immutable initial permission without denying later revocation', () => {
  assert.deepEqual(parseEvidenceExcerpt(excerpt, 'huang-qi', excerpt.id), excerpt);
  for (const value of [{ ...excerpt, ingredientId: 'jiang' }, { ...excerpt, digest: 'invalid' }, { ...excerpt, locator: ' untrimmed' }, { ...excerpt, text: 'bad\0text' }, { ...excerpt, visibility: 'public' }, { ...excerpt, recordedAt: 'yesterday' }, { ...excerpt, externalPermission: { ...excerpt.externalPermission, allowed: false } }, { ...excerpt, privateRights: 'secret' }]) assert.throws(() => parseEvidenceExcerpt(value, 'huang-qi'));
  assert.equal(parseEvidenceExcerpt({ ...excerpt, externalPermission: { ...excerpt.externalPermission, allowed: false, revision: 1 } }, 'huang-qi').allowExternal, true);
});
test('excerpt list rejects foreign, duplicate, unordered or truncated-contract records', () => {
  const older = { ...excerpt, id: 'excerpt-a' };
  assert.equal(parseExcerptList({ items: [excerpt, older], limit: 50 }, 'huang-qi').items.length, 2);
  for (const value of [{ items: [], limit: 49 }, { items: [excerpt, excerpt], limit: 50 }, { items: [older, excerpt], limit: 50 }, { items: [{ ...excerpt, ingredientId: 'jiang' }], limit: 50 }, { items: [], limit: 50, total: 0 }]) assert.throws(() => parseExcerptList(value, 'huang-qi'));
});
test('write receipts bind snapshot, actor and CAS; fixed rereads reject rollback or immutable substitution', () => {
  assert.deepEqual(parseSavedExcerpt(excerpt, 'huang-qi', input, 'test-editor'), excerpt);
  assert.equal(matchesExcerptInput(excerpt, input, 'another-editor'), false);
  assert.throws(() => parseSavedExcerpt({ ...excerpt, sourceRevision: 2 }, 'huang-qi', input, 'test-editor'));
  const changed = { ...excerpt, externalPermission: { ...excerpt.externalPermission, revision: 1, allowed: false } };
  assert.deepEqual(parseSavedPermission(changed, excerpt, false, 'test-editor'), changed);
  for (const value of [excerpt, { ...changed, text: 'substituted' }, { ...changed, externalPermission: { ...changed.externalPermission, revision: 2 } }, { ...changed, externalPermission: { ...changed.externalPermission, updatedBy: 'another-editor' } }]) assert.throws(() => parseSavedPermission(value, excerpt, false, 'test-editor'));
  assert.throws(() => parseReloadedExcerpt(excerpt, changed));
  assert.throws(() => parseReloadedExcerpt({ ...changed, externalPermission: { ...changed.externalPermission, allowed: true } }, changed));
  assert.deepEqual(parseReloadedExcerpt(changed, excerpt), changed);
});
test('actual SQLite excerpt save, query, quota and permission CAS satisfy browser decoders', async () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const auth = new AuthRepository(repo.db), password = 'test-only-assistant-response-password-2026';
    const actor = await auth.createUser('test-editor', password, 'editor', 'test-fixture');
    const login = await auth.login(actor.username, password, '127.0.0.1');
    const source = new WorkflowRepository(repo.db).saveSource({ title: '工程测试来源', publisher: '测试机构', url: 'https://example.org/assistant-response' }, actor, undefined, 0, login.token);
    const assistant = new AssistantRepository(repo.db), value = { ...input, sourceId: source.id };
    const saved = parseSavedExcerpt(assistant.saveExcerpt('huang-qi', value, actor, login.token), 'huang-qi', value, actor.username);
    assert.equal(parseExcerptList({ items: assistant.excerpts('huang-qi'), limit: 50 }, 'huang-qi').items[0].id, saved.id);
    const revoked = parseSavedPermission(assistant.permission(saved.id, false, 0, actor, login.token), saved, false, actor.username);
    assert.equal(parseReloadedExcerpt(assistant.excerpt(saved.id), revoked).allowExternal, true);
    assert.equal(parseAssistantQuota(assistant.quota(actor.id, quota.limits)).usedTotal, 0);
  } finally { repo.close(); }
});
