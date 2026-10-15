import { clearLocalRecords, createSelectionStore, selectionErrorMessage } from '@food-education/catalog-core';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { catalogResult } from '../data/catalog';
import { deviceStorage } from '../platform/storage';
import { notify } from '../platform/feedback';
import { safetySession } from './safety';
import { syncFavoritesBrowse } from './browsing';

type SelectionKind = 'favorites' | 'compare';
const store = createSelectionStore(deviceStorage, catalogResult.ok ? catalogResult.catalog.ingredients.map(item => item.id) : []);

function snapshot() {
  return { favorites: store.getSnapshot('favorites'), compare: store.getSnapshot('compare') };
}

export function useSelections(canInteract: () => boolean) {
  const [state, setState] = useState(snapshot);
  const deleting = useRef(false);
  const updateState = () => {
    const next = snapshot();
    syncFavoritesBrowse(next.favorites);
    setState(next);
  };
  const refresh = () => {
    store.read('favorites');
    store.read('compare');
    updateState();
  };
  useEffect(() => {
    refresh();
    return () => store.invalidate();
  }, []);
  useDidShow(refresh);
  useDidHide(() => store.invalidate());
  useUnload(() => store.invalidate());

  function change(kind: SelectionKind, id: string, operation: 'toggle' | 'remove') {
    if (!canInteract() || deleting.current) return;
    const before = state[kind];
    const result = store[operation](kind, id, before.revision);
    updateState();
    if (!result.ok) {
      notify(selectionErrorMessage(result.errorCode));
      return;
    }
    if (!result.changed) return;
    const added = result.state.ids.includes(id);
    notify(kind === 'favorites' ? (added ? '已收藏' : '已取消收藏') : (added ? '已加入对比' : '已移出对比'));
  }

  async function clearRecords(confirm: () => Promise<boolean>) {
    if (!canInteract() || deleting.current) return;
    deleting.current = true;
    const health = safetySession.getSnapshot();
    const expected = { favoritesRevision: state.favorites.revision, compareRevision: state.compare.revision, safetyRevision: health.revision, clearEpoch: health.clearEpoch };
    try {
      if (!(await confirm()) || !canInteract()) return;
      const result = clearLocalRecords(store, safetySession, expected, canInteract);
      updateState();
      if (result.status === 'stale') notify('记录已变化，请重新确认删除');
      else if (result.status === 'health_only') notify('安全信息已清除；列表待读取，未删除');
      else if (result.status === 'cleared') notify('本机记录与本次安全信息已清除');
      else if (result.favorites.ok) notify('安全信息与收藏已清除；对比结果待确认');
      else if (result.compare.ok) notify('安全信息与对比已清除；收藏结果待确认');
      else notify('安全信息已清除；列表删除结果待确认');
    } finally {
      deleting.current = false;
    }
  }

  return {
    ...state,
    refresh,
    isCurrent: (kind: SelectionKind, revision: number) => canInteract() && store.getSnapshot(kind).revision === revision,
    toggle: (kind: SelectionKind, id: string) => change(kind, id, 'toggle'),
    remove: (kind: SelectionKind, id: string) => change(kind, id, 'remove'),
    clearRecords,
  };
}
