import { createReadingPreferences, type ReadingSize } from '@food-education/catalog-core';
import { useSyncExternalStore } from 'react';

const preferences = createReadingPreferences();
export function useReadingPreferences() {
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  return {
    state,
    setSize(size: ReadingSize, canInteract: () => boolean) {
      if (canInteract()) preferences.setSize(size, state.revision);
    },
  };
}
