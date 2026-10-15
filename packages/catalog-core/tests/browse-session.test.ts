import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowseSession, restoreBrowsePosition } from '../src/index.js';

test('list context is immutable and memory-only, preserving query, pagination and position across subscribers', () => {
  const session = createBrowseSession(); let notifications = 0;
  const unsubscribe = session.subscribe(() => { notifications++; });
  assert.ok(Object.isFrozen(session.getSnapshot()));
  assert.equal(session.input('bai', 0), true); assert.equal(session.input('bai he', 0), true, 'Continuous native typing need not await a render');
  let state = session.getSnapshot(); assert.equal(state.query, 'bai he');
  assert.equal(session.more(106, state.revision), true); state = session.getSnapshot();
  assert.equal(session.savePosition(1234.5, state.revision), true); assert.equal(session.getSnapshot(), state);
  unsubscribe(); assert.equal(notifications, 3);
  assert.equal(session.position(), 1234.5); assert.equal(session.getSnapshot().visible, 24);
  assert.equal(createBrowseSession().getSnapshot().query, '');
});

test('clear, confirm and filter reject delayed input, replayed paging and stale list callbacks', () => {
  const session = createBrowseSession(); session.input('old', 0); const old = session.getSnapshot();
  assert.equal(session.confirm('new', old.boundary), true);
  assert.equal(session.input('late old input', old.boundary), false);
  assert.equal(session.more(100, old.revision), false);
  let state = session.getSnapshot(); assert.equal(session.filter('checked', state.revision), true);
  assert.equal(session.input('late confirm', state.boundary), false);
  state = session.getSnapshot(); assert.equal(session.clear(state.revision), true); assert.equal(session.clear(state.revision), false);
  assert.equal(session.getSnapshot().query, ''); assert.equal(session.getSnapshot().filter, 'checked');
});

test('query and filter changes reset pagination/position; malformed events cannot corrupt the list', () => {
  const session = createBrowseSession(); session.more(25, 0); const state = session.getSnapshot();
  session.savePosition(500, state.revision);
  for (const input of [null, {}, 123]) assert.equal(session.input(input, state.boundary), false);
  for (const input of [NaN, Infinity, -1, '20', 10_000_001]) assert.equal(session.savePosition(input, state.revision), false);
  for (const input of [NaN, 501, 25.5, -1, '40']) assert.equal(session.more(input, state.revision), false);
  assert.equal(session.filter('approved', state.revision), false); assert.equal(session.getSnapshot(), state);
  session.input('x'.repeat(80), state.boundary); assert.equal(session.getSnapshot().query.length, 60);
  assert.equal(session.getSnapshot().visible, 12); assert.equal(session.position(), 0);
  assert.throws(() => createBrowseSession(0));
});

test('privacy reset invalidates empty contexts and does not let broken observers retain search data', () => {
  const session = createBrowseSession(); session.subscribe(() => { throw new Error('observer'); });
  session.input('temporary search', 0); const previous = session.getSnapshot(); session.reset();
  assert.equal(session.input('restore old search', previous.boundary), false);
  const empty = session.getSnapshot(); session.reset(); assert.ok(session.getSnapshot().revision > empty.revision);
  assert.equal(session.getSnapshot().query, ''); assert.equal(session.position(), 0);
});

test('position restore waits for layout; hiding, changing search or deleting before callback prevents scrolling', async () => {
  for (const change of ['hide', 'query', 'reset', 'none']) {
    const session = createBrowseSession(); session.savePosition(875, 0);
    let deferred = () => {}; let active = true; const calls: number[] = [];
    const pending = restoreBrowsePosition(session, 0, () => active, { afterRender(callback) { deferred = callback; }, async scrollTo(top) { calls.push(top); } });
    assert.deepEqual(calls, []);
    if (change === 'hide') active = false;
    if (change === 'query') session.input('new', 0);
    if (change === 'reset') session.reset();
    deferred(); assert.equal(await pending, change === 'none'); assert.deepEqual(calls, change === 'none' ? [875] : []);
  }
});

test('platform layout or scrolling failure resolves explicitly instead of blocking page use', async () => {
  const session = createBrowseSession();
  assert.equal(await restoreBrowsePosition(session, 0, () => true, { afterRender() { throw new Error('layout'); }, async scrollTo() {} }), false);
  assert.equal(await restoreBrowsePosition(session, 0, () => true, { afterRender(callback) { callback(); }, async scrollTo() { throw new Error('scroll'); } }), false);
});

test('only layout changes advance viewport revision; pagination keeps the current position', () => {
  const session = createBrowseSession();
  let state = session.getSnapshot();
  session.savePosition(650, state.revision);
  session.more(106, state.revision);
  assert.equal(session.getSnapshot().viewportRevision, state.viewportRevision);
  assert.equal(session.position(), 650);
  for (const action of ['input', 'confirm', 'filter', 'clear', 'results', 'reset']) {
    state = session.getSnapshot();
    session.savePosition(800, state.revision);
    if (action === 'input') session.input('百合', state.boundary);
    if (action === 'confirm') session.confirm('百合', state.boundary);
    if (action === 'filter') session.filter('pending', state.revision);
    if (action === 'clear') session.clear(state.revision);
    if (action === 'results') session.resetResults();
    if (action === 'reset') session.reset();
    assert.equal(session.getSnapshot().viewportRevision, state.viewportRevision + 1, action);
    assert.equal(session.position(), 0, action);
  }
});

test('changed results preserve query/filter but invalidate paging, typing and old position restores', async () => {
  const session = createBrowseSession();
  session.input('根', 0);
  session.filter('checked', session.getSnapshot().revision);
  session.more(100, session.getSnapshot().revision);
  const before = session.getSnapshot();
  session.savePosition(900, before.revision);
  let layout = () => {};
  const scrolled: number[] = [];
  const pending = restoreBrowsePosition(session, before.revision, () => true, {
    afterRender(callback) { layout = callback; }, async scrollTo(top) { scrolled.push(top); }
  });
  session.resetResults(); layout();
  assert.equal(await pending, false); assert.deepEqual(scrolled, []);
  assert.equal(session.getSnapshot().query, '根');
  assert.equal(session.getSnapshot().filter, 'checked');
  assert.equal(session.getSnapshot().visible, 12);
  assert.equal(session.position(), 0);
  assert.equal(session.input('late text', before.boundary), false);
  assert.equal(session.more(100, before.revision), false);
  assert.equal(session.savePosition(900, before.revision), false);
});

test('scroll completion is not reported current after the page hides or context changes', async () => {
  for (const change of ['hide', 'query', 'none']) {
    const session = createBrowseSession(); let active = true;
    let finish = () => {};
    const pending = restoreBrowsePosition(session, 0, () => active, {
      afterRender(callback) { callback(); },
      scrollTo() { return new Promise<void>(resolve => { finish = resolve; }); }
    });
    if (change === 'hide') active = false;
    if (change === 'query') session.input('百合', 0);
    finish(); assert.equal(await pending, change === 'none');
  }
});
