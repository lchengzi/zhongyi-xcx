import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { runtimeConfig } from '../server/runtime-config.js';
import { publicationEnabled } from '../server/publication-config.js';
import { CatalogRepository } from '../server/database.js';
import { validateActionInput, validateApprovalInput, validateControlInput, validateSnapshotInput } from '../server/publication-values.js';
import { fixtureSeed } from './fixture.js';
import { registerPublicationHttpCases } from './publication-http-cases.js';
import { postgresPublicationHttpBackend, servePublicationHttpFixture, sqlitePublicationHttpBackend } from './publication-http-fixture.js';

test('publication configuration is explicit, defaults off, rejects ambiguous values and cannot enable local-key mode', () => {
  for (const value of [undefined, '', 'false']) assert.equal(publicationEnabled({ EDUCATION_PUBLICATION_ENABLED: value }), false);
  assert.equal(publicationEnabled({ EDUCATION_PUBLICATION_ENABLED: 'true' }), true);
  for (const value of ['TRUE', '1', ' true', 'yes', 'false ']) assert.throws(() => runtimeConfig({ EDUCATION_PUBLICATION_ENABLED: value }));
  assert.equal(runtimeConfig({}).publicationEnabled, false);
  assert.throws(() => runtimeConfig({ AUTH_MODE: 'local-key', EDUCATION_PUBLICATION_ENABLED: 'true' }), /accounts|account/);
  const repo = new CatalogRepository(':memory:', fixtureSeed());
  try {
    assert.throws(() => createApp(repo, 'a'.repeat(32), undefined, { publicationEnabled: true }), /account/);
    assert.throws(() => createApp(repo, { mode: 'accounts' }, undefined, { publicationEnabled: 'true' as any }), /boolean/);
  } finally { repo.close(); }
});

registerPublicationHttpCases('sqlite', sqlitePublicationHttpBackend);

test('PostgreSQL publication HTTP refuses missing owned-fixture configuration without a skip or fallback', async () => {
  const savedConnection = process.env.PG_TEST_DATABASE_URL; const savedNonce = process.env.PG_TEST_NONCE;
  try {
    delete process.env.PG_TEST_DATABASE_URL; process.env.PG_TEST_NONCE = 'guard-unit-only';
    await assert.rejects(postgresPublicationHttpBackend(), /Owned real PostgreSQL controller fixture required/);
    process.env.PG_TEST_DATABASE_URL = 'postgresql://never-opened.invalid/test'; delete process.env.PG_TEST_NONCE;
    await assert.rejects(postgresPublicationHttpBackend(), /Owned real PostgreSQL controller fixture required/);
  } finally {
    if (savedConnection === undefined) delete process.env.PG_TEST_DATABASE_URL; else process.env.PG_TEST_DATABASE_URL = savedConnection;
    if (savedNonce === undefined) delete process.env.PG_TEST_NONCE; else process.env.PG_TEST_NONCE = savedNonce;
  }
});

test('publication HTTP refuses a mismatched engine label before listening and closes its owned fixture', async () => {
  const backend = await sqlitePublicationHttpBackend(); const dispose = backend.close; let disposed = 0;
  backend.close = async () => { disposed++; await dispose(); };
  let unexpected: Awaited<ReturnType<typeof servePublicationHttpFixture>> | undefined;
  try {
    await assert.rejects(async () => { unexpected = await servePublicationHttpFixture(backend, 'postgres'); }, /real repository bundle/);
    assert.equal(disposed, 1);
  } finally { await unexpected?.close(); }
});

test('publication API documentation request examples match strict input validators without executing publication', () => {
  const document = readFileSync(resolve('docs/publication-api.md'), 'utf8');
  const examples = [...document.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((match) => JSON.parse(match[1]) as unknown);
  const validators = [validateSnapshotInput, validateApprovalInput, validateActionInput, validateControlInput];
  assert.equal(examples.length, validators.length, 'Keep one checked request example for each publication write contract');
  for (let index = 0; index < examples.length; index++) assert.doesNotThrow(() => validators[index](examples[index]));
});
