import Taro, { useDidHide, useDidShow, usePageScroll, useUnload } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { restoreBrowsePosition, type BrowseSession, type BrowseViewport } from '@food-education/catalog-core';

const viewport: BrowseViewport = {
  afterRender: callback => Taro.nextTick(callback),
  async scrollTo(top) { await Taro.pageScrollTo({ scrollTop: top, duration: 0 }); }
};

export function useBrowsePosition(session: BrowseSession, revision: number, viewportRevision: number, canInteract: () => boolean, layoutReady = true) {
  const active = useRef(true);
  const restoring = useRef(false);
  const restorationId = useRef(0);
  const [visit, setVisit] = useState(0);
  usePageScroll(event => { if (layoutReady && active.current && !restoring.current && canInteract()) session.savePosition(event.scrollTop, revision); });
  useDidShow(() => { active.current = true; restoring.current = true; restorationId.current++; setVisit(value => value + 1); });
  const hide = () => { active.current = false; restorationId.current++; };
  useDidHide(hide); useUnload(hide);
  useEffect(() => {
    let current = true;
    const id = ++restorationId.current;
    restoring.current = true;
    // A short loading/error layout must not clamp the saved position to zero.
    // A successful retry renders the real list before restoring that position.
    if (layoutReady) void restoreBrowsePosition(session, revision, () => current && id === restorationId.current && active.current && canInteract(), viewport).then(() => { if (current && id === restorationId.current) restoring.current = false; });
    return () => { current = false; };
    // A visit restores the saved position; a new query/filter/result set restores
    // zero after the new layout. Loading more and scroll events do neither.
  }, [visit, session, viewportRevision, layoutReady]);
}
