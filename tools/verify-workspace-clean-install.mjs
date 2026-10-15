import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, sha256, stageWorkspaceSource, verifyWorkspaceSource, within } from './workspace-source.mjs';

assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--offline'), 'Only offline verification is supported');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); plain(root);
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'); plain(npmCli);
for (const part of ['.refactor', '.refactor/evidence', '.refactor/evidence/workspace-clean-install-runs']) {
  const path = join(root, part); if (!existsSync(path)) mkdirSync(path); plain(path);
}
const evidence = join(root, '.refactor/evidence/workspace-clean-install-runs', `run-${randomUUID()}`); mkdirSync(evidence);
plain(tmpdir()); const fixture = mkdtempSync(join(tmpdir(), 'food-education-ts-clean-')); plain(fixture);
// Prevent accidental resolution from an ancestor dependency directory, including the working tree.
for (let parent = dirname(fixture); ; parent = dirname(parent)) {
  assert(!existsSync(join(parent, 'node_modules')), 'Temporary directory has ancestor dependencies; refusing fallback');
  if (dirname(parent) === parent) break;
}
const report = { schemaVersion: 'workspace-clean-install.1', status: 'running', startedAt: new Date().toISOString(),
  fixture, nodeVersion: process.version, installationMode: 'offline-cache', copiedDependencyDirectory: false,
  inheritedNodePathOrOptions: false, installLifecycleScriptsEnabled: true, phase: 'staging', sourceFiles: [], steps: [], dependencyResolutions: [],
  privateCorpusCopied: false, actualWeChatConfigCopied: false, workingDatabaseCopied: false,
  sourceSnapshotUnchanged: false, remoteCiVerified: false, deploymentVerified: false, deviceVerified: false, realModelCalls: 0 };
const persist = () => writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
const cache = join(root, '.npm-cache'); assert(existsSync(cache), 'Offline cache required'); plain(cache);
for (const name of ['unused-user.npmrc', 'unused-global.npmrc']) writeFileSync(join(evidence, name), '', { flag: 'wx' });
const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'OS', 'PATHEXT', 'PROCESSOR_ARCHITECTURE',
  'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))),
  CI: 'true', AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false', EDUCATION_PUBLICATION_ENABLED: 'false',
  NODE_TLS_REJECT_UNAUTHORIZED: '1', npm_config_cache: cache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_userconfig: join(evidence, 'unused-user.npmrc'), npm_config_globalconfig: join(evidence, 'unused-global.npmrc'),
  npm_config_registry: 'https://registry.npmjs.org/' };
async function command(id, args) {
  const step = { id, startedAt: new Date().toISOString(), exitCode: null, signal: null, status: 'running' };
  report.steps.push(step); persist(); console.log(`[workspace-clean] ${id}`);
  const log = createWriteStream(join(evidence, `${id}.log`), { flags: 'wx' });
  let result;
  try {
    result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [npmCli, ...args], { cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      step.childProcessId = child.pid ?? null; persist();
      child.stdout.on('data', bytes => log.write(bytes)); child.stderr.on('data', bytes => log.write(bytes));
      child.once('error', reject); child.once('close', (exitCode, signal) => done({ exitCode, signal }));
    });
  } catch (error) {
    step.status = 'failed'; step.errorCode = typeof error?.code === 'string' ? error.code : 'SPAWN_ERROR';
    step.finishedAt = new Date().toISOString(); persist(); throw error;
  } finally { await new Promise((done, reject) => { log.once('error', reject); log.end(done); }); }
  step.exitCode = result.exitCode; step.signal = result.signal; step.finishedAt = new Date().toISOString();
  step.status = result.exitCode === 0 ? 'passed' : 'failed'; persist();
  assert.equal(result.exitCode, 0, `Stage failed: ${id}; see retained log`);
}
console.log(`[workspace-clean] evidence: ${evidence}`); console.log(`[workspace-clean] isolated source: ${fixture}`); persist();
try {
  report.sourceFiles = stageWorkspaceSource(root, fixture);
  for (const path of ['node_modules', 'zhongyi-platform/node_modules', 'zhongyi/content-private', 'zhongyi-platform/.local',
    'apps/miniprogram/project.config.json', 'apps/miniprogram/dist', 'zhongyi-platform/build', 'zhongyi-platform/dist']) {
    assert(!existsSync(join(fixture, path)), 'Unexpected private or generated installation input');
  }
  report.phase = 'installation'; persist(); await command('root-install', ['ci', '--offline', '--no-audit', '--no-fund']);
  await command('platform-install', ['--prefix', 'zhongyi-platform', 'ci', '--offline', '--no-audit', '--no-fund']);
  report.phase = 'dependency-resolution'; persist();
  for (const project of ['', 'apps/miniprogram', 'packages/catalog-core', 'zhongyi-platform']) {
    const directory = join(fixture, project), manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const require = createRequire(join(directory, 'package.json'));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      let entry;
      try { entry = require.resolve(`${name}/package.json`); } catch { entry = require.resolve(name); }
      const path = realpathSync(entry); assert(within(fixture, path), `Dependency outside fresh fixture: ${name}`);
      report.dependencyResolutions.push({ project, name, path: relative(fixture, path).replaceAll('\\', '/') });
    }
  }
  report.dependenciesResolvedInsideFixture = true; persist();
  report.phase = 'verification'; persist();
  await command('catalog', ['run', 'catalog:check']);
  await command('root-typecheck', ['run', 'typecheck']);
  await command('root-tests', ['test']);
  await command('mini-build', ['run', 'build:mini']);
  await command('platform-catalog', ['--prefix', 'zhongyi-platform', 'run', 'catalog:check']);
  await command('platform-build', ['--prefix', 'zhongyi-platform', 'run', 'build']);
  await command('compiled-api', ['--prefix', 'zhongyi-platform', 'run', 'test:request-log:runtime']);
  const proofRoot = join(fixture, 'zhongyi-platform/.local/request-log-runs'); plain(proofRoot);
  const proofs = readdirSync(proofRoot); assert.equal(proofs.length, 1);
  const proofFile = join(proofRoot, proofs[0], 'report.json'); plain(proofFile);
  const proof = JSON.parse(readFileSync(proofFile, 'utf8'));
  assert.equal(proof.status, 'passed'); assert.equal(proof.passed, 1); assert.equal(proof.failed, 0);
  assert.equal(proof.matchedApplicationRequests, 4); assert.equal(proof.fixturesStopped, true); assert.equal(proof.lifecycle.exitCode, 0);
  assert.equal(proof.sourceWorkingDatabaseModified, false); assert.equal(proof.realModelCalls, 0);
  report.compiledApiProof = { path: relative(fixture, proofFile).replaceAll('\\', '/'), sha256: sha256(readFileSync(proofFile)),
    matchedApplicationRequests: 4, fixturesStopped: true };
  report.outputs = ['apps/miniprogram/dist/app.js', 'zhongyi-platform/dist/index.html', 'zhongyi-platform/build/server/index.js'].map(path => {
    const bytes = readFileSync(join(fixture, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  report.phase = 'source-integrity'; persist();
  verifyWorkspaceSource(root, fixture, report.sourceFiles); report.sourceSnapshotUnchanged = true;
  report.status = 'passed'; report.phase = 'finished';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Verification failed'; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); persist(); console.log(JSON.stringify({ status: report.status, evidence, error: report.error ?? null })); }
