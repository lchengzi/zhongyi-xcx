import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSafetySession, SAFETY_CHECKS, assessIngredient, buildConsultationSummary, parseCatalog, EMERGENCY_MESSAGE } from '../src/index.js';

test('health session is immutable and isolated; no profile is restored by a new session', () => {
  const session = createSafetySession();
  const first = session.getSnapshot();
  assert.strictEqual(session.getSnapshot(), first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.checks));
  const input = { allergies: ['sensitive-allergy'], medicationStatus: 'no', medications: ['sensitive-medication'] };
  const saved = session.saveProfile(input, first.revision);
  assert.ok(saved.ok);
  input.allergies.push('not-saved');
  assert.deepEqual(session.getSnapshot().profile.allergies, ['sensitive-allergy']);
  assert.equal(session.getSnapshot().profile.medicationStatus, 'yes');
  assert.deepEqual(createSafetySession().getSnapshot().profile.allergies, []);
  assert.equal(session.saveProfile(input, first.revision).ok, false);
});

test('a privacy reset invalidates stale saves, flags and checklist callbacks even when empty', () => {
  const session = createSafetySession();
  for (let i = 0; i < 2; i++) {
    const before = session.getSnapshot();
    assert.ok(session.clear(before.revision).ok);
    assert.equal(session.getSnapshot().clearEpoch, before.clearEpoch + 1);
    assert.equal(session.isCurrent(before.revision, before.clearEpoch), false);
    for (const result of [session.saveProfile({ conditions: ['old-hidden-draft'] }, before.revision), session.addRedFlags(['old-event'], before.revision), session.setChecks(['identity'], before.revision)]) {
      assert.ok(!result.ok);
      assert.equal(result.errorCode, 'stale');
    }
    assert.deepEqual(session.getSnapshot().profile.conditions, []);
  }
});

test('emergency additions are immediate and cannot be removed by a later checkbox addition', () => {
  const session = createSafetySession();
  assert.ok(session.setChecks(['identity'], 0).ok);
  assert.ok(session.addRedFlags(['unrecognized-emergency'], 1).ok);
  assert.deepEqual(session.getSnapshot().checks, []);
  assert.ok(session.addRedFlags([], 2).ok);
  assert.deepEqual(session.getSnapshot().profile.redFlags, ['unrecognized-emergency']);
  const refused = session.setChecks(['identity'], 2);
  assert.ok(!refused.ok && refused.errorCode === 'emergency');
  assert.ok(session.saveProfile({ redFlags: [] }, 2).ok);
  assert.deepEqual(session.getSnapshot().profile.redFlags, []);
});

test('checklist validation is atomic and profile edits reset progress without granting suitability', () => {
  const session = createSafetySession();
  for (const value of [null, 'identity', ['identity', 'identity'], ['invented'], new Array(1), Array(9).fill('identity')]) {
    const result = session.setChecks(value, 0);
    assert.ok(!result.ok && result.errorCode === 'invalid_checks');
    assert.equal(session.getSnapshot().revision, 0);
  }
  assert.ok(session.setChecks(SAFETY_CHECKS.map(check => check.id).reverse(), 0).ok);
  assert.deepEqual(session.getSnapshot().checks, SAFETY_CHECKS.map(check => check.id));
  const current = session.getSnapshot();
  assert.ok(session.saveProfile(current.profile, current.revision).ok);
  assert.strictEqual(session.getSnapshot(), current);
  assert.ok(session.saveProfile({ ageGroup: 'adult' }, current.revision).ok);
  assert.deepEqual(session.getSnapshot().checks, []);
});

test('reset notifications reach all subscribers; unsubscribe and broken observers cannot compromise deletion', () => {
  const session = createSafetySession();
  let seen = 0;
  session.subscribe(() => { throw new Error('broken observer'); });
  const unsubscribe = session.subscribe(() => { seen++; assert.equal(session.getSnapshot().profile.allergies.length, 0); });
  assert.ok(session.clear(0).ok);
  assert.equal(seen, 1);
  unsubscribe();
  assert.ok(session.clear(1).ok);
  assert.equal(seen, 1);
});

test('consultation notes omit raw health history, include exclusions and never offer emergency candidates', () => {
  const parsed = parseCatalog(JSON.parse(readFileSync(new URL('../../../apps/miniprogram/src/data/catalog.json', import.meta.url), 'utf8')));
  assert.ok(parsed.ok);
  const session = createSafetySession();
  session.saveProfile({ allergies: ['secret-allergen'], conditions: ['secret-condition'], medications: ['藜芦', 'secret-medication'] }, 0);
  const before = assessIngredient(parsed.catalog.ingredients[0], session.getSnapshot().profile);
  session.setChecks(SAFETY_CHECKS.map(check => check.id), 1);
  assert.deepEqual(assessIngredient(parsed.catalog.ingredients[0], session.getSnapshot().profile), before);
  const summary = buildConsultationSummary(parsed.catalog, ['bai-he', 'dang-shen', 'missing'], session.getSnapshot());
  assert.ok(summary.includes('待核对条目：百合'));
  assert.ok(summary.includes('已停止选择：党参'));
  assert.ok(summary.includes('8/8'));
  assert.ok(summary.includes('当前目录无法读取的记录：1 项'));
  assert.ok(summary.includes('未纳入本次摘要判断'));
  assert.ok(!summary.includes('missing'));
  for (const secret of ['secret-allergen', 'secret-condition', 'secret-medication', '藜芦']) assert.ok(!summary.includes(secret));
  session.addRedFlags(['unknown-emergency'], 2);
  assert.equal(buildConsultationSummary(parsed.catalog, ['bai-he'], session.getSnapshot()), EMERGENCY_MESSAGE);
});

test('unavailable historical records are counted once without exposing arbitrary identifiers', () => {
  const parsed = parseCatalog(JSON.parse(readFileSync(new URL('../../../apps/miniprogram/src/data/catalog.json', import.meta.url), 'utf8')));
  assert.ok(parsed.ok);
  const session = createSafetySession();
  const summary = buildConsultationSummary(parsed.catalog, ['private-old-id', 'private-old-id', 'other-old-id'], session.getSnapshot());
  assert.ok(summary.includes('当前目录无法读取的记录：2 项'));
  assert.ok(!summary.includes('private-old-id'));
  assert.ok(!summary.includes('other-old-id'));
  assert.ok(!summary.includes('已停止选择：private'));
});
