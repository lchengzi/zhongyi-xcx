import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLocalRecords, createSelectionStore, createSafetySession, STORE_KEYS } from '../src/index.js';
import type { StoragePort } from '../src/index.js';

function fixture() {
  const data = new Map<string, unknown>([[STORE_KEYS.favorites, ['bai-he']], [STORE_KEYS.compare, ['shan-yao']], ['unrelated', { keep: true }]]);
  const removed: string[] = [];
  let readFailure = false;
  let removalFailure: string | null = null;
  let ignoredRemoval: string | null = null;
  const port: StoragePort = {
    read(key) { if (readFailure) throw new Error('read failed'); return data.get(key); },
    write(key, value) { data.set(key, [...value]); },
    remove(key) {
      removed.push(key);
      if (removalFailure === key) throw new Error('delete failed');
      if (ignoredRemoval !== key) data.delete(key);
    }
  };
  const store = createSelectionStore(port, ['bai-he', 'shan-yao']);
  const session = createSafetySession();
  session.saveProfile({ allergies: ['private-allergy'], conditions: ['private-condition'] }, 0);
  session.setChecks(['identity'], 1);
  const before = session.getSnapshot();
  const expected = { favoritesRevision: store.read('favorites').revision, compareRevision: store.read('compare').revision, safetyRevision: before.revision, clearEpoch: before.clearEpoch };
  return { data, removed, store, session, expected,
    failRead() { readFailure = true; }, failRemoval(key: string) { removalFailure = key; }, ignoreRemoval(key: string) { ignoredRemoval = key; }
  };
}

test('confirmed privacy deletion clears only owned keys and memory and invalidates hidden drafts', () => {
  const f = fixture();
  const result = clearLocalRecords(f.store, f.session, f.expected, () => true);
  assert.equal(result.status, 'cleared');
  assert.deepEqual(f.removed, [STORE_KEYS.favorites, STORE_KEYS.compare]);
  assert.deepEqual([...f.data.keys()], ['unrelated']);
  assert.deepEqual(f.session.getSnapshot().profile.allergies, []);
  assert.deepEqual(f.session.getSnapshot().checks, []);
  assert.equal(f.session.saveProfile({ allergies: ['private-old-draft'] }, f.expected.safetyRevision).ok, false);
  assert.equal(clearLocalRecords(f.store, f.session, f.expected, () => true).status, 'stale');
  assert.equal(f.removed.length, 2);
});

test('a changed collection or health session invalidates the entire confirmation before deletion', () => {
  for (const changed of ['favorites', 'compare', 'health', 'page']) {
    const f = fixture();
    if (changed === 'health') f.session.saveProfile({ conditions: ['new-value'] }, f.expected.safetyRevision);
    else if (changed !== 'page') f.data.set(changed === 'favorites' ? STORE_KEYS.favorites : STORE_KEYS.compare, ['bai-he', 'shan-yao']);
    const result = clearLocalRecords(f.store, f.session, f.expected, () => changed !== 'page');
    assert.equal(result.status, 'stale');
    assert.equal(f.removed.length, 0);
    assert.equal(f.session.getSnapshot().clearEpoch, 0);
  }
});

test('read failure never wipes unavailable lists but still honors health deletion', () => {
  const f = fixture();
  f.failRead();
  assert.equal(clearLocalRecords(f.store, f.session, f.expected, () => true).status, 'health_only');
  assert.equal(f.removed.length, 0);
  assert.deepEqual(f.data.get(STORE_KEYS.favorites), ['bai-he']);
  assert.deepEqual(f.session.getSnapshot().profile.conditions, []);
});

test('failed or ignored storage removal is explicit; health cannot survive partial deletion', () => {
  for (const failure of ['throw', 'ignored']) {
    const f = fixture();
    if (failure === 'throw') f.failRemoval(STORE_KEYS.compare);
    else f.ignoreRemoval(STORE_KEYS.compare);
    const result = clearLocalRecords(f.store, f.session, f.expected, () => true);
    assert.equal(result.status, 'partial');
    if (result.status !== 'partial') return;
    assert.equal(result.favorites.ok, true);
    assert.equal(result.compare.ok, false);
    assert.deepEqual(f.data.get(STORE_KEYS.compare), ['shan-yao']);
    assert.deepEqual(f.session.getSnapshot().profile.allergies, []);
    assert.equal(f.session.getSnapshot().clearEpoch, 1);
  }
});
