import { useSyncExternalStore } from 'react';
import type { BrowseFilter, BrowseSession } from '@food-education/catalog-core';

/** Typing is continuous; clear/confirm/filter boundaries invalidate old input. */
export function useSearch(canInteract: () => boolean, session: BrowseSession) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const isCurrent = () => canInteract() && session.getSnapshot().revision === state.revision;
  return {
    ...state,
    isCurrent,
    input: (value: unknown) => canInteract() && session.input(value, state.boundary),
    confirm: (value: unknown) => canInteract() && session.confirm(value, state.boundary),
    clear: () => isCurrent() && session.clear(state.revision),
    chooseFilter: (value: BrowseFilter) => isCurrent() && session.filter(value, state.revision),
    more: (total: number) => isCurrent() && session.more(total, state.revision),
  };
}
