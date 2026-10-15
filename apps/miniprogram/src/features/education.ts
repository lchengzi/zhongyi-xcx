import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createEducationClient, findIngredient, watchEducationConnectivity, type EducationClient, type EducationState } from '@food-education/catalog-core';
import { catalogRelease, catalogResult } from '../data/catalog';
import { publicContentConfig } from '../config/public-content';
import { contentScheduler, publicEducationTransport } from '../platform/public-content';
import { safetySession } from './safety';
import { connectivity } from '../platform/connectivity';

const clients = new Set<EducationClient>();
const empty: EducationState = Object.freeze({ revision: 0, status: 'disabled', document: null, verifiedAt: null, expiresAt: null, error: null });
const getEmpty = () => empty;
const noSubscription = () => () => {};
let clearEpoch = safetySession.getSnapshot().clearEpoch;
// A confirmed privacy/health reset also drops public-reading memory and aborts
// requests on hidden pages. No storage key or health value enters the client.
safetySession.subscribe(() => {
  const next = safetySession.getSnapshot().clearEpoch;
  if (next === clearEpoch && !safetySession.getSnapshot().profile.redFlags.length) return;
  clearEpoch = next;
  for (const client of clients) client.clear(client.getSnapshot().revision);
});

export function useEducation(id: string, suspended: boolean, canInteract: () => boolean) {
  const visible = useRef(true);
  const epoch = safetySession.getSnapshot().clearEpoch;
  const visitEpoch = useRef(epoch);
  const suspendedNow = useRef(suspended); suspendedNow.current = suspended;
  const client = useMemo(() => {
    const item = catalogResult.ok ? findIngredient(catalogResult.catalog, id) : undefined;
    if (!item || !catalogRelease || !publicContentConfig.origin) return null;
    return createEducationClient({ origin: publicContentConfig.origin,
      binding: { ingredientId: item.id, name: item.name, baseReleaseId: catalogRelease.releaseId },
      transport: publicEducationTransport, scheduler: contentScheduler, now: Date.now });
  }, [id]);
  const owner = useRef(client); owner.current = client;
  const state = useSyncExternalStore(client?.subscribe ?? noSubscription, client?.getSnapshot ?? getEmpty, getEmpty);
  const clear = () => { if (client) client.clear(client.getSnapshot().revision); };
  const canRead = () => {
    const health = safetySession.getSnapshot();
    return owner.current === client && client !== null && clients.has(client) && visible.current && !suspendedNow.current
      && health.clearEpoch === visitEpoch.current && !health.profile.redFlags.length;
  };
  useEffect(() => {
    if (!client) return;
    clients.add(client);
    const stopConnection = watchEducationConnectivity(client, connectivity, canRead);
    return () => { stopConnection(); clients.delete(client); client.clear(client.getSnapshot().revision); };
  }, [client]);
  useEffect(() => {
    if (!client) return;
    if (suspended) clear();
    else if (canRead()) void client.refresh();
  }, [client, suspended]);
  useDidShow(() => {
    visible.current = true;
    visitEpoch.current = safetySession.getSnapshot().clearEpoch;
    if (client && canRead()) void client.refresh();
  });
  const hide = () => { visible.current = false; clear(); };
  useDidHide(hide); useUnload(hide);
  return { state, isCurrent: () => canRead() && canInteract() && safetySession.getSnapshot().clearEpoch === epoch && client?.getSnapshot().revision === state.revision,
    refresh() {
    if (owner.current !== client || !client || !clients.has(client) || !visible.current || suspendedNow.current || !canInteract()
      || safetySession.getSnapshot().clearEpoch !== epoch || safetySession.getSnapshot().profile.redFlags.length || client.getSnapshot().revision !== state.revision) return;
    // A new explicit reading action can start a new privacy epoch. Network
    // callbacks alone must never revive the epoch invalidated by deletion.
    visitEpoch.current = epoch;
    void client.refresh();
  } };
}
