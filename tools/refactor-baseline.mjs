import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This archive intentionally excludes private research, credentials, databases,
// dependencies and generated output. The legacy projects remain in place.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveParent = path.join(workspace, '.refactor', 'baselines');
const sourcePolicy = {
  zhongyi: {
    directories: ['assets', 'components', 'config', 'data', 'docs', 'pages', 'subpackages', 'tools', 'utils'],
    files: ['.gitignore', 'app.js', 'app.json', 'app.wxss', 'package.json', 'README.md', 'sitemap.json'],
    fingerprints: ['project.config.json', 'project.private.config.json'],
  },
  'zhongyi-platform': {
    directories: ['data', 'docs', 'server', 'shared', 'tests', 'tools', 'web'],
    files: ['.dockerignore', '.env.example', '.gitignore', 'Dockerfile', 'README.md', 'index.html',
      'package.json', 'package-lock.json', 'playwright.config.ts', 'vite.config.ts',
      'compose.yaml', 'compose.backup.yaml', 'compose.https.yaml', 'compose.restricted.yaml',
      'tsconfig.json', 'tsconfig.server.json', 'tsconfig.https-tests.json',
      'tsconfig.local-demo-tests.json', 'tsconfig.publication-tests.json',
      'tsconfig.request-log-tests.json', 'tsconfig.web-tests.json'],
    fingerprints: [],
  },
};
const omittedDirectories = new Set(['node_modules', '.local', '.git', '.refactor',
  'content-private', 'build', 'dist', 'coverage', 'test-results', 'playwright-report',
  'secrets', 'credentials', 'backups']);
const sourceExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json',
  '.wxml', '.wxss', '.css', '.scss', '.sass', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.ico', '.gif', '.md', '.yaml', '.yml', '.html', '.sql', '.txt',
  '.sh', '.ps1', '.bat', '.cmd']);
const exclusions = [
  'content-private and private research remain in the legacy project; not archived',
  '.local, working databases, database journals and backups; not archived',
  'node_modules, build, dist, caches and generated test reports; not archived',
  'actual .env files, keys, certificates and credential directories; not archived',
  'WeChat project.config.json and project.private.config.json are hash-only',
  'files outside the explicit source-directory/root-file allowlist; not archived',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (value) => value.split(path.sep).join('/');

function within(base, target) {
  const relative = path.relative(base, target);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path is not strictly within its expected directory');
  }
  return target;
}

function relativePath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes(':') || value.includes('\0')
    || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid relative archive path');
  }
  return value;
}

async function checked(target, kind) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error('Links are not supported');
  if ((kind === 'directory' && !stat.isDirectory()) || (kind === 'file' && !stat.isFile())) {
    throw new Error(`Expected ${kind}`);
  }
  const resolved = await realpath(target);
  if (path.resolve(resolved).toLowerCase() !== path.resolve(target).toLowerCase()) {
    throw new Error('Resolved path differs from expected path');
  }
  return stat;
}

async function exists(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function ensureDirectory(target) {
  within(workspace, target);
  await checked(path.dirname(target), 'directory');
  if (!(await exists(target))) await mkdir(target);
  await checked(target, 'directory');
}

function omittedFile(name) {
  const lower = name.toLowerCase();
  return (lower.startsWith('.env') && lower !== '.env.example')
    || lower === 'project.config.json' || lower === 'project.private.config.json'
    || /\.(sqlite|sqlite3|db|pem|key|pfx|p12|crt|cer)(-(wal|shm|journal))?$/.test(lower)
    || (/\.(json|ya?ml|txt)$/.test(lower)
      && /(^|[._-])(credentials|credential|secrets|tokens)([._-]|$)/.test(lower));
}

async function inventory() {
  const files = [];
  const fingerprintOnly = [];
  for (const [project, policy] of Object.entries(sourcePolicy)) {
    const projectRoot = within(workspace, path.join(workspace, project));
    await checked(projectRoot, 'directory');
    const include = async (source) => {
      await checked(source, 'file');
      const bytes = await readFile(source);
      files.push({ path: slash(path.relative(workspace, source)), size: bytes.length, sha256: sha256(bytes) });
    };
    const walk = async (directory) => {
      await checked(directory, 'directory');
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const source = within(projectRoot, path.join(directory, entry.name));
        // Check before exclusions: never traverse or silently accept a linked input.
        const stat = await lstat(source);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error('Linked source input');
        if (stat.isDirectory()) {
          if (!omittedDirectories.has(entry.name)) await walk(source);
        } else if (stat.isFile()) {
          if (!omittedFile(entry.name) && sourceExtensions.has(path.extname(entry.name).toLowerCase())) await include(source);
        } else throw new Error('Unsupported source filesystem entry');
      }
    };
    for (const directory of policy.directories) await walk(path.join(projectRoot, directory));
    for (const name of policy.files) await include(path.join(projectRoot, name));
    for (const name of policy.fingerprints) {
      const source = path.join(projectRoot, name);
      await checked(source, 'file');
      const bytes = await readFile(source);
      fingerprintOnly.push({ path: `${project}/${name}`, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, fingerprintOnly };
}

function archiveLocation(id) {
  if (!/^baseline-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid baseline ID');
  return within(archiveParent, path.join(archiveParent, id));
}

async function verify(id, compareSource) {
  const directory = archiveLocation(id);
  await checked(path.join(workspace, '.refactor'), 'directory');
  await checked(archiveParent, 'directory');
  await checked(directory, 'directory');
  const manifestPath = path.join(directory, 'manifest.json');
  await checked(manifestPath, 'file');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.baselineId !== id || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.fingerprintOnly)) throw new Error('Invalid manifest');
  const snapshotRoot = path.join(directory, 'snapshot');
  await checked(snapshotRoot, 'directory');
  const expected = new Map();
  for (const entry of manifest.files) {
    relativePath(entry.path);
    if (expected.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Invalid or duplicate manifest file');
    }
    if (!Object.keys(sourcePolicy).some((project) => entry.path.startsWith(`${project}/`))) throw new Error('Unexpected manifest project');
    expected.set(entry.path, entry);
  }
  let totalBytes = 0;
  let count = 0;
  const walk = async (folder) => {
    await checked(folder, 'directory');
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const target = within(snapshotRoot, path.join(folder, entry.name));
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error('Linked archive input');
      if (stat.isDirectory()) await walk(target);
      else {
        await checked(target, 'file');
        const relative = slash(path.relative(snapshotRoot, target));
        const expectedFile = expected.get(relative);
        if (!expectedFile) throw new Error('Archive includes an unlisted file');
        const bytes = await readFile(target);
        if (bytes.length !== expectedFile.size || sha256(bytes) !== expectedFile.sha256) throw new Error('Archive file mismatch');
        expected.delete(relative);
        count += 1;
        totalBytes += bytes.length;
      }
    }
  };
  await walk(snapshotRoot);
  if (expected.size) throw new Error('Archive is missing listed files');
  if (compareSource) {
    const current = await inventory();
    if (JSON.stringify(current.files) !== JSON.stringify(manifest.files)
      || JSON.stringify(current.fingerprintOnly) !== JSON.stringify(manifest.fingerprintOnly)) {
      throw new Error('Current legacy source or private configuration differs from baseline');
    }
  }
  return { baselineId: id, archiveFiles: count, archiveBytes: totalBytes,
    archiveVerified: true, currentLegacySourcesVerified: compareSource,
    privateConfigContentsArchived: false, databaseBackup: false };
}

async function create() {
  await checked(workspace, 'directory');
  const captured = await inventory();
  await ensureDirectory(path.join(workspace, '.refactor'));
  await ensureDirectory(archiveParent);
  const id = `baseline-${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID()}`;
  const directory = archiveLocation(id);
  await mkdir(directory); // No recursive flag and no reuse: existing output must fail.
  const statusPath = path.join(directory, 'status.json');
  const startedAt = new Date().toISOString();
  await writeFile(statusPath, `${JSON.stringify({ status: 'creating', startedAt }, null, 2)}\n`, { flag: 'wx' });
  try {
    const snapshotRoot = path.join(directory, 'snapshot');
    await mkdir(snapshotRoot);
    for (const entry of captured.files) {
      const source = within(workspace, path.join(workspace, relativePath(entry.path)));
      await checked(source, 'file');
      const destination = within(snapshotRoot, path.join(snapshotRoot, entry.path));
      const parts = path.relative(snapshotRoot, path.dirname(destination)).split(path.sep).filter(Boolean);
      let parent = snapshotRoot;
      for (const part of parts) { parent = within(snapshotRoot, path.join(parent, part)); await ensureDirectory(parent); }
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    }
    const manifest = { schemaVersion: 1, baselineId: id, capturedAt: startedAt,
      purpose: 'Recoverable legacy source inputs before the TypeScript workspace refactor',
      sourcePolicy, exclusions, ...captured };
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    const result = await verify(id, true);
    await writeFile(path.join(directory, 'verification.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { flag: 'wx' });
    await checked(statusPath, 'file');
    await writeFile(statusPath, `${JSON.stringify({ status: 'verified', startedAt, completedAt: new Date().toISOString() }, null, 2)}\n`);
    return result;
  } catch (error) {
    await checked(statusPath, 'file');
    await writeFile(statusPath, `${JSON.stringify({ status: 'failed', startedAt, failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown failure', retainedForInspection: true }, null, 2)}\n`);
    throw error;
  }
}

try {
  const [command, id, option, ...remaining] = process.argv.slice(2);
  if (remaining.length || (command !== 'create' && command !== 'verify')
    || (command === 'create' && id !== undefined)
    || (command === 'verify' && (!id || (option !== undefined && option !== '--source')))) {
    throw new Error('Usage: node tools/refactor-baseline.mjs create | verify <baseline-id> [--source]');
  }
  await checked(workspace, 'directory');
  const result = command === 'create' ? await create() : await verify(id, option === '--source');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Baseline failed: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
  process.exitCode = 1;
}
