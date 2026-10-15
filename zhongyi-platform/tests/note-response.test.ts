import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorialNote } from '../shared/contracts.js';
import { parseEditorialNote, parseIngredientDetail, parseReloadedIngredientDetail, parseSavedNote } from '../shared/note-response.js';
import { CatalogRepository } from '../server/database.js';
import { fixtureSeed } from './fixture.js';

const time = '2026-10-11T00:00:00.000Z';
const initial: EditorialNote = { ingredientId: 'huang-qi', text: '', revision: 0, updatedAt: null };
const saved: EditorialNote = { ...initial, text: '仅测试备注', revision: 1, updatedAt: time };

test('note projection binds identity, zero baseline, text bounds, revisions and valid dates', () => {
  assert.deepEqual(parseEditorialNote(initial, 'huang-qi'), initial); assert.deepEqual(parseEditorialNote(saved, 'huang-qi'), saved);
  assert.equal(parseEditorialNote({ ...saved, text: '' }, 'huang-qi').revision, 1);
  for (const bad of [null, {}, { ...saved, ingredientId: 'jiang' }, { ...saved, revision: '1' }, { ...saved, revision: -1 },
    { ...saved, text: 'x'.repeat(1201) }, { ...saved, updatedAt: null }, { ...initial, text: 'not empty' }, { ...initial, updatedAt: time },
    { ...saved, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...saved, updatedAt: '2026-02-30T00:00:00.000Z' }, { ...saved, privateEvidence: 'private' }])
    assert.throws(() => parseEditorialNote(bad, 'huang-qi'));
});

test('save and clear acknowledgements bind normalized intent and exactly one revision advance', () => {
  assert.deepEqual(parseSavedNote(saved, initial, '  仅测试备注  '), saved);
  assert.equal(parseSavedNote({ ...saved, text: '', revision: 2 }, saved, '  ').text, '');
  for (const bad of [{ ...saved, revision: 2 }, { ...saved, revision: 0 }, { ...saved, text: 'other operation' }, { ...saved, ingredientId: 'jiang' }])
    assert.throws(() => parseSavedNote(bad, initial, saved.text));
  assert.throws(() => parseSavedNote({ ...saved, text: saved.text, revision: 2 }, saved, ''));
});

test('detail and explicit reload reject mixed objects, unsafe nested URLs and regressing or substituted baselines', () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const item = repo.ingredient('huang-qi'); assert.ok(item);
    const previous = parseIngredientDetail({ ingredient: item, note: saved }, 'huang-qi');
    assert.deepEqual(parseReloadedIngredientDetail(previous, previous), previous);
    assert.equal(parseReloadedIngredientDetail({ ...previous, note: { ...saved, revision: 5, text: 'later independent change' } }, previous).note.revision, 5);
    for (const bad of [{ ...previous, note: initial }, { ...previous, note: { ...saved, text: 'same-version replacement' } },
      { ...previous, note: { ...saved, updatedAt: '2026-10-11T01:00:00.000Z' } }, { ...previous, ingredient: { ...item, name: 'changed identity' } }])
      assert.throws(() => parseReloadedIngredientDetail(bad, previous));
    for (const bad of [{ ingredient: { ...item, id: 'jiang' }, note: initial }, { ingredient: item, note: { ...initial, ingredientId: 'jiang' } },
      { ingredient: { ...item, privateNote: 'private' }, note: initial }, { ingredient: { ...item, sources: [{ id: 'test-source', title: 'test', publisher: 'test', url: 'javascript:alert(1)', status: 'published', checkedAt: '' }] }, note: initial }])
      assert.throws(() => parseIngredientDetail(bad, 'huang-qi'));
    const parsed = parseIngredientDetail(previous, 'huang-qi'); parsed.ingredient.aliases.push('changed'); assert.deepEqual(previous.ingredient, item);
  } finally { repo.close(); }
});

test('actual SQLite initial, saved, concurrent and cleared notes parse without dropping audit revisions', () => {
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    const item = repo.ingredient('huang-qi'); assert.ok(item);
    const initialDetail = parseIngredientDetail({ ingredient: item, note: repo.note(item.id) }, item.id);
    const first = parseSavedNote(repo.saveNote(item.id, 'first', 0), initialDetail.note, ' first ');
    repo.saveNote(item.id, 'second', 1); repo.saveNote(item.id, 'third', 2);
    const current = parseReloadedIngredientDetail({ ingredient: item, note: repo.note(item.id) }, { ingredient: item, note: first });
    const cleared = parseSavedNote(repo.saveNote(item.id, '', current.note.revision), current.note, '');
    assert.equal(cleared.revision, 4); assert.equal(cleared.text, ''); assert.equal(repo.events().length, 4);
    assert.equal(repo.events()[0].action, 'note_cleared');
  } finally { repo.close(); }
});
