import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

// Test-only launcher. Queue cleanup until the real application's module has
// installed its graceful signal handlers, including after a slow startup.
// No HTTP shutdown route, arbitrary module path, kill or production hook.
export function fixtureApplicationWrapper(mode: 'server' | 'container' | 'delayed-unit'): string {
  const entries = { server: './build/server/index.js', container: './build/tools/container-entrypoint.js', 'delayed-unit': './tests/fixtures/delayed-application.mjs' };
  if (!Object.hasOwn(entries, mode)) throw new Error('Unknown owned fixture application');
  return `${mode === 'container' ? "process.argv=[process.argv[0],'container-entrypoint','server'];" : ''}
let loaded=false, requested=false, stopped=false;
function drain(){
  if(!loaded||!requested||stopped)return;
  stopped=true;
  process.emit('SIGTERM');
  if(process.connected)process.disconnect();
}
process.on('message',message=>{if(message===${JSON.stringify(mode === 'container' ? 'stop' : 'test-stop')}){requested=true;drain();}});
process.on('disconnect',()=>{requested=true;drain();});
try{await import(${JSON.stringify(entries[mode])});}finally{loaded=true;drain();}
`;
}
// Register immediately after spawn. Observe the process itself and drain both
// captured logs before assertions; do not depend on aggregate IPC close timing.
// This observer neither requests shutdown nor converts a timeout into success.
export async function fixtureApplicationCompletion(child: ChildProcess): Promise<[number | null, NodeJS.Signals | null]> {
  const [result] = await Promise.all([
    once(child, 'exit'),
    ...[child.stdout, child.stderr].map((stream) => stream ? finished(stream, { cleanup: true }) : Promise.resolve())
  ]);
  return result as [number | null, NodeJS.Signals | null];
}
