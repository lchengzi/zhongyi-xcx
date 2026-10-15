import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, sep, join } from 'node:path';

// Actual native JS page functions against an existing owned HTTP/SQL service.
// wx, navigation, storage and clipboard are simulated: NOT a WeChat/device/TLS test.
const require = createRequire(import.meta.url);
const mini = resolve(import.meta.dirname, '../../zhongyi');
type NativePage = Record<string, any>;
type NativeRequest = { url: string; method: string; header: Record<string, string>; data?: unknown;
  success(value: { statusCode: number; data: unknown }): void; fail(value: object): void };
export class MiniDemoFlowError extends Error {
  constructor(readonly phase: string) { super('Native demo task failed; fixture fields redacted.'); }
}

export async function verifyMiniDemoFlow(origin: string, expectedCatalog: unknown) {
  const target = new URL(origin);
  assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.username + target.password + target.search + target.hash, ''); assert.equal(target.pathname, '/');
  const runtime = globalThis as any;
  const globals = Object.fromEntries(['wx', 'App', 'Page', 'getApp'].map(k => [k, runtime[k]]));
  const ownedModule = (filename: string) => filename.startsWith(mini + sep);
  const previousModules = Object.entries(require.cache).filter(([filename]) => ownedModule(filename));
  for (const [filename] of previousModules) delete require.cache[filename];
  const memory: Record<string, unknown> = {}, copied: string[] = [], requests: NativeRequest[] = [];
  const persistentWrites: unknown[] = [], navigations: Array<{ method: string; url: string }> = [];
  const pages: NativePage[] = [], controllers = new Set<AbortController>(), tasks = new Set<Promise<void>>();
  let app: any, client: any, offline = false, closed = false, httpReads = 0, phase = 'initialize';
  const definitions = new Map<string, NativePage>();
  const checks = { noAutomaticRead: false, frozenSqlRead: false, searchAndDetail: false,
    favoritesAndCompare: false, consultation: false, offlineFallback: false, redFlagStopsActions: false,
    privacyDeletion: false, healthAndEditorialIsolation: false };
  const control = (page: NativePage) => ({ currentTarget: { dataset: { version: page.data.interactionVersion } } });
  const cardEvent = (page: NativePage, id: string) => ({ detail: { id, interactionVersion: page.data.interactionVersion } });
  async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('native_flow_observation_expired');
      await new Promise(done => setTimeout(done, 10));
    }
  }
  try {
    runtime.wx = {
      getStorageSync: (key: string) => memory[key] ?? '',
      setStorageSync: (key: string, value: unknown) => {
        persistentWrites.push(structuredClone({ key, value })); memory[key] = structuredClone(value);
      },
      removeStorageSync: (key: string) => { delete memory[key]; }, getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
      showToast() {}, setNavigationBarTitle() {}, showTabBar() {}, hideTabBar() {},
      showModal: (options: any) => options.success({ confirm: true }),
      setClipboardData: (options: any) => { copied.push(options.data); options.success?.({}); },
      ...Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map(method => [method, (options: any) => {
        navigations.push({ method, url: options.url }); options.success?.({});
      }]))
    };
    const adapterPath = require.resolve(join(mini, 'utils/public-catalog.js'));
    const adapter = require(adapterPath);
    client = adapter.createClient({ baseUrl: 'https://content.example.test' }, (options: NativeRequest) => {
      assert.equal(options.url, 'https://content.example.test/api/v1/public/catalog');
      assert.equal(options.method, 'GET'); assert.equal(options.data, undefined);
      assert.deepEqual(options.header, { Accept: 'application/json' }); requests.push(options);
      const controller = new AbortController(); controllers.add(controller);
      if (offline) queueMicrotask(() => { controllers.delete(controller); if (!closed) options.fail({}); });
      else {
        httpReads++;
        const task = (async () => {
          try {
            const response = await fetch(origin + '/api/v1/public/catalog', { signal: controller.signal,
              method: options.method, headers: options.header, redirect: 'error' });
            const body: unknown = await response.json(); assert.deepEqual(body, expectedCatalog);
            if (!closed) options.success({ statusCode: response.status, data: body });
          } catch { if (!closed) options.fail({}); }
          finally { controllers.delete(controller); }
        })();
        tasks.add(task); void task.finally(() => tasks.delete(task));
      }
      return { abort: () => controller.abort() };
    });
    // In-memory adapter substitution only; no project URL/configuration edits.
    require.cache[adapterPath]!.exports = { ...adapter, ...client };
    runtime.App = (value: any) => { app = value; }; runtime.getApp = () => app;
    require(join(mini, 'app.js')); app.onLaunch();
    for (const [name, relative] of [
      ['catalog', 'pages/index/index.js'], ['detail', 'subpackages/catalog/detail/detail.js'],
      ['favorites', 'pages/favorites/favorites.js'], ['compare', 'pages/compare/compare.js'],
      ['plan', 'pages/plan/plan.js'], ['privacy', 'pages/privacy/privacy.js']
    ]) {
      runtime.Page = (value: NativePage) => definitions.set(name, value); require(join(mini, relative));
    }
    const makePage = (name: string, options?: object) => {
      const definition = definitions.get(name)!;
      const page: NativePage = { ...definition, data: structuredClone(definition.data),
        setData(patch: object) { Object.assign(this.data, patch); } };
      pages.push(page); page.onLoad?.(options); page.onShow?.(); return page;
    };
    app.globalData.sessionSafetyProfile = { ...app.globalData.sessionSafetyProfile, ageGroup: 'adult',
      allergyStatus: 'yes', allergies: ['FIXTURE_PRIVATE_ALLERGY'], conditionStatus: 'yes',
      conditions: ['FIXTURE_PRIVATE_CONDITION'], medicationStatus: 'yes', medications: ['FIXTURE_PRIVATE_MEDICATION'] };
    const index = makePage('catalog'); assert.equal(requests.length, 0); checks.noAutomaticRead = true;
    phase = 'read actual demo SQL through HTTP';
    index.readServiceCatalog(control(index)); await waitFor(() => index.data.network.mode !== 'loading');
    assert.equal(index.data.network.mode, 'online'); assert.equal(client.getCatalog().length, 106);
    checks.frozenSqlRead = true;
    const afterRead = requests.length;
    async function search(query: string, id: string, confirm = false) {
      const event = { ...control(index), detail: { value: query } };
      if (confirm) {
        index.onSearchInput(event); index.onSearchConfirm(event);
        assert.equal(index.data.rows.length, 1); assert.equal(index.data.rows[0].id, id);
      } else index.onSearchInput(event);
      await waitFor(() => index.data.rows.length === 1 && index.data.rows[0].id === id);
      assert.equal(index.data.query, query);
    }
    phase = 'native search detail and source copy'; await search('huangqi', 'huang-qi');
    assert.match(index.data.rows[0].searchMatchText, /^拼音命中：/);
    index.onSearchInput({ ...control(index), detail: { value: 'dangshen' } });
    index.clearSearch({ currentTarget: { dataset: { version: index.data.interactionVersion, query: index.data.query } } });
    index.loadMore(); assert.equal(index.data.rows.length, 24);
    await new Promise(done => setTimeout(done, 200)); assert.equal(index.data.rows.length, 24);
    await search('huangqi', 'huang-qi', true); assert.equal(requests.length, afterRead);
    index.openDetail(cardEvent(index, 'huang-qi'));
    assert.deepEqual(navigations.at(-1), { method: 'navigateTo', url: '/subpackages/catalog/detail/detail?id=huang-qi' });
    const detail = makePage('detail', { id: 'huang-qi' });
    assert.equal(detail.data.network.mode, 'online'); assert.equal(detail.data.ingredient.id, 'huang-qi');
    assert(detail.data.sourceRows.length > 0);
    assert(detail.data.identityFacts.find((row: any) => row.label === '部位资料复核').value.includes('待'));
    detail.copySourceRecord({ currentTarget: { dataset: { id: detail.data.sourceRows[0].id } } });
    assert(copied.at(-1)!.includes('黄芪｜来源记录')); checks.searchAndDetail = true;
    phase = 'native favorites and comparison';
    detail.toggleFavorite(); detail.toggleCompare();
    await search('gouqizi', 'gou-qi-zi'); index.toggleCompare(cardEvent(index, 'gou-qi-zi'));
    const favorites = makePage('favorites'); assert.equal(favorites.data.favoriteCount, 1);
    favorites.onSearchInput({ detail: { value: 'huangqi' }, currentTarget: { dataset: { version: favorites.data.searchVersion } } });
    assert.equal(favorites.data.rows[0].id, 'huang-qi');
    const favoriteSearch = (value: string) => ({ detail: { value }, currentTarget: {
      dataset: { version: favorites.data.searchVersion, query: favorites.data.query } } });
    const staleFavoriteClear = favoriteSearch(''), staleFavoriteInput = favoriteSearch('dangshen');
    favorites.onSearchInput(favoriteSearch('gouqizi')); favorites.clearSearch(staleFavoriteClear);
    assert.equal(favorites.data.query, 'gouqizi'); assert.equal(favorites.data.rows.length, 0);
    favorites.clearSearch(favoriteSearch('')); favorites.onSearchInput(staleFavoriteInput);
    assert.equal(favorites.data.query, ''); assert.equal(favorites.data.rows[0].id, 'huang-qi');
    favorites.onSearchInput(favoriteSearch('huangqi')); favorites.clearSearch(staleFavoriteClear);
    assert.equal(favorites.data.query, 'huangqi'); assert.equal(favorites.data.rows[0].id, 'huang-qi');
    const compare = makePage('compare'); assert.equal(compare.data.ingredients.length, 2); assert(compare.data.groups.length > 0);
    compare.setReadingMode({ currentTarget: { dataset: { mode: 'table', version: compare.data.displayVersion } } });
    assert.equal(compare.data.readingMode, 'table'); checks.favoritesAndCompare = true;
    phase = 'native consultation preparation';
    const plan = makePage('plan'); assert.equal(plan.data.shortlist.length, 2);
    plan.onChecklistChange({ detail: { value: ['identity', 'no_combination'] } });
    assert.equal(plan.data.checkedCount, 2); plan.copyInquiry();
    assert(copied.at(-1)!.includes('不代表')); checks.consultation = true;
    assert.equal(requests.length, afterRead, 'browse/save/compare/consultation must not initiate HTTP');
    phase = 'native offline fallback'; offline = true;
    index.readServiceCatalog(control(index)); await waitFor(() => index.data.network.mode !== 'loading');
    assert.equal(index.data.network.mode, 'fallback'); assert.equal(index.data.rows[0].id, 'gou-qi-zi');
    detail.onShow(); assert.equal(detail.data.network.mode, 'fallback');
    const storage = require(join(mini, 'utils/storage.js'));
    assert.deepEqual(storage.getCompare(), ['huang-qi', 'gou-qi-zi']); assert.deepEqual(storage.getFavorites(), ['huang-qi']);
    checks.offlineFallback = true;
    phase = 'native red flag stops browsing and copy';
    app.globalData.sessionSafetyProfile.redFlags = ['sudden_severe_chest_pain'];
    index.onShow(); detail.onShow(); favorites.onShow(); compare.onShow(); plan.onShow();
    assert.equal(index.data.resultCount, 0); assert.equal(detail.data.triageBlocked, true);
    assert.equal(favorites.data.rows.length, 0); assert.equal(compare.data.ingredients.length, 0);
    const copiedBefore = copied.length, requestsBefore = requests.length;
    plan.copyInquiry(); detail.copySafetySummary(); index.readServiceCatalog(control(index));
    assert.equal(copied.length, copiedBefore); assert.equal(requests.length, requestsBefore); checks.redFlagStopsActions = true;
    phase = 'native privacy deletion and return';
    const staleSearch = { ...control(index), detail: { value: 'FICTIONAL_QUERY_TO_DELETE' } };
    const privacy = makePage('privacy'); privacy.deleteLocalData();
    assert.deepEqual(navigations.at(-1), { method: 'reLaunch', url: '/pages/index/index?privacyCleared=1' });
    assert.deepEqual(Object.keys(memory), []); assert.equal(client.getCatalog(), null); assert.equal(client.getState().mode, 'offline');
    index.onShow(); detail.onShow(); favorites.onShow(); compare.onShow(); plan.onShow();
    index.onSearchInput(staleSearch); index.onSearchInput(staleSearch); index.onSearchConfirm(staleSearch);
    assert.equal(index.data.query, ''); assert.equal(index.data.resultCount, 106);
    assert.equal(detail.data.ingredient.isFavorite, false); assert.equal(favorites.data.favoriteCount, 0);
    assert.equal(compare.data.ingredients.length, 0); assert.equal(plan.data.checkedCount, 0);
    assert.equal(requests.length, requestsBefore); checks.privacyDeletion = true;
    for (const encoded of [JSON.stringify(requests), JSON.stringify(memory), JSON.stringify(persistentWrites),
      JSON.stringify(navigations), ...copied, JSON.stringify(pages.map(p => p.data))]) {
      assert(!encoded.includes('FIXTURE_PRIVATE_'));
    }
    for (const privateText of ['独立演示备注，重启后应保留', '独立演示草稿，仅验证编辑协作', '独立演示来源，不是正式依据']) {
      assert(!JSON.stringify(expectedCatalog).includes(privateText));
    }
    checks.healthAndEditorialIsolation = true; assert(Object.values(checks).every(Boolean));
    assert.equal(httpReads, 1); assert.equal(requests.length, 2); assert.equal(copied.length, 2);
    assert(persistentWrites.length > 0); assert.equal(navigations.length, 2);
    return { checks, actualHttpReads: httpReads, transportAttempts: requests.length, copiedRecords: copied.length,
      persistentWritesInspected: persistentWrites.length, simulatedNavigationsInspected: navigations.length,
      pageFunctionsExercised: definitions.size, wxTransportSimulated: true, deviceVerified: false, tlsVerified: false };
  } catch { throw new MiniDemoFlowError(phase); }
  finally {
    closed = true;
    for (const page of pages) page.onUnload?.(); client?.clear();
    for (const controller of controllers) controller.abort(); await Promise.allSettled(tasks);
    for (const filename of Object.keys(require.cache)) if (ownedModule(filename)) delete require.cache[filename];
    for (const [filename, module] of previousModules) if (module) require.cache[filename] = module;
    for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete runtime[key]; else runtime[key] = value; }
  }
}
