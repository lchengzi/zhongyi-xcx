import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPhotoClient, createPhotoBatchClient, findIngredient, type Ingredient, type PhotoState, type PhotoBatchState } from '@food-education/catalog-core';
import { catalogRelease, catalogResult } from '../data/catalog';
import { publicContentConfig } from '../config/public-content';
import { contentScheduler, publicEducationTransport } from '../platform/public-content';
import { connectivity } from '../platform/connectivity';
import { safetySession } from './safety';

const clients = new Set<{ clear(): void }>();
let clearEpoch = safetySession.getSnapshot().clearEpoch;
safetySession.subscribe(() => {
  const next = safetySession.getSnapshot();
  if (clearEpoch === next.clearEpoch && !next.profile.redFlags.length) return;
  clearEpoch = next.clearEpoch; for (const client of clients) client.clear();
});
const empty: PhotoState = Object.freeze({ revision: 0, status: 'disabled', gallery: null });
const getEmpty = () => empty, subscribeEmpty = () => () => {};
const emptyBatch: PhotoBatchState = Object.freeze({ revision: 0, status: 'disabled', galleries: Object.freeze({}) });
const getEmptyBatch = () => emptyBatch;
const MIN_DETAIL_RECHECK_INTERVAL_MS = 1000;

function usePhotoLifecycle(client: { clear(): void } | null, suspended: boolean, refresh: () => void) {
  const visible = useRef(true), visitEpoch = useRef(safetySession.getSnapshot().clearEpoch);
  const suspendedNow = useRef(suspended); suspendedNow.current = suspended;
  const refreshNow = useRef(refresh); refreshNow.current = refresh;
  const owner = useRef(client); owner.current = client;
  const allowed = () => {
    const safety = safetySession.getSnapshot();
    return !!client && owner.current === client && clients.has(client) && visible.current && !suspendedNow.current &&
      visitEpoch.current === safety.clearEpoch && !safety.profile.redFlags.length && connectivity.getSnapshot().status !== 'offline';
  };
  useEffect(() => {
    if (!client) return;
    clients.add(client);
    let previous = connectivity.getSnapshot().status;
    const stop = connectivity.subscribe(() => {
      const next = connectivity.getSnapshot().status;
      if (next === previous) return; previous = next;
      if (next === 'offline') client.clear(); else if (allowed()) refreshNow.current();
    });
    if (allowed()) refreshNow.current();
    return () => { stop(); clients.delete(client); client.clear(); };
  }, [client]);
  useEffect(() => { if (suspended) client?.clear(); else if (client && allowed()) refreshNow.current(); }, [client, suspended]);
  useDidShow(() => {
    visible.current = true; visitEpoch.current = safetySession.getSnapshot().clearEpoch;
    if (client && allowed()) refreshNow.current();
  });
  const hide = () => { visible.current = false; client?.clear(); };
  useDidHide(hide); useUnload(hide);
  return allowed;
}

/** Details read a single gallery; lists use bounded requests below. */
export function usePhotos(id: string, suspended: boolean, canInteract: () => boolean) {
  const lastReadStartedAt = useRef(0);
  const client = useMemo(() => {
    const item = catalogResult.ok ? findIngredient(catalogResult.catalog, id) : undefined;
    return item && catalogRelease && publicContentConfig.origin ? createPhotoClient({ origin: publicContentConfig.origin,
      binding: { ingredientId: item.id, name: item.name, baseReleaseId: catalogRelease.releaseId },
      now: Date.now, transport: publicEducationTransport, scheduler: contentScheduler }) : null;
  }, [id]);
  const state = useSyncExternalStore(client?.subscribe ?? subscribeEmpty, client?.getSnapshot ?? getEmpty, getEmpty);
  const read = () => { lastReadStartedAt.current = Date.now(); void client?.refresh(); };
  const allowed = usePhotoLifecycle(client, suspended, read);
  const isCurrent = () => allowed() && canInteract() && client?.getSnapshot() === state;
  useEffect(() => {
    if (!client || state.status !== 'expired' || !isCurrent()) return;
    const elapsed = Date.now() - lastReadStartedAt.current;
    const delay = Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(0, MIN_DETAIL_RECHECK_INTERVAL_MS - elapsed) : MIN_DETAIL_RECHECK_INTERVAL_MS;
    // Only a verified expiry schedules renewal. Errors/withdrawal do not loop;
    // very short server lifetimes cannot create a tight automatic request loop.
    return contentScheduler.after(delay, () => { if (client.getSnapshot() === state && isCurrent()) read(); });
  }, [client, state.status, state.revision]);
  return { state, origin: publicContentConfig.origin, isCurrent,
    refresh() { if (isCurrent()) read(); } };
}

export function useCardPhotos(ingredients: readonly Ingredient[], suspended: boolean, canInteract: () => boolean) {
  const key = ingredients.map(item => item.id).join(',');
  const bindings = useMemo(() => {
    if (!key || !catalogResult.ok || !catalogRelease) return [];
    const catalog = catalogResult.catalog, baseReleaseId = catalogRelease.releaseId;
    return key.split(',').flatMap(id => {
      const item = findIngredient(catalog, id); return item ? [{ ingredientId: item.id, name: item.name, baseReleaseId }] : [];
    });
  }, [key]);
  const client = useMemo(() => catalogRelease && publicContentConfig.origin ? createPhotoBatchClient({ origin: publicContentConfig.origin,
    now: Date.now, transport: publicEducationTransport, scheduler: contentScheduler }) : null, []);
  const state = useSyncExternalStore(client?.subscribe ?? subscribeEmpty, client?.getSnapshot ?? getEmptyBatch, getEmptyBatch);
  const allowed = usePhotoLifecycle(client, suspended, () => { void client?.refresh(bindings); });
  useEffect(() => { if (client && allowed()) void client.refresh(bindings); }, [client, bindings]);
  // Only a verified expiry can trigger renewal; HTTP/transport errors do not loop.
  useEffect(() => { if (client && state.status === 'expired' && allowed()) void client.refresh(bindings); }, [client, state.status, state.revision]);
  const galleries = allowed() ? state.galleries : emptyBatch.galleries;
  return { galleries, origin: publicContentConfig.origin, isCurrent: () => allowed() && canInteract() && client?.getSnapshot() === state };
}
