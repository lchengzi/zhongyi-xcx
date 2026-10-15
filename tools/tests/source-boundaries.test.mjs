import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function plain(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    assert(!lstatSync(current).isSymbolicLink()); assert.equal(realpathSync(current).toLowerCase(), current.toLowerCase());
    if (dirname(current) === current) break;
  }
}
test('actual Git ignores private material, credentials and generated files while retaining build sources', () => {
  const parent = join(root, '.refactor/evidence/source-boundary-runs'); plain(root);
  for (const part of ['.refactor', '.refactor/evidence', '.refactor/evidence/source-boundary-runs']) {
    const path = join(root, part); if (!existsSync(path)) mkdirSync(path); plain(path);
  }
  const directory = join(parent, `run-${randomUUID()}`); mkdirSync(directory);
  const repository = join(directory, 'fixture'), template = join(directory, 'empty-template'); mkdirSync(repository); mkdirSync(template);
  const globalConfig = join(directory, 'empty-global-config'); writeFileSync(globalConfig, '', { flag: 'wx' });
  for (const file of ['.gitignore', 'zhongyi/.gitignore', 'zhongyi-platform/.gitignore']) {
    const source = join(root, file); plain(source); mkdirSync(dirname(join(repository, file)), { recursive: true });
    writeFileSync(join(repository, file), readFileSync(source), { flag: 'wx' });
  }
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'OS', 'PATHEXT', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' };
  const git = args => spawnSync('git', args, { cwd: repository, env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  const initialized = git(['init', '--quiet', `--template=${template}`]); assert.equal(initialized.status, 0, initialized.stderr);
  const privatePaths = ['zhongyi/content-private/research-refresh/fixture.json', 'zhongyi/content-private/photos/fixture.jpg',
    'zhongyi/.local/fixture.sqlite', 'zhongyi-platform/.local/fixture.sqlite', '.env', 'zhongyi-platform/.env',
    '.npm-cache/fixture', '.refactor/evidence/fixture', 'node_modules/fixture', 'apps/miniprogram/dist/app.js',
    'apps/miniprogram/project.config.json', 'apps/miniprogram/project.private.config.json'];
  const publicPaths = ['package.json', 'package-lock.json', '.env.example', 'apps/miniprogram/src/pages/catalog/index.tsx',
    'packages/catalog-core/src/photo-client.ts', 'zhongyi/data/ingredients.js', 'zhongyi-platform/server/index.ts',
    'tools/tests/photo-research.fixture.ts', 'apps/miniprogram/project.config.example.json'];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: repository, env, windowsHide: true, encoding: 'utf8',
    input: [...privatePaths, ...publicPaths].join('\n') + '\n', timeout: 15000 });
  const ignored = result.stdout.trim().split(/\r?\n/).filter(Boolean), expected = [...privatePaths].sort();
  const report = { schemaVersion: 'source-boundary-evidence.1', status: result.status === 0 && JSON.stringify(ignored.sort()) === JSON.stringify(expected) ? 'passed' : 'failed',
    ignored, expectedIgnored: expected, expectedBuildSourcesNotIgnored: publicPaths, privateFilesCopied: 0, workingGitRepositoryModified: false,
    externalRepositoryCreated: false, pushPerformed: false, remoteCiVerified: false, finishedAt: new Date().toISOString() };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`Source boundary evidence: ${directory}`);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(ignored.sort(), expected);
});
