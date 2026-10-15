import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWorkspaceSource, isPrivateSourcePath, stageWorkspaceSource, verifyWorkspaceSource } from '../workspace-source.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('source policy excludes private paths and preserves actual credential-handling implementation', () => {
  for (const path of ['zhongyi/content-private/a.json', 'node_modules/a.js', '.refactor/evidence/a.json',
    '.npm-cache/a', 'zhongyi-platform/.local/a', 'apps/miniprogram/dist/app.js', '.env', '.env.production',
    'apps/miniprogram/project.config.json', 'secret.key', 'a.sqlite-wal', 'credentials.json', '.npmrc']) {
    assert.equal(isPrivateSourcePath(path), true, path);
  }
  for (const path of ['.env.example', 'zhongyi-platform/server/container-secrets.ts',
    'zhongyi-platform/tests/credential-separation.test.ts', 'tools/tests/photo-research-local.test.ts']) {
    assert.equal(isPrivateSourcePath(path), false, path);
  }
});
test('actual source selection contains all TS products, locks, images and historical runtime without private inputs', () => {
  const files = collectWorkspaceSource(root), paths = new Set(files.map(file => file.path));
  for (const path of ['package-lock.json', 'zhongyi-platform/package-lock.json', 'apps/miniprogram/src/app.tsx',
    'packages/catalog-core/src/index.ts', 'zhongyi-platform/server/index.ts', 'zhongyi-platform/photo-processing/cli.ts',
    'zhongyi/data/version-manifest.json', 'zhongyi/tools/version-core.js', 'tools/tests/workspace-source.test.mjs',
    'tools/public-safety-projection.d.mts', 'apps/miniprogram/project.config.example.json', 'tools/source-archive.ps1',
    'zhongyi-platform/shared/editorial-references.ts', 'zhongyi-platform/web/DraftResearchReferences.tsx',
    'zhongyi-platform/tests/editorial-references.test.ts', 'zhongyi-platform/tests/editorial-references-browser.test.ts']) {
    assert(paths.has(path), path);
  }
  assert(!files.some(file => isPrivateSourcePath(file.path)));
  assert(files.some(file => file.path.startsWith('apps/miniprogram/src/assets/')));
  assert(files.every(file => /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes >= 0));
});
test('actual isolated copy matches source bytes and refuses nonempty, nested and redirected destinations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'food-source-policy-test-')), destination = join(directory, 'source'); mkdirSync(destination);
  const manifest = stageWorkspaceSource(root, destination); verifyWorkspaceSource(root, destination, manifest);
  for (const path of ['node_modules', 'zhongyi/content-private', 'zhongyi-platform/.local', 'apps/miniprogram/dist', 'apps/miniprogram/project.config.json']) {
    assert(!existsSync(join(destination, path)));
  }
  assert.throws(() => stageWorkspaceSource(root, destination), /new empty/);
  assert.throws(() => stageWorkspaceSource(root, join(root, 'tools')), /isolated destination/);
  const linked = join(directory, 'redirected'); symlinkSync(destination, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageWorkspaceSource(root, linked), /Linked|Redirected/);
  const target = join(destination, 'package-lock.json'); writeFileSync(target, readFileSync(target, 'utf8') + '\n');
  assert.throws(() => verifyWorkspaceSource(root, destination, manifest), /changed/);
  assert(readdirSync(directory).length >= 2); // Retain owned fixtures; never recursively delete links.
});
test('source selection refuses links inside an allowed source tree before reading their contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'food-source-link-test-'));
  const tools = join(directory, 'tools'), target = join(directory, 'private-target'); mkdirSync(tools); mkdirSync(target);
  writeFileSync(join(target, 'sensitive.json'), '{"fixtureOnly":true}', { flag: 'wx' });
  symlinkSync(target, join(tools, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => collectWorkspaceSource(directory), /Linked|Redirected/);
});
