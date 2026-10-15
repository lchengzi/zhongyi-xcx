import { bindBrowseSafety, createBrowseSession, type SelectionState } from '@food-education/catalog-core';
import { safetySession } from './safety';

export const catalogBrowse = createBrowseSession();
export const favoritesBrowse = createBrowseSession();
bindBrowseSafety(safetySession, [catalogBrowse, favoritesBrowse]);

let confirmedFavorites: readonly string[] | null = null;
/** Observe confirmed reads, not storage revisions: hiding/retrying alone must
 * not lose list context, and a failed read must never stand for an empty list. */
export function syncFavoritesBrowse(state: SelectionState): void {
  if (state.status !== 'ready') return;
  const before = confirmedFavorites;
  confirmedFavorites = state.ids;
  if (before !== null && (before.length !== state.ids.length || before.some((id, index) => id !== state.ids[index]))) {
    favoritesBrowse.resetResults();
  }
}
