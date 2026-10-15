import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assessIngredient, bindBrowseSafety, createBrowseSession, createSafetySession, parseCatalog, searchCatalog } from '../src/index.js';
import type { BrowseSession } from '../src/index.js';

function prepare(browser: BrowseSession) {
  browser.input('根', browser.getSnapshot().boundary);
  browser.filter('checked', browser.getSnapshot().revision);
  browser.more(106, browser.getSnapshot().revision);
  browser.savePosition(650, browser.getSnapshot().revision);
}

test('profile changes reset result layout without clearing queries; checklist changes preserve all browsing', () => {
  const health = createSafetySession();
  const catalog = createBrowseSession(); const favorites = createBrowseSession();
  const dispose = bindBrowseSafety(health, [catalog, favorites, catalog]);
  prepare(catalog); prepare(favorites);
  const before = catalog.getSnapshot();
  health.setChecks(['identity'], health.getSnapshot().revision);
  assert.equal(catalog.getSnapshot(), before); assert.equal(catalog.position(), 650);
  health.saveProfile({ allergies: ['百合'] }, health.getSnapshot().revision);
  for (const browser of [catalog, favorites]) {
    assert.equal(browser.getSnapshot().query, '根'); assert.equal(browser.getSnapshot().filter, 'checked');
    assert.equal(browser.getSnapshot().visible, 12); assert.equal(browser.position(), 0);
  }
  assert.equal(catalog.getSnapshot().revision, before.revision + 1, 'A duplicate binding does not reset twice');
  const applied = catalog.getSnapshot();
  health.saveProfile({ allergies: ['百合'] }, health.getSnapshot().revision);
  assert.equal(catalog.getSnapshot(), applied, 'Unchanged profile does not invalidate the list');
  dispose(); prepare(catalog);
  const detached = catalog.getSnapshot();
  health.clear(health.getSnapshot().revision);
  assert.equal(catalog.getSnapshot(), detached, 'An owner can dispose its binding');
});

test('privacy deletion clears both hidden list contexts even when the health profile was already empty', () => {
  const health = createSafetySession(); const browsers = [createBrowseSession(), createBrowseSession()];
  bindBrowseSafety(health, browsers);
  for (const browser of browsers) prepare(browser);
  const previous = browsers.map(browser => browser.getSnapshot());
  health.clear(health.getSnapshot().revision);
  browsers.forEach((browser, index) => {
    const before = previous[index]; assert.ok(before);
    const state = browser.getSnapshot();
    assert.equal(state.query, ''); assert.equal(state.filter, 'all'); assert.equal(state.visible, 12);
    assert.equal(browser.position(), 0);
    assert.equal(browser.input('restore deleted text', before.boundary), false);
    assert.equal(browser.more(106, before.revision), false);
  });
  const empty = browsers[0]?.getSnapshot(); assert.ok(empty);
  health.clear(health.getSnapshot().revision);
  assert.ok((browsers[0]?.getSnapshot().boundary ?? 0) > empty.boundary);
});

test('real catalog paging/filter/search matrix remains consistent across profile changes and red flags', () => {
  const parsed = parseCatalog(JSON.parse(readFileSync(new URL('../../../apps/miniprogram/src/data/catalog.json', import.meta.url), 'utf8')));
  assert.ok(parsed.ok);
  const health = createSafetySession(); const browser = createBrowseSession(); bindBrowseSafety(health, [browser]);
  const results = () => {
    const state = browser.getSnapshot();
    return searchCatalog(parsed.catalog, state.query)
      .filter(item => state.filter === 'all' || item.partReview === (state.filter === 'checked' ? 'source_checked' : 'pending'))
      .filter(item => !assessIngredient(item, health.getSnapshot().profile).blocked);
  };
  const allIds = new Set<string>();
  for (const filter of ['checked', 'pending'] as const) {
    browser.filter(filter, browser.getSnapshot().revision);
    const matching = results(); const expectedIds = matching.map(item => item.id);
    while (browser.getSnapshot().visible < matching.length) {
      const previous = browser.getSnapshot();
      assert.equal(browser.more(matching.length, previous.revision), true);
      assert.equal(browser.more(matching.length, previous.revision), false, 'Old pagination cannot replay');
    }
    assert.deepEqual(results().slice(0, browser.getSnapshot().visible).map(item => item.id), expectedIds);
    for (const id of expectedIds) { assert.ok(!allIds.has(id)); allIds.add(id); }
  }
  browser.reset(); assert.equal(allIds.size, results().length, 'Both review filters partition the visible catalog');
  browser.input('百合', browser.getSnapshot().boundary); assert.deepEqual(results().map(item => item.id), ['bai-he']);
  health.saveProfile({ allergies: ['百合'] }, health.getSnapshot().revision);
  assert.equal(browser.getSnapshot().query, '百合'); assert.deepEqual(results(), []);
  health.addRedFlags(['breathing_difficulty'], health.getSnapshot().revision); assert.deepEqual(results(), []);
  health.clear(health.getSnapshot().revision);
  assert.equal(browser.getSnapshot().query, ''); assert.equal(browser.getSnapshot().filter, 'all');
  assert.equal(results().length, allIds.size);
});
