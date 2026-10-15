import type { BrowseSession } from './browse-session.js';
import type { createSafetySession } from './safety-session.js';

/** No health data is copied into the browse context or any persistence port. */
export function bindBrowseSafety(safety: ReturnType<typeof createSafetySession>, sessions: readonly BrowseSession[]): () => void {
  const browsers = [...new Set(sessions)];
  let previous = safety.getSnapshot();
  return safety.subscribe(() => {
    const next = safety.getSnapshot();
    const cleared = next.clearEpoch !== previous.clearEpoch;
    const profileChanged = next.profile !== previous.profile;
    previous = next;
    if (!cleared && !profileChanged) return; // Reading-check changes do not alter results.
    for (const browser of browsers) {
      if (cleared) browser.reset();
      else browser.resetResults();
    }
  });
}
