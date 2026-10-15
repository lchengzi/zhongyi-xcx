import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadingPreferences } from '../src/index.js';

test('reading preferences start standard and publish stable immutable snapshots', () => {
  const store = createReadingPreferences();
  const initial = store.getSnapshot();
  assert.deepEqual(initial, { revision: 0, size: 'standard' });
  assert.ok(Object.isFrozen(initial));
  assert.equal(store.getSnapshot(), initial);
  assert.equal(store.setSize('standard', 0), true);
  assert.equal(store.getSnapshot(), initial);
  assert.equal(store.setSize('large', 0), true);
  assert.deepEqual(store.getSnapshot(), { revision: 1, size: 'large' });
  assert.ok(Object.isFrozen(store.getSnapshot()));
  assert.equal(initial.size, 'standard');
});

test('old callbacks cannot overwrite a newer reading choice, including A to B to A', () => {
  const store = createReadingPreferences();
  assert.equal(store.setSize('large', 0), true);
  assert.equal(store.setSize('standard', 1), true);
  assert.equal(store.setSize('extra-large', 0), false);
  assert.equal(store.setSize('large', 1), false);
  assert.deepEqual(store.getSnapshot(), { revision: 2, size: 'standard' });
  assert.equal(store.setSize('extra-large', 2), true);
});

test('invalid external values and revisions leave the preference and listeners untouched', () => {
  const store = createReadingPreferences(); let calls = 0;
  store.subscribe(() => { calls++; });
  for (const value of [null, undefined, 1, {}, [], 'system', 'Large', ' extra-large', '<script>']) {
    assert.equal(store.setSize(value, 0), false);
  }
  for (const revision of [NaN, Infinity, -1, 0.5, 4]) assert.equal(store.setSize('large', revision), false);
  assert.equal(calls, 0);
  assert.deepEqual(store.getSnapshot(), { revision: 0, size: 'standard' });
});

test('updates reach all readers, deduplicate unchanged choices and stop after unsubscribe', () => {
  const store = createReadingPreferences(); let calls = 0;
  const broken = store.subscribe(() => { throw new Error('observer'); });
  const stop = store.subscribe(() => { calls++; });
  store.setSize('large', 0); assert.equal(calls, 1);
  store.setSize('large', 1); assert.equal(calls, 1);
  store.setSize('extra-large', 1); assert.equal(calls, 2);
  stop(); broken(); store.setSize('standard', 2); assert.equal(calls, 2);
  // A fresh application runtime does not inherit the last runtime's setting.
  assert.equal(createReadingPreferences().getSnapshot().size, 'standard');
});
