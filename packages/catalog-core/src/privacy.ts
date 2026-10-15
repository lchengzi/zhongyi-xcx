import type { SelectionStore, SelectionResult } from './selection.js';
import type { createSafetySession } from './safety-session.js';

export interface DeletionContext {
  readonly favoritesRevision: number;
  readonly compareRevision: number;
  readonly safetyRevision: number;
  readonly clearEpoch: number;
}
export type LocalDeletionResult =
  | { readonly status: 'stale'; readonly healthCleared: false }
  | { readonly status: 'health_only'; readonly healthCleared: true }
  | { readonly status: 'cleared' | 'partial'; readonly healthCleared: true; readonly favorites: SelectionResult; readonly compare: SelectionResult };

/** Called after confirmation. No global storage wipe, no invented rollback. */
export function clearLocalRecords(store: SelectionStore, session: ReturnType<typeof createSafetySession>, expected: DeletionContext, pageIsCurrent: () => boolean): LocalDeletionResult {
  if (!pageIsCurrent() || !session.isCurrent(expected.safetyRevision, expected.clearEpoch)) return { status: 'stale', healthCleared: false };
  const favorites = store.read('favorites');
  const compare = store.read('compare');
  if (!pageIsCurrent() || !session.isCurrent(expected.safetyRevision, expected.clearEpoch)) return { status: 'stale', healthCleared: false };
  if (favorites.status === 'ready' && favorites.revision !== expected.favoritesRevision) return { status: 'stale', healthCleared: false };
  if (compare.status === 'ready' && compare.revision !== expected.compareRevision) return { status: 'stale', healthCleared: false };
  // Reading a collection failed: never reinterpret it as empty or overwrite it.
  // The separately held health answers can still be removed as requested.
  const health = session.clear(expected.safetyRevision);
  if (!health.ok) return { status: 'stale', healthCleared: false };
  if (favorites.status !== 'ready' || compare.status !== 'ready') return { status: 'health_only', healthCleared: true };
  const favoriteResult = store.clear('favorites', expected.favoritesRevision);
  const compareResult = store.clear('compare', expected.compareRevision);
  return { status: favoriteResult.ok && compareResult.ok ? 'cleared' : 'partial', healthCleared: true, favorites: favoriteResult, compare: compareResult };
}
