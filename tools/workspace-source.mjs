import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Explicit product-source roots. Never use a recursive copy of the workspace.
const trees = ['.github/workflows', 'docs', 'tools',
  'apps/miniprogram/src', 'apps/miniprogram/config', 'apps/miniprogram/assets', 'apps/miniprogram/tests',
  'packages/catalog-core/src', 'packages/catalog-core/tests', 'packages/catalog-core/tools',
  'zhongyi-platform/server', 'zhongyi-platform/shared', 'zhongyi-platform/photo-processing',
  'zhongyi-platform/web', 'zhongyi-platform/tests', 'zhongyi-platform/tools', 'zhongyi-platform/data', 'zhongyi-platform/docs',
  ...['assets', 'components', 'config', 'data', 'docs', 'pages', 'subpackages', 'tools', 'utils'].map(name => `zhongyi/${name}`)];
const files = ['.gitattributes', '.gitignore', 'package.json', 'package-lock.json', 'README.md',
  'tsconfig.base.json', 'tsconfig.research.json',
  'apps/miniprogram/package.json', 'apps/miniprogram/babel.config.cjs', 'apps/miniprogram/tsconfig.json', 'apps/miniprogram/tsconfig.visual.json',
  'apps/miniprogram/project.config.example.json',
  'packages/catalog-core/package.json', 'packages/catalog-core/tsconfig.json', 'packages/catalog-core/tsconfig.tests.json',
  ...['.gitignore', 'app.js', 'app.json', 'app.wxss', 'package.json', 'README.md', 'sitemap.json'].map(name => `zhongyi/${name}`)];
const omitted = new Set(['node_modules', '.git', '.local', '.refactor', '.npm-cache', 'content-private',
  'dist', 'build', '.verification-builds', '.swc', '.taro', 'coverage', 'test-results', 'playwright-report',
  'credentials', 'secrets', 'backups']);
const extensions = new Set(['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.wxml', '.wxss',
  '.css', '.scss', '.sass', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif', '.md', '.yaml', '.yml',
  '.html', '.sql', '.txt', '.sh', '.ps1', '.bat', '.cmd']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function within(base, target) {
  const value = relative(resolve(base), resolve(target));
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
export function plain(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = lstatSync(current);
    assert(!stat.isSymbolicLink(), 'Linked source or destination refused');
    assert.equal(realpathSync(current).toLowerCase(), current.toLowerCase(), 'Redirected path refused');
    if (stat.isFile()) assert.equal(stat.nlink, 1, 'Hard-linked source refused');
    if (dirname(current) === current) break;
  }
}
export function isPrivateSourcePath(value) {
  const parts = value.replaceAll('\\', '/').toLowerCase().split('/'), name = parts.at(-1);
  return parts.some(part => omitted.has(part)) || (name.startsWith('.env') && name !== '.env.example')
    || name === '.npmrc' || name === 'project.config.json' || name === 'project.private.config.json'
    || /\.(sqlite|sqlite3|db|pem|key|pfx|p12|crt|cer|zfbackup|zip)(-(wal|shm|journal))?$/.test(name)
    || (/\.(json|ya?ml|txt)$/.test(name) && /(^|[._-])(credentials?|secrets?|tokens?)([._-]|$)/.test(name));
}
export function collectWorkspaceSource(root) {
  root = resolve(root); plain(root); const result = [];
  function walk(path) {
    assert(within(root, path));
    const rel = relative(root, path).replaceAll('\\', '/');
    if (isPrivateSourcePath(rel)) return;
    plain(path); const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else {
      assert(stat.isFile(), 'Nonregular source refused');
      if (!extensions.has(extname(path).toLowerCase()) && !['.gitignore', '.gitattributes', '.dockerignore', '.env.example', 'Dockerfile', 'Dockerfile.dockerignore'].includes(dirname(path) === root ? rel : rel.split('/').at(-1))) return;
      const bytes = readFileSync(path); result.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  for (const path of trees) { const input = join(root, path); if (existsSync(input)) walk(input); }
  const platform = join(root, 'zhongyi-platform'); plain(platform);
  for (const name of readdirSync(platform)) {
    if (/^tsconfig(?:\.[a-z-]+)?\.json$/.test(name)
      || ['.dockerignore', '.env.example', '.gitignore', 'Dockerfile', 'Dockerfile.dockerignore', 'README.md', 'index.html',
        'package.json', 'package-lock.json', 'playwright.config.ts', 'vite.config.ts'].includes(name)
      || /^compose(?:\.[a-z-]+)?\.ya?ml$/.test(name)) walk(join(platform, name));
  }
  for (const path of files) walk(join(root, path));
  result.sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(new Set(result.map(file => file.path)).size, result.length, 'Duplicate source');
  return result;
}
export function stageWorkspaceSource(root, destination) {
  root = resolve(root); destination = resolve(destination); plain(root); plain(destination);
  assert(!within(root, destination) && root !== destination, 'Use an isolated destination outside the working workspace');
  assert(lstatSync(destination).isDirectory() && readdirSync(destination).length === 0, 'Destination must be a new empty directory');
  const manifest = collectWorkspaceSource(root);
  for (const file of manifest) {
    assert(!isPrivateSourcePath(file.path));
    const source = join(root, file.path), target = join(destination, file.path); plain(source);
    const bytes = readFileSync(source); assert.equal(sha256(bytes), file.sha256, 'Source changed during copy');
    mkdirSync(dirname(target), { recursive: true }); plain(dirname(target));
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  verifyWorkspaceSource(root, destination, manifest); return manifest;
}
export function verifyWorkspaceSource(root, destination, manifest) {
  for (const file of manifest) {
    assert(!isPrivateSourcePath(file.path) && within(root, join(root, file.path)) && within(destination, join(destination, file.path)));
    for (const base of [root, destination]) {
      const path = join(base, file.path); plain(path);
      assert.equal(sha256(readFileSync(path)), file.sha256, 'Source or lockfile changed during verification');
    }
  }
}
