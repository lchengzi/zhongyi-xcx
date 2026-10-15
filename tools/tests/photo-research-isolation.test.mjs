import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function plain(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    assert(!lstatSync(current).isSymbolicLink(), 'Linked isolation path');
    assert.equal(realpathSync(current).toLowerCase(), current.toLowerCase(), 'Redirected isolation path');
    if (dirname(current) === current) break;
  }
}

test('default photo research tests run with no private corpus in a source-only fixture', () => {
  plain(root);
  const parent = join(root, '.refactor/evidence/research-isolation-runs');
  for (const part of ['.refactor', '.refactor/evidence', '.refactor/evidence/research-isolation-runs']) {
    const path = join(root, part); if (!existsSync(path)) mkdirSync(path); plain(path);
  }
  const directory = join(parent, `run-${randomUUID()}`), staged = join(directory, 'workspace');
  mkdirSync(directory); mkdirSync(staged);
  const sourceFiles = ['package.json', 'tsconfig.base.json', 'tsconfig.research.json', 'apps/miniprogram/tsconfig.json',
    'tools/research/photo-leads.ts', 'tools/research/check-photo-leads.ts', 'tools/tests/photo-research.test.ts',
    ...['tools/tests/photo-research.fixture.ts', 'tools/tests/photo-research-local.test.ts'].filter(file => existsSync(join(root, file)))];
  const inputs = sourceFiles.map(file => {
    const source = join(root, file), destination = join(staged, file); plain(source);
    const bytes = readFileSync(source); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
    return { path: file, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'OS', 'PATHEXT', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--test', 'tools/tests/photo-research.test.ts'], {
    cwd: staged, env: { ...env, AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false' }, encoding: 'utf8', timeout: 60000,
    maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  writeFileSync(join(directory, 'test.log'), result.stdout + result.stderr, { flag: 'wx' });
  const privateTreeAbsent = !existsSync(join(staged, 'zhongyi/content-private'));
  const report = { schemaVersion: 'photo-research-isolation-evidence.1', status: result.status === 0 && privateTreeAbsent ? 'passed' : 'failed',
    exitCode: result.status, signal: result.signal, privateTreeAbsent, sourceFiles: inputs, privateSourceFilesCopied: 0,
    dependencyDirectoryCopied: false, workingDependenciesUsedForThisUnitBoundaryCheck: true, cleanInstallVerified: false,
    remoteCiVerified: false, realModelCalls: 0, finishedAt: new Date().toISOString() };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`Research isolation evidence: ${directory}`);
  assert.equal(result.status, 0, `Default tests require excluded private data or another unavailable input. Inspect ${join(directory, 'test.log')}`);
  assert(privateTreeAbsent);
  for (const input of inputs) assert.equal(createHash('sha256').update(readFileSync(join(root, input.path))).digest('hex'), input.sha256, 'Working source changed during the check');
});
