import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { LocalDemoPhotoOptions } from '../server/local-demo.js';

export async function launchDemoCli(root: string, demoId: string, port: number, runtime: 'source' | 'compiled' = 'source', photos?: LocalDemoPhotoOptions, researchManifest?: string) {
  if (!['source', 'compiled'].includes(runtime)) throw new Error('Fixed demo CLI runtime required');
  const entry = runtime === 'source' ? ['./fixtures/local-demo-application.mjs', ['--import', import.meta.resolve('tsx')]] as const :
    ['./fixtures/compiled-demo-cli-application.mjs', []] as const;
  const child = spawn(process.execPath, [...entry[1], fileURLToPath(new URL(entry[0], import.meta.url)), demoId, '--port', String(port),
    ...(photos ? ['--photo-manifest', photos.manifest, '--photo-derivatives', photos.derivatives] : []), ...(researchManifest ? ['--research-manifest', researchManifest] : [])],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // These two descriptors are guaranteed pipes by the fixed spawn options;
  // Node's generic four-entry IPC overload otherwise types them as nullable.
  const outputStream = child.stdout!; const errorStream = child.stderr!;
  let stdout = ''; let stderr = '';
  outputStream.on('data', (value) => { stdout += value; });
  errorStream.on('data', (value) => { stderr += value; });
  const ended = once(child, 'exit');
  const outputEnded = Promise.all([once(outputStream, 'end'), once(errorStream, 'end')]);
  const ready = new Promise<void>((done, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exited); child.off('error', failed); };
    const message = (value: unknown) => { if (value && typeof value === 'object' && 'phase' in value && value.phase === 'loaded') { cleanup(); done(); } };
    const exited = () => { cleanup(); reject(new Error('Owned demo CLI exited before loading')); };
    const failed = () => { cleanup(); reject(new Error('Owned demo CLI could not spawn')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Owned demo CLI readiness observation expired; cleanup still waits for its actual exit')); }, 30000);
    child.on('message', message); child.once('exit', exited); child.once('error', failed);
  });
  let stopping: Promise<void> | undefined;
  const close = () => stopping ??= (async () => {
    if (child.connected) child.send('test-stop');
    const [code, signal] = await ended;
    await outputEnded;
    if (code !== 0 || signal !== null) throw new Error(`Owned demo CLI did not exit gracefully (exit ${code}, signal ${signal})`);
  })();
  try {
    await ready;
    const response = await fetch(`http://127.0.0.1:${port}/api/ready`);
    if (response.status !== 200 || ((await response.json()) as { ok: boolean }).ok !== true) throw new Error('Actual demo CLI is not SQL-ready');
    return { url: `http://127.0.0.1:${port}`, close, output: () => ({ stdout, stderr }) };
  } catch (error) { await close(); throw error; }
}

export const launchCompiledDemoCli = (root: string, demoId: string, port: number) => launchDemoCli(root, demoId, port, 'compiled');
