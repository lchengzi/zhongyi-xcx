import type { EditorialNote, IngredientDetail } from './contracts.js';
import { date, id, invalid, number, object, parseIngredient, text } from './workflow-response.js';

export function parseEditorialNote(value: unknown, ingredientId: string): EditorialNote {
  const item = object(value, 'ingredientId text revision updatedAt');
  const note: EditorialNote = { ingredientId: id(item.ingredientId), text: text(item.text, 1200, false),
    revision: number(item.revision, 0), updatedAt: item.updatedAt === null ? null : date(item.updatedAt) };
  if (note.ingredientId !== ingredientId || (note.revision === 0 ? note.text !== '' || note.updatedAt !== null : note.updatedAt === null)) invalid();
  return note;
}
export function parseIngredientDetail(value: unknown, ingredientId: string): IngredientDetail {
  const item = object(value, 'ingredient note'), ingredient = parseIngredient(item.ingredient);
  if (ingredient.id !== ingredientId) invalid();
  return { ingredient, note: parseEditorialNote(item.note, ingredientId) };
}
export function parseSavedNote(value: unknown, previous: EditorialNote, input: string): EditorialNote {
  const note = parseEditorialNote(value, previous.ingredientId);
  if (note.revision !== previous.revision + 1 || note.text !== input.trim()) invalid();
  return note;
}
export function parseReloadedIngredientDetail(value: unknown, previous: IngredientDetail): IngredientDetail {
  const result = parseIngredientDetail(value, previous.ingredient.id);
  // Imported catalog payloads are immutable; editorial notes are versioned
  // independently. A read cannot silently regress a baseline or replace it at
  // the same revision. Later commits may legitimately advance by more than one.
  if (JSON.stringify(result.ingredient) !== JSON.stringify(previous.ingredient) || result.note.revision < previous.note.revision ||
    (result.note.revision === previous.note.revision && (result.note.text !== previous.note.text || result.note.updatedAt !== previous.note.updatedAt))) invalid();
  return result;
}
