import { createContext, useContext, useEffect, useRef } from 'react';

export const TestPageVisibility = createContext(true);
let connected = false, confirmModal = false;
const networkListeners = new Set<(event: { isConnected: boolean }) => void>();
export function emitTestConnectivity(value: boolean) {
  connected = value;
  for (const listener of networkListeners) listener({ isConnected: value });
}
export function confirmNextTestModal() { confirmModal = true; }

// Owned in-memory fixtures only; never read actual device/browser storage.
const records = new Map<string, unknown>([
  ['zhongyi_favorites_v1', []], ['zhongyi_compare_v1', ['bai-he', 'shan-yao']],
]);
// Opt-in recording fixture starts without preselected items. Existing layout
// and recovery fixtures keep their original setup unless this is called.
export function initializeEmptyDemoSelections() {
  records.set('zhongyi_favorites_v1', []); records.set('zhongyi_compare_v1', []);
}
export function useDidShow(callback: () => void) {
  const current = useRef(callback); current.current = callback;
  const active = useContext(TestPageVisibility);
  useEffect(() => { if (active) current.current(); }, [active]);
}
export function useDidHide(callback: () => void) {
  const current = useRef(callback); current.current = callback;
  const active = useContext(TestPageVisibility), wasActive = useRef(active);
  useEffect(() => { if (wasActive.current && !active) current.current(); wasActive.current = active; }, [active]);
  useEffect(() => () => { if (wasActive.current) current.current(); }, []);
}
export function useUnload(callback: () => void) {
  const current = useRef(callback); current.current = callback;
  useEffect(() => () => { current.current(); }, []);
}
export function usePageScroll(callback: (event: { scrollTop: number }) => void) {
  const current = useRef(callback); current.current = callback;
  useEffect(() => { const handler = () => current.current({ scrollTop: window.scrollY });
    window.addEventListener('scroll', handler); return () => window.removeEventListener('scroll', handler); }, []);
}
export function useRouter() { return { params: { id: new URLSearchParams(location.hash.split('?')[1]).get('id') ?? 'bai-he' } }; }
const go = async ({ url }: { url: string }) => { location.hash = url; };
export default {
  navigateTo: go, switchTab: go,
  nextTick(callback: () => void) { requestAnimationFrame(callback); },
  async pageScrollTo({ scrollTop }: { scrollTop: number }) { window.scrollTo(0, scrollTop); },
  getStorageSync(key: string) { return records.get(key) ?? ''; },
  setStorageSync(key: string, value: unknown) { records.set(key, value); },
  removeStorageSync(key: string) { records.delete(key); },
  async showToast() {}, async showModal() { const confirm = confirmModal; confirmModal = false; return { confirm }; }, async setClipboardData() {},
  async getNetworkType() { return { networkType: connected ? 'wifi' : 'none' }; },
  onNetworkStatusChange(listener: (event: { isConnected: boolean }) => void) { networkListeners.add(listener); },
  offNetworkStatusChange(listener: (event: { isConnected: boolean }) => void) { networkListeners.delete(listener); },
  request(input: { url: string; method: string; header: Record<string, string> }) {
    const abort = new AbortController();
    const promise = (connected ? fetch(input.url, { method: input.method, headers: input.header, credentials: 'omit', signal: abort.signal })
      .then(async response => ({ statusCode: response.status, data: await response.json() as unknown }))
      : Promise.reject(new Error('Test network offline')));
    return Object.assign(promise, { abort: () => abort.abort() });
  },
};
