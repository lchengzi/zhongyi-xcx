import { createSafetySession } from '@food-education/catalog-core';
import { useSyncExternalStore } from 'react';

// Health answers never pass through the device-storage adapter. The singleton
// lives only in this app runtime, and is discarded when the runtime exits.
export const safetySession = createSafetySession();

export function useSafety(canInteract: () => boolean) {
  const state = useSyncExternalStore(safetySession.subscribe, safetySession.getSnapshot, safetySession.getSnapshot);
  return {
    state,
    isCurrent: () => canInteract() && safetySession.isCurrent(state.revision, state.clearEpoch),
  };
}
