import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { assertNoLinks } from '../server/demo-secrets.js';
import { ciEnvironment } from '../tools/ci-core.js';
import { fixtureApplicationCompletion, fixtureApplicationWrapper } from '../tools/fixture-application.js';
import { validateSeed } from '../server/seed.js';

// Test-only launcher: real compiled server, no tsx, alternate app implementation,
// shutdown HTTP endpoint, inherited database credentials or external AI switches.
export async function launchCompiledDemo(root: string, demoId: string, port: number) {
  if (!isAbsolute(root) || !/^demo-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(demoId) ||
    !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Owned compiled demo arguments required');
  const directory = resolve(root, '.local', 'local-demo', demoId);
  const database = join(directory, 'editorial.sqlite');
  for (const path of [root, directory, database, join(directory, 'demo.json'), join(root, 'build/server/index.js'), join(root, 'dist/index.html')]) {
    assertNoLinks(path);
    if (!existsSync(path)) throw new Error('Prepare an isolated demo and build the application first');
  }
  const json = (path: string, maximum: number) => {
    assertNoLinks(path); const stat = lstatSync(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > maximum) throw new Error('Ordinary bounded demo file required');
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  const manifest = json(join(directory, 'demo.json'), 4096);
  const copied = validateSeed(json(join(directory, 'catalog.seed.json'), 2 * 1024 * 1024));
  const current = validateSeed(json(join(root, 'data/catalog.seed.json'), 2 * 1024 * 1024));
  if (manifest.schemaVersion !== 1 || manifest.purpose !== 'isolated_local_editorial_demo' || manifest.demoId !== demoId ||
    manifest.catalogDigest !== copied.digest || manifest.releaseId !== copied.releaseId || copied.digest !== current.digest || copied.releaseId !== current.releaseId) {
    throw new Error('Compiled server requires the same owned demo and project catalog; no reseeding is permitted');
  }
  if (!lstatSync(database).isFile()) throw new Error('Owned demo database required');
  const inspection = new DatabaseSync(database, { readOnly: true });
  try {
    if (inspection.prepare('SELECT value FROM metadata WHERE key = ?').get('localDemoId')?.value !== demoId) throw new Error('Wrong demo database ownership');
  } finally { inspection.close(); }
  const url = `http://127.0.0.1:${port}`;
  const env = { ...ciEnvironment(process.env, database), NODE_OPTIONS: undefined, NODE_PATH: undefined,
    PORT: String(port), BIND_HOST: '127.0.0.1', ALLOWED_ORIGINS: url };
  const child = spawn(process.execPath, ['--input-type=module', '--eval', fixtureApplicationWrapper('server')], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  // Drain pipes immediately, including before readiness and after shutdown.
  child.stdout!.on('data', () => {}); child.stderr!.on('data', () => {});
  const ended = fixtureApplicationCompletion(child);
  let stopping: Promise<void> | undefined;
  const close = () => stopping ??= (async () => {
    if (child.connected && child.exitCode === null && child.signalCode === null) child.send('test-stop');
    const [code, signal] = await ended;
    if (code !== 0 || signal !== null) throw new Error('Owned compiled demo did not exit normally');
  })();
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Compiled demo exited before readiness');
      try {
        const response = await fetch(`${url}/api/ready`, { signal: AbortSignal.timeout(1000) });
        const body = await response.json() as { ok?: boolean };
        if (response.status === 200 && body.ok === true) return { url, close };
      } catch { /* Observe the same owned process; never restart on a timeout. */ }
      await delay(100);
    }
    throw new Error('Compiled demo readiness observation expired');
  } catch (error) { await close(); throw error; }
}
