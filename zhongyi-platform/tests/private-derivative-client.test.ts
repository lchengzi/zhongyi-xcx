import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository } from '../server/database.js';
import { AuthRepository } from '../server/auth.js';
import { readPrivateDerivative } from '../web/private-photo-api.js';
import { createSyntheticPublicationAssets } from './photo-publication-assets-fixture.js';
import { fixtureSeed } from './fixture.js';

test('prepared-image client verifies metadata/candidate digests and never dispatches an already-cancelled read', async () => {
  const assets = createSyntheticPublicationAssets(), repo = new CatalogRepository(':memory:', fixtureSeed()), auth = new AuthRepository(repo.db), originalFetch = globalThis.fetch;
  try {
    await auth.createUser('preview-client', 'fixture-password-for-preview-2026', 'editor', 'test'); const session = (await auth.login('preview-client', 'fixture-password-for-preview-2026', 'test')).info;
    const calls: string[] = [];
    globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json(assets.metadata); };
    assert.deepEqual(await readPrivateDerivative(assets.photo, session, new AbortController().signal), assets.metadata); assert.deepEqual(calls, [`/api/v1/private-photo-derivatives/${assets.photo.id}`]);
    for (const value of [{ ...assets.metadata, digest: `sha256:${'0'.repeat(64)}` }, { ...assets.metadata, bindingDigest: `sha256:${'0'.repeat(64)}` }, { ...assets.metadata, candidate: { ...assets.photo, sourceRevision: '2' } }]) {
      globalThis.fetch = async () => Response.json(value); await assert.rejects(readPrivateDerivative(assets.photo, session, new AbortController().signal));
    }
    const controller = new AbortController(); controller.abort(); globalThis.fetch = async () => { assert.fail('must not dispatch'); };
    await assert.rejects(readPrivateDerivative(assets.photo, session, controller.signal), { name: 'AbortError' });
    const late = new AbortController(); globalThis.fetch = async () => { late.abort(); return Response.json(assets.metadata); };
    await assert.rejects(readPrivateDerivative(assets.photo, session, late.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; repo.close(); }
});
