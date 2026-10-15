import type { ContentRevision, ManagedSource, SourceReference } from '../shared/contracts';

// Match the pinned identity, never the source array position or latest revision.
export function fixedSourceReferences(refs: readonly SourceReference[], sources: readonly ManagedSource[]) {
  return refs.map(ref => {
    const matches = sources.filter(source => source.id === ref.id && source.revision === ref.revision);
    return { ref, source: matches.length === 1 ? matches[0] : null };
  });
}
export function hasFixedSourceReferences(snapshot: ContentRevision) {
  return snapshot.content.sourceRefs.length > 0 && fixedSourceReferences(snapshot.content.sourceRefs, snapshot.sources).every(row => row.source !== null);
}
