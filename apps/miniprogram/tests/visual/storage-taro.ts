import { useContext, useLayoutEffect, useRef } from 'react';
import base, { TestPageVisibility } from './taro';
export * from './taro';

// In-memory fault injection only. No browser/device storage is read or cleared.
type WriteMode = 'normal' | 'throw' | 'ignore' | 'persist-throw' | 'readback-failed';
type RemoveMode = 'normal' | 'throw' | 'ignore' | 'persist-throw';
type ModalMode = 'confirm' | 'cancel' | 'reject' | 'defer';
const favoritesKey = 'zhongyi_favorites_v1', compareKey = 'zhongyi_compare_v1';
const records = new Map<string, unknown>([[favoritesKey, ['shan-yao']], [compareKey, ['bai-he', 'shan-yao']], ['unrelated-test-key', { keep: true }]]);
const listeners = new Set<() => void>();
const operations: { operation: 'read' | 'write' | 'remove'; key: string }[] = [];
const toasts: string[] = [];
let readFailure = false, writeMode: WriteMode = 'normal', removeMode: RemoveMode = 'normal', modalMode: ModalMode = 'cancel';
let compareReadFailure = false, compareWriteMode: WriteMode = 'normal';
let modalCount = 0, pendingModal: ((value: { confirm: boolean }) => void) | null = null;
const serialize = () => JSON.stringify({ records: Object.fromEntries(records), operations, toasts, modalCount, pendingModal: pendingModal !== null });
let snapshot = serialize();
function emit() { snapshot = serialize(); for (const listener of listeners) listener(); }
export const storageProbe = { getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
export const faultControls = {
  failReads(value: boolean) { readFailure = value; },
  failCompareReads(value: boolean) { compareReadFailure = value; },
  compareWrite(mode: WriteMode) { compareWriteMode = mode; },
  malformed() { records.set(favoritesKey, { invalidTestRecord: true }); emit(); },
  restoreRecords() { records.set(favoritesKey, ['shan-yao']); emit(); },
  replaceSameCount() { records.set(favoritesKey, ['lian-zi']); emit(); },
  replaceFavorites(ids: readonly string[]) { records.set(favoritesKey, [...ids]); emit(); },
  replaceCompare(ids: readonly string[]) { records.set(compareKey, [...ids]); emit(); },
  write(mode: WriteMode) { writeMode = mode; },
  remove(mode: RemoveMode) { removeMode = mode; },
  modal(mode: ModalMode) { modalMode = mode; },
  resolveModal() { const resolve = pendingModal; if (!resolve) throw new Error('No owned test confirmation'); pendingModal = null; emit(); resolve({ confirm: true }); },
};

// Hide effects precede show effects, including retained test tabs. This is a
// lifecycle adapter, not evidence that WeChat's native hooks were exercised.
export function useDidHide(callback: () => void) {
  const current = useRef(callback); current.current = callback;
  const active = useContext(TestPageVisibility), wasActive = useRef(active);
  useLayoutEffect(() => { if (wasActive.current && !active) current.current(); wasActive.current = active; }, [active]);
  useLayoutEffect(() => () => { if (wasActive.current) current.current(); }, []);
}

export default {
  ...base,
  getStorageSync(key: string) {
    operations.push({ operation: 'read', key }); emit();
    if (key === favoritesKey && readFailure) throw new Error('Simulated read failure');
    if (key === compareKey && compareReadFailure) throw new Error('Simulated compare read failure');
    return records.get(key) ?? '';
  },
  setStorageSync(key: string, value: unknown) {
    operations.push({ operation: 'write', key });
    const mode = key === favoritesKey ? writeMode : key === compareKey ? compareWriteMode : 'normal';
    if (mode === 'throw') { emit(); throw new Error('Simulated write rejection'); }
    if (mode !== 'ignore') records.set(key, value);
    if (key === favoritesKey && mode === 'readback-failed') readFailure = true;
    if (key === compareKey && mode === 'readback-failed') compareReadFailure = true;
    emit();
    if (mode === 'persist-throw') throw new Error('Simulated receipt failure');
  },
  removeStorageSync(key: string) {
    operations.push({ operation: 'remove', key });
    if (key === compareKey && removeMode === 'throw') { emit(); throw new Error('Simulated removal rejection'); }
    if (!(key === compareKey && removeMode === 'ignore')) records.delete(key);
    emit();
    if (key === compareKey && removeMode === 'persist-throw') throw new Error('Simulated removal receipt failure');
  },
  async showToast(input: { title: string }) { toasts.push(input.title); emit(); },
  async showModal() {
    modalCount++;
    if (modalMode === 'defer') return new Promise<{ confirm: boolean }>(resolve => { pendingModal = resolve; emit(); });
    emit();
    if (modalMode === 'reject') throw new Error('Simulated modal failure');
    return { confirm: modalMode === 'confirm' };
  },
};
