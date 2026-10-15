import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Never reinstall into the working project. Only a fresh, retained fixture is writable.
const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = dirname(platformRoot);
const offline = process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--offline');
assert(offline || (process.argv.length === 3 && process.argv[2] === '--online'), 'Use --offline or --online only.');
const runId = `clean-${randomUUID()}`;
const runRoot = join(platformRoot, '.local', 'clean-install-runs', runId);
const stagedPlatform = join(runRoot, 'zhongyi-platform');
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  schemaVersion: 1, runId, startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  installationMode: offline ? 'offline_cache' : 'registry',
  existingDependencyDirectoryCopied: false, installLifecycleScriptsEnabled: true,
  sourceFiles: [], steps: [], dependencyResolutions: [], outputs: [], sourceSnapshotUnchanged: false,
  workingDependencyDirectoryModified: false, workingDatabaseModified: false,
  remoteCiVerified: false, deploymentVerified: false, deviceAcceptanceVerified: false, realModelCalls: 0,
  phase: 'staging'
};

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}
function assertPlainPath(path) {
  let current = resolve(path);
  while (true) {
    assert(!lstatSync(current).isSymbolicLink(), 'Linked verification input or destination refused.');
    assert.equal(realpathSync(current).toLowerCase(), current.toLowerCase(), 'Redirected verification path refused.');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function persist() { writeFileSync(join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
function copyInput(source, destination) {
  assert(inside(workspaceRoot, source) && inside(runRoot, destination));
  const stat = lstatSync(source);
  assert(!stat.isSymbolicLink(), 'Linked source refused.');
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) copyInput(join(source, entry), join(destination, entry));
  } else {
    assert(stat.isFile(), 'Only regular source files may enter the fixture.');
    const bytes = readFileSync(source);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
    report.sourceFiles.push({ path: relative(workspaceRoot, source).replaceAll('\\', '/'), sha256: sha(bytes) });
  }
}
function environment() {
  // Do not inherit server credentials, NODE_PATH, NODE_OPTIONS or npm user config.
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'OS', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  return { ...env, CI: 'true', AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false',
    EDUCATION_PUBLICATION_ENABLED: 'false', NODE_TLS_REJECT_UNAUTHORIZED: '1',
    npm_config_cache: join(workspaceRoot, '.npm-cache'),
    npm_config_userconfig: join(runRoot, 'unused-user.npmrc'),
    npm_config_globalconfig: join(runRoot, 'unused-global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_offline: String(offline), npm_config_audit: 'false', npm_config_fund: 'false' };
}
async function command(id, args) {
  const item = { id, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, status: 'running' };
  report.steps.push(item); persist(); console.log(`[clean-install] ${id}`);
  const log = createWriteStream(join(runRoot, `${id}.log`), { flags: 'wx' });
  let code;
  try {
    code = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [npmCli, ...args], { cwd: stagedPlatform, env: environment(), windowsHide: true, shell: false });
      child.stdout.on('data', bytes => { log.write(bytes); process.stdout.write(bytes); });
      child.stderr.on('data', bytes => { log.write(bytes); process.stderr.write(bytes); });
      child.once('error', reject); child.once('close', done);
    });
  } finally { await new Promise((done, reject) => { log.once('error', reject); log.end(done); }); }
  item.exitCode = code; item.finishedAt = new Date().toISOString(); item.status = code === 0 ? 'passed' : 'failed'; persist();
  assert.equal(code, 0, `Clean verification stage failed: ${id}. See the retained stage log.`);
}

assertPlainPath(platformRoot);
assert(existsSync(npmCli), 'The current Node installation must include npm.');
for (const name of ['.local', 'clean-install-runs']) {
  const parent = name === '.local' ? platformRoot : join(platformRoot, '.local');
  const directory = join(parent, name);
  if (!existsSync(directory)) mkdirSync(directory);
  assertPlainPath(directory);
}
assert(!existsSync(runRoot)); mkdirSync(runRoot); persist();
console.log(`[clean-install] retained evidence: ${join(runRoot, 'report.json')}`);
try {
  // Explicit source-only list: no .env, working DB, node_modules, build, dist, private tool config or media.
  const platformInputs = ['server', 'shared', 'tools', 'tests', 'web', 'package.json', 'package-lock.json',
    'index.html', 'vite.config.ts', 'playwright.config.ts', 'data/catalog.seed.json',
    ...readdirSync(platformRoot).filter(name => /^tsconfig(?:\.[a-z-]+)?\.json$/.test(name))];
  for (const name of platformInputs) copyInput(join(platformRoot, name), join(stagedPlatform, name));
  // Catalog verification reads the frozen native release; it does not run native or private-content tests.
  assertPlainPath(join(workspaceRoot, 'zhongyi'));
  for (const name of ['data', 'utils', 'tools']) copyInput(join(workspaceRoot, 'zhongyi', name), join(runRoot, 'zhongyi', name));
  report.sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
  assert(!existsSync(join(stagedPlatform, 'node_modules')), 'Dependency directory must be absent before npm ci.');
  report.dependencyDirectoryAbsentBeforeInstall = true; persist();
  report.phase = 'installation';
  await command('install', ['ci', ...(offline ? ['--offline'] : []), '--no-audit', '--no-fund']);
  const manifest = JSON.parse(readFileSync(join(stagedPlatform, 'package.json'), 'utf8'));
  const require = createRequire(join(stagedPlatform, 'package.json'));
  const modules = realpathSync(join(stagedPlatform, 'node_modules'));
  assertPlainPath(modules);
  report.phase = 'dependency_resolution';
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    // Declaration-only packages intentionally have no executable entry point.
    const file = realpathSync(require.resolve(name.startsWith('@types/') ? `${name}/package.json` : name));
    assert(inside(modules, file), `Dependency escaped the fresh installation: ${name}`);
    report.dependencyResolutions.push({ name, path: relative(stagedPlatform, file).replaceAll('\\', '/') });
  }
  report.dependenciesResolvedInsideFixture = true; persist();
  report.phase = 'catalog';
  await command('catalog', ['run', 'catalog:check']);
  report.phase = 'build';
  await command('build', ['run', 'build']);
  for (const name of ['dist/index.html', 'build/server/index.js']) {
    const bytes = readFileSync(join(stagedPlatform, name));
    report.outputs.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
  }
  report.phase = 'compiled_api';
  await command('compiled-api', ['run', 'test:request-log:runtime']);
  const proofRoot = join(stagedPlatform, '.local', 'request-log-runs');
  assertPlainPath(proofRoot);
  const proofs = readdirSync(proofRoot);
  assert.equal(proofs.length, 1, 'One fresh compiled API fixture report is required.');
  const proofPath = join(proofRoot, proofs[0], 'report.json');
  assertPlainPath(proofPath);
  const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
  assert.equal(proof.status, 'passed'); assert.equal(proof.passed, 1); assert.equal(proof.failed, 0);
  assert.equal(proof.fixturesStopped, true); assert.equal(proof.lifecycle.exitCode, 0);
  assert.equal(proof.sourceWorkingDatabaseModified, false); assert.equal(proof.realModelCalls, 0);
  assert.equal(proof.matchedApplicationRequests, 4);
  report.compiledApiProof = { path: relative(runRoot, proofPath).replaceAll('\\', '/'), sha256: sha(readFileSync(proofPath)),
    passed: proof.passed, matchedApplicationRequests: proof.matchedApplicationRequests, fixturesStopped: true };
  report.phase = 'source_integrity';
  for (const file of report.sourceFiles) {
    assert.equal(sha(readFileSync(join(workspaceRoot, file.path))), file.sha256, 'Source changed during verification.');
    assert.equal(sha(readFileSync(join(runRoot, file.path))), file.sha256, 'Staged source or lockfile was rewritten.');
  }
  report.sourceSnapshotUnchanged = true; report.status = 'passed'; report.phase = 'finished';
} catch {
  report.status = 'failed';
  report.error = 'Installation, local dependency resolution, catalog verification, build, compiled API or source integrity failed. Inspect stage logs; no fallback to working dependencies is allowed.';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); persist();
  console.log(JSON.stringify({ status: report.status, report: join(runRoot, 'report.json') }));
}
