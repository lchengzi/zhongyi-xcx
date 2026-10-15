import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectSources, isClientSource, validateClientImports, validateAppRoutes, validateCompiledEntries, validatePublicContentBuild } from '../inspect-mini-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const page = path.join(root, 'apps/miniprogram/src/page.ts');
const core = path.join(root, 'packages/catalog-core/src/catalog.ts');
const appFixture = () => ({
  pages: ['pages/catalog/index', 'pages/favorites/index', 'pages/compare/index', 'pages/safety/index', 'pages/about/index'],
  subPackages: [{ root: 'subpackages/catalog', pages: ['detail/index'] }]
});

test('compiled public origin manifest is explicit and rejects unsafe or unexplained fields', () => {
  const disabled = { schemaVersion: 1, protocolVersion: 1, mode: 'disabled', origin: null };
  const online = { ...disabled, mode: 'configured', origin: 'https://food.company.cn' };
  assert.deepEqual(validatePublicContentBuild(disabled), disabled);
  assert.deepEqual(validatePublicContentBuild(online), online);
  for (const invalid of [null, [], { ...disabled, privateKey: 'never-public' },
    { ...disabled, protocolVersion: 2 }, { ...disabled, origin: online.origin }, { ...online, origin: null },
    ...['http://food.company.cn', 'https://127.0.0.1', 'https://food.local', 'https://food.example.com',
      'https://user:secret@food.company.cn', 'https://food.company.cn/', 'https://food.company.cn?secret=value',
      'https://food.company.cn:4310', 'https://food..company.cn'].map(origin => ({ ...online, origin }))]) {
    assert.throws(() => validatePublicContentBuild(invalid));
  }
});

test('client imports accept public contracts and platform components', () => {
  assert.doesNotThrow(() => validateClientImports('import type { CatalogSnapshot } from "@food-education/catalog-core"; import { View } from "@tarojs/components";', page));
});
test('client import boundaries reject server modules, private content and computed loading', () => {
  for (const source of [
    'import x from "../../../zhongyi-platform/server/assistant-provider";',
    'export * from "../../../zhongyi/content-private/recipes";',
    'import fs from "node:fs";',
    'import privateApi from "@food-education/catalog-core/server";',
    'const x = require(secretPath);'
  ]) assert.throws(() => validateClientImports(source, page));
});
test('all client JavaScript and TypeScript source extensions receive dependency checks', () => {
  for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
    const filename = page.replace(/\.ts$/, extension);
    assert.equal(isClientSource(filename), true);
    assert.throws(() => validateClientImports('import secret from "../../../zhongyi-platform/server/auth";', filename), /escapes/);
    assert.throws(() => validateClientImports('module.exports = require("node:fs");', filename), /not permitted/);
    assert.doesNotThrow(() => validateClientImports('import { searchCatalog } from "@food-education/catalog-core";', filename));
  }
  for (const filename of ['catalog.json', 'page.scss', 'image.png']) assert.equal(isClientSource(filename), false);
});
test('module loading and TypeScript import syntax cannot escape public roots', () => {
  for (const source of [
    'const secret = import("../../../zhongyi/content-private/review.json");',
    'const secret = module.require("node:fs");',
    'const secret = module["require"]("node:fs");',
    'const secret = require.resolve("node:fs");',
    'const secret = require["resolve"]("node:fs");',
    'const secret = module.require(secretPath);',
    'import secret = require("node:fs");',
    'type Secret = import("../../../zhongyi-platform/server/auth").Account;'
  ]) assert.throws(() => validateClientImports(source, page));
});
test('pure catalog core cannot depend on the application or UI frameworks', () => {
  assert.doesNotThrow(() => validateClientImports('import type { Ingredient } from "./catalog.js";', core));
  for (const source of [
    'import { useState } from "react";',
    'import Taro from "@tarojs/taro";',
    'import app from "../../../apps/miniprogram/src/app";'
  ]) assert.throws(() => validateClientImports(source, core));
  assert.throws(() => validateClientImports('import core from "../../../packages/catalog-core/src/index";', page), /escapes/);
});
test('actual client source remains within approved package boundaries', () => {
  assert.ok(inspectSources() >= 5);
});
test('compiled app must contain the five user functions and detail subpackage', () => {
  const { routes } = validateAppRoutes(appFixture());
  assert.deepEqual(routes, [...appFixture().pages, 'subpackages/catalog/detail/index']);
  const alternate = appFixture();
  alternate.subpackages = alternate.subPackages;
  delete alternate.subPackages;
  assert.deepEqual(validateAppRoutes(alternate).routes, routes);
  for (const invalid of [
    null,
    { ...appFixture(), pages: Array(4).fill('pages/catalog/index') },
    { ...appFixture(), pages: appFixture().pages.filter(page => page !== 'pages/safety/index') },
    { ...appFixture(), pages: ['../outside', ...appFixture().pages.slice(1)] },
    { ...appFixture(), subPackages: [{ root: 'subpackages/catalog', pages: [] }] },
    { ...appFixture(), subPackages: [{ root: 'subpackages/catalog', pages: ['other/index'] }] },
    { ...appFixture(), subPackages: [{ root: 'subpackages/catalog', pages: ['../../outside'] }] },
    { ...appFixture(), subPackages: [...appFixture().subPackages, ...appFixture().subPackages] },
    { ...appFixture(), subpackages: appFixture().subPackages }
  ]) assert.throws(() => validateAppRoutes(invalid));
});
test('compiled structure requires application entry and every declared page', () => {
  const { routes } = validateAppRoutes(appFixture());
  const entries = ['app.js', 'app.json', 'app.wxss', ...routes.flatMap(route => ['.js', '.json', '.wxml'].map(extension => route + extension))]
    .map(name => ({ path: name, bytes: 10 }));
  assert.doesNotThrow(() => validateCompiledEntries(entries, routes));
  for (const missing of ['app.js', 'app.json', 'app.wxss', 'subpackages/catalog/detail/index.js', 'pages/catalog/index.wxml']) {
    assert.throws(() => validateCompiledEntries(entries.filter(entry => entry.path !== missing), routes), /Missing compiled/);
  }
});
test('global stylesheet supports pages without local WXSS but cannot be empty', () => {
  const { routes } = validateAppRoutes(appFixture());
  const entries = ['app.js', 'app.json', 'app.wxss', ...routes.flatMap(route => ['.js', '.json', '.wxml'].map(extension => route + extension))]
    .map(name => ({ path: name, bytes: 10 }));
  assert.doesNotThrow(() => validateCompiledEntries(entries, routes));
  assert.doesNotThrow(() => validateCompiledEntries([...entries, { path: 'subpackages/catalog/detail/index.wxss', bytes: 0 }], routes));
  assert.throws(() => validateCompiledEntries(entries.map(entry => entry.path === 'app.wxss' ? { ...entry, bytes: 0 } : entry), routes), /must not be empty/);
});
test('historical projection contains real catalog entries and no approved photos or personal assessment', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'apps/miniprogram/src/data/catalog.json'), 'utf8'));
  assert.equal(data.ingredients.length, 106);
  assert.equal(data.catalogAsOf, '2026-08-10');
  assert.equal(data.schemaVersion, '1.1.0');
  assert.equal(data.rulesVersion, '1.6.0');
  assert.equal(new Set(data.ingredients.map(item => item.id)).size, 106);
  for (const item of data.ingredients) {
    assert.equal(item.professionalReview, 'pending');
    assert.equal(item.image, null);
    assert.ok(item.riskNotes.length > 0);
    assert.ok(item.sources.length > 0);
    assert.equal('profile' in item, false);
    assert.equal('eligible' in item, false);
    assert.ok(item.safety);
    assert.ok(Object.values(item.safety.population).every(value => value === 'no' || value === 'unknown'));
  }
});
