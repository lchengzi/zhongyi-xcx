import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { AuthRepository } from '../server/auth.js';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { publicCatalog } from '../server/public-catalog.js';
import { validateSeed } from '../server/seed.js';
import { fixtureSeed } from './fixture.js';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '../../zhongyi');
function catalogControlEvent(instance: any) { return { currentTarget: { dataset: { version: instance.data.interactionVersion } } }; }
async function serve(repo: CatalogRepository) {
  const server = createApp(repo, { mode: 'accounts' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, api: (path = '/api/v1/public/catalog', init?: RequestInit) => fetch(origin + path, init),
    close: async () => { const closed = once(server, 'close'); server.close(); await closed; } };
}

test('anonymous SQL catalog is exact and isolated from accounts, notes and accepted private drafts', async () => {
  const seed = fixtureSeed(); const repo = new CatalogRepository(':memory:', seed);
  const auth = new AuthRepository(repo.db);
  const editor = await auth.createUser('private-editor', 'test-only-editor-password', 'editor', 'test-fixture');
  const reviewer = await auth.createUser('private-reviewer', 'test-only-reviewer-password', 'reviewer', 'test-fixture');
  const work = new WorkflowRepository(repo.db);
  const source = work.saveSource({ title: 'SECRET_PRIVATE_SOURCE', publisher: 'PRIVATE_ISSUER', url: 'https://example.org/private-source' }, editor);
  const draft = work.saveDraft('huang-qi', { ediblePart: 'PRIVATE_PART', latinName: '', educationText: 'SECRET_PRIVATE_DRAFT',
    safetyText: 'PRIVATE_SAFETY', sourceRefs: [{ id: source.id, revision: 1, locator: 'PRIVATE_LOCATOR' }] }, 0, editor);
  const submitted = work.submit('huang-qi', draft.lockVersion, editor);
  const accepted = work.decide(submitted.task.id, 'accept', 'PRIVATE_REVIEW_COMMENT', submitted.draft.lockVersion, reviewer);
  assert.equal(accepted.state, 'editorial_accepted');
  repo.saveNote('huang-qi', 'SECRET_EDITORIAL_NOTE', 0, editor.username);
  const service = await serve(repo);
  try {
    const response = await service.api(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.deepEqual(body, publicCatalog(seed));
    assert.equal(body.items[0].professionalReviewState, 'pending');
    const encoded = JSON.stringify(body);
    for (const value of ['PRIVATE', 'SECRET', editor.id, source.id, submitted.task.id, 'csrfToken', 'password', 'noteCount']) assert.equal(encoded.includes(value), false);
    for (const path of ['/api/v1/ingredients', '/api/v1/users', '/api/v1/editorial/sources', '/api/v1/editorial/tasks', '/api/v1/events']) {
      assert.equal((await service.api(path)).status, 401);
    }
    for (const path of ['/api/v1/public/ingredients/huang-qi', '/api/v1/public/editorial/sources', '/api/v1/public/tasks', '/api/v1/public/publish', '/api/v1/public/catalog/']) {
      assert.equal((await service.api(path)).status, 404);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) assert.equal((await service.api(undefined, { method })).status, 404);
    for (const query of ['q=黄芪', 'profile=secret', 'page=1', 'q=a&q=b', 'catalogVersion=x']) {
      assert.equal((await service.api('/api/v1/public/catalog?' + encodeURI(query))).status, 400);
    }
    const bodyStatus = await new Promise<number>((resolveStatus, reject) => {
      const request = httpRequest(service.origin + '/api/v1/public/catalog', {
        method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }
      }, (result) => { result.resume(); result.once('end', () => resolveStatus(result.statusCode!)); });
      request.once('error', reject); request.end('{}');
    });
    assert.equal(bodyStatus, 400);
    assert.deepEqual(await (await service.api(undefined, { headers: { Authorization: 'Bearer wrong' } })).json(), body);
    assert.equal(repo.note('huang-qi').text, 'SECRET_EDITORIAL_NOTE');
  } finally { await service.close(); repo.close(); }
});

test('out-of-band database/metadata changes fail closed instead of becoming a publication path', async () => {
  const changes: ((repo: CatalogRepository) => void)[] = [
    (repo) => repo.db.prepare("UPDATE metadata SET value = 'new-release' WHERE key = 'releaseId'").run(),
    (repo) => repo.db.prepare("UPDATE metadata SET value = '2099-01-01' WHERE key = 'sourceAsOf'").run(),
    (repo) => repo.db.prepare("UPDATE metadata SET value = 'forged' WHERE key = 'seedDigest'").run(),
    (repo) => repo.db.prepare("DELETE FROM ingredients WHERE id = 'huang-qi'").run(),
    ...['extra', 'review', 'source', 'identity', 'malformed', 'id'].map((kind) => (repo: CatalogRepository) => {
      const item: any = repo.ingredient('huang-qi');
      if (kind === 'extra') item.privateDraft = 'DO_NOT_LEAK';
      if (kind === 'review') item.professionalReviewState = 'reviewed';
      if (kind === 'source') item.sources[0].url = 'https://attacker.example.org';
      if (kind === 'identity') item.ediblePart = 'all parts';
      if (kind === 'id') item.id = 'forged-id';
      repo.db.prepare("UPDATE ingredients SET payload = ? WHERE id = 'huang-qi'").run(kind === 'malformed' ? '{' : JSON.stringify(item));
    })
  ];
  for (const change of changes) {
    const repo = new CatalogRepository(':memory:', fixtureSeed()); const service = await serve(repo);
    try { change(repo); const response = await service.api(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'catalog_unavailable', message: '目录版本校验失败，请使用本地资料。' }); }
    finally { await service.close(); repo.close(); }
  }
  const seed = fixtureSeed(); const repo = new CatalogRepository(':memory:', seed);
  try { seed.ingredients[0].name = 'caller changed the input'; assert.notEqual(repo.publicSnapshot().ingredients[0].name, seed.ingredients[0].name); }
  finally { repo.close(); }
});

test('public catalog reads a persisted SQL snapshot after full database and HTTP restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zhongyi-public-catalog-')); const filename = join(directory, 'test.sqlite');
  try {
    const seed = fixtureSeed(); const repo = new CatalogRepository(filename, seed); const first = await serve(repo);
    let before;
    try { repo.saveNote('huang-qi', 'PRIVATE_RESTART_NOTE', 0); before = await (await first.api()).json(); }
    finally { await first.close(); repo.close(); }
    const reopened = new CatalogRepository(filename, fixtureSeed()); const second = await serve(reopened);
    try { assert.deepEqual(await (await second.api()).json(), before); assert.equal(reopened.note('huang-qi').text, 'PRIVATE_RESTART_NOTE'); }
    finally { await second.close(); reopened.close(); }
  } finally { unlinkSync(filename); rmdirSync(directory); }
});

test('actual 106-row SQL → HTTP → mini adapter → catalog/detail; local health never enters a request', async () => {
  const seed = validateSeed(JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/catalog.seed.json'), 'utf8')));
  const repo = new CatalogRepository(':memory:', seed); const service = await serve(repo);
  const runtime = globalThis as any;
  const previous = Object.fromEntries(['wx', 'App', 'Page', 'getApp'].map((key) => [key, runtime[key]]));
  const configPath = require.resolve(join(miniRoot, 'config/public-api.js'));
  const adapterPath = require.resolve(join(miniRoot, 'utils/public-catalog.js'));
  const config = require(configPath); const previousUrl = config.baseUrl;
  const previousAdapter = require.cache[adapterPath];
  const appPath = require.resolve(join(miniRoot, 'app.js'));
  const indexPath = require.resolve(join(miniRoot, 'pages/index/index.js'));
  const detailPath = require.resolve(join(miniRoot, 'subpackages/catalog/detail/detail.js'));
  const privacyPath = require.resolve(join(miniRoot, 'pages/privacy/privacy.js'));
  let app: any; const definitions: any[] = []; const requests: any[] = []; const copied: string[] = [];
  let failTransport = false; let delayed: any = null; let delayResponse = false;
  const storage: Record<string, any> = {};
  const complete = (options: any, statusCode: number, data: any) => {
    if (delayResponse) delayed = { options, statusCode, data };
    else options.success({ statusCode, data });
  };
  const tick = async () => { for (let i = 0; i < 100; i += 1) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    if (delayed || runtimeClient.getState().mode !== 'loading') return;
  } throw new Error('Mini adapter did not settle'); };
  let runtimeClient: any;
  try {
    runtime.wx = {
      getStorageSync: (key: string) => storage[key] ?? '', setStorageSync: (key: string, value: any) => { storage[key] = value; },
      removeStorageSync: (key: string) => { delete storage[key]; }, getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
      showToast() {}, setNavigationBarTitle() {}, showTabBar() {}, hideTabBar() {}, reLaunch() {},
      showModal: (options: any) => options.success({ confirm: true }),
      setClipboardData: (options: any) => { copied.push(options.data); options.success?.({}); },
      request: (options: any) => {
        requests.push(options); const controller = new AbortController();
        if (failTransport) queueMicrotask(() => options.fail({ errMsg: 'synthetic offline transport' }));
        else {
          assert.equal(options.url, 'https://content.example.test/api/v1/public/catalog');
          // The ONLY simulated part is wx transport: the target is a real HTTP
          // server with real SQL. This is not a WeChat/HTTPS/device test.
          void fetch(service.origin + '/api/v1/public/catalog', { signal: controller.signal })
            .then(async (response) => complete(options, response.status, await response.json()))
            .catch(() => options.fail({}));
        }
        return { abort: () => controller.abort() };
      }
    };
    runtime.App = (definition: any) => { app = definition; };
    runtime.getApp = () => app;
    runtime.Page = (definition: any) => { definitions.push(definition); };
    config.baseUrl = 'https://content.example.test'; delete require.cache[adapterPath];
    runtimeClient = require(adapterPath); config.baseUrl = previousUrl;
    for (const path of [appPath, indexPath, detailPath, privacyPath]) { delete require.cache[path]; require(path); }
    app.onLaunch(); assert.equal(requests.length, 0, 'launch must not auto-connect');
    const profile = require(join(miniRoot, 'utils/privacy.js')).createEmptySessionSafetyProfile();
    app.globalData.sessionSafetyProfile = { ...profile, ageGroup: 'adult', allergyStatus: 'yes', allergies: ['SECRET_HEALTH_ALLERGY'],
      conditionStatus: 'yes', conditions: ['SECRET_HEALTH_CONDITION'], medicationStatus: 'yes', medications: ['SECRET_HEALTH_MEDICATION'] };
    const page = (definition: any) => ({ ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch: any) { Object.assign(this.data, patch); } });
    const index = page(definitions[0]); index.onLoad(); assert.equal(index.allIngredients.length, 106);
    assert.ok(index.data.resultCount > 0, 'local safety filtering may conservatively exclude some catalog rows');
    index.loadMore(); const expanded = JSON.parse(JSON.stringify(index.data.rows));
    index.onShow(); assert.equal(index.data.rows.length, 24);
    index.readServiceCatalog(catalogControlEvent(index)); await tick(); assert.deepEqual(index.data.rows, expanded);
    index.useLocalCatalog(catalogControlEvent(index)); assert.deepEqual(index.data.rows, expanded);
    const requestsBeforeSearch = requests.length;
    index.setData({ query: '黄芪' }); index.applyFilters(); const before = JSON.parse(JSON.stringify(index.data.rows));
    assert.equal(requests.length, requestsBeforeSearch, 'search stays local');
    const staleLocalControl = catalogControlEvent(index);
    index.readServiceCatalog(catalogControlEvent(index)); assert.equal(index.data.network.mode, 'loading');
    index.useLocalCatalog(staleLocalControl); assert.equal(index.data.network.mode, 'loading', 'old local control cannot cancel the current HTTP/SQL read');
    await tick();
    assert.equal(index.data.network.mode, 'online'); assert.deepEqual(index.data.rows, before); assert.equal(index.data.query, '黄芪');
    assert.equal(runtimeClient.getCatalog().length, 106);
    const detail = page(definitions[1]); detail.onLoad({ id: 'huang-qi' });
    assert.equal(detail.data.network.mode, 'online'); assert.ok(detail.data.sourceRows.length > 0);
    // Additional source metadata stays in the version-bound local snapshot;
    // the narrow HTTP projection is not widened to ship private/editorial data.
    const localIngredient = require(join(miniRoot, 'data/ingredients.js')).ingredients.find((item: any) => item.id === 'huang-qi');
    const onlineSources = JSON.parse(JSON.stringify(detail.data.sourceRows));
    const beforeSourceCopy = requests.length;
    for (const source of localIngredient.sources) {
      const rendered = detail.data.sourceRows.find((row: any) => row.id === source.id);
      assert.equal(rendered.publishedAt, source.publishedAt);
      assert.equal(rendered.checkedAt, source.checkedAt);
      assert.equal(rendered.scope, source.scope);
      assert.ok(['官方公告', '官方解读', '官方管理规定'].includes(rendered.typeText));
      detail.copySourceRecord({ currentTarget: { dataset: { id: source.id } } });
      const record = copied.at(-1)!;
      for (const text of ['黄芪｜来源记录', source.title, source.url, source.scope, source.publishedAt, source.checkedAt, '2026-08-10']) assert.ok(record.includes(text));
      assert.equal(record.includes('SECRET_HEALTH'), false);
    }
    assert.equal(requests.length, beforeSourceCopy, 'copying recorded source metadata does not fetch or upload anything');
    for (const options of requests) {
      assert.equal(options.method, 'GET'); assert.deepEqual(options.header, { Accept: 'application/json' });
      assert.equal('data' in options, false); assert.equal(options.url.includes('?'), false);
      assert.equal(JSON.stringify(options).includes('SECRET_HEALTH'), false);
    }
    assert.deepEqual(Object.keys(storage), [], 'network reads must not persist health or remote content');
    failTransport = true; index.readServiceCatalog(catalogControlEvent(index)); index.onHide(); index.onShow(); await tick();
    assert.equal(index.data.network.mode, 'fallback'); assert.deepEqual(index.data.rows, before);
    detail.onShow(); assert.deepEqual(detail.data.sourceRows, onlineSources, 'fallback must not invent newer publication/check dates');
    failTransport = false; index.readServiceCatalog(catalogControlEvent(index)); await tick(); assert.equal(index.data.network.mode, 'online');
    // Hold the actual HTTP/SQL result until the page has returned, rather than
    // substituting a resolved client Promise or considering a screenshot proof.
    delayResponse = true; const oldReadControl = catalogControlEvent(index);
    index.readServiceCatalog(oldReadControl); await tick(); assert.ok(delayed);
    const returnedRead = delayed; delayed = null;
    const beforeReturn = requests.length;
    index.onHide(); index.onShow(); assert.equal(index.data.network.mode, 'loading');
    assert.equal(requests.length, beforeReturn, 'returning observes the same read, not a new request');
    returnedRead.options.success({ statusCode: returnedRead.statusCode, data: returnedRead.data });
    await new Promise((done) => setTimeout(done, 0)); delayResponse = false;
    assert.equal(index.data.network.mode, 'online'); assert.deepEqual(index.data.rows, before);
    assert.equal(index.data.query, '黄芪'); assert.equal(requests.length, beforeReturn);
    index.readServiceCatalog(oldReadControl); assert.equal(requests.length, beforeReturn, 'returned old read button cannot initiate another HTTP request');
    index.setData({ redFlags: ['sudden_severe_chest_pain'] }); index.commitSafetyProfile(); index.applyFilters();
    const count = requests.length; index.readServiceCatalog(catalogControlEvent(index)); assert.equal(requests.length, count);
    assert.equal(index.data.resultCount, 0); detail.onShow(); assert.equal(detail.data.triageBlocked, true);
    index.setData({ redFlags: [] }); index.commitSafetyProfile(); index.applyFilters();
    detail.onShow();
    assert.equal(detail.data.triageBlocked, false);
    assert.equal(detail.data.ingredient.id, 'huang-qi', 'detail must recover after the committed red flag is explicitly cleared');
    assert.equal(detail.data.network.mode, 'online');
    assert.equal(requests.length, count, 'recovering a detail must not send the safety profile or start another request');
    delayResponse = true; index.readServiceCatalog(catalogControlEvent(index)); await tick(); assert.ok(delayed);
    const privacy = page(definitions[2]); privacy.onShow(); privacy.deleteLocalData();
    assert.equal(runtimeClient.getCatalog(), null); assert.equal(runtimeClient.getState().mode, 'offline');
    delayed.options.success({ statusCode: delayed.statusCode, data: delayed.data }); await new Promise((done) => setTimeout(done, 0));
    assert.equal(runtimeClient.getCatalog(), null); assert.deepEqual(app.globalData.sessionSafetyProfile.allergies, []);
    index.onShow(); assert.equal(index.data.query, ''); assert.equal(index.data.network.mode, 'offline'); assert.equal(index.data.resultCount, 106);
    detail.onShow();
    assert.equal(detail.data.network.mode, 'offline');
    assert.equal(detail.data.ingredient.id, 'huang-qi');
    assert.equal(detail.data.ingredient.isFavorite, false);
    assert.equal(detail.data.ingredient.inCompare, false);
    assert.equal(JSON.stringify(detail.data).includes('SECRET_HEALTH'), false, 'deleted health information must not return via cached detail rendering');
    assert.deepEqual(Object.keys(storage), []); index.onUnload();
  } finally {
    runtimeClient?.clear(); config.baseUrl = previousUrl;
    if (previousAdapter) require.cache[adapterPath] = previousAdapter; else delete require.cache[adapterPath];
    for (const path of [appPath, indexPath, detailPath, privacyPath]) delete require.cache[path];
    for (const key of Object.keys(previous)) { if (previous[key] === undefined) delete runtime[key]; else runtime[key] = previous[key]; }
    await service.close(); repo.close();
  }
});
