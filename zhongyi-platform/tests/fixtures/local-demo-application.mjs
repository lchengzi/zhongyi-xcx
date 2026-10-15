// Fixed test-only entrypoint for the actual demo CLI. No arbitrary import path,
// HTTP shutdown, forced kill or database cleanup is exposed by the application.
process.argv = [process.argv[0], 'local-demo', 'start', ...process.argv.slice(2)];
let loaded = false, requested = false, stopped = false;
function drain() {
  if (!loaded || !requested || stopped) return;
  stopped = true; process.emit('SIGTERM');
  if (process.connected) process.disconnect();
}
process.on('message', (message) => { if (message === 'test-stop') { requested = true; drain(); } });
process.on('disconnect', () => { requested = true; drain(); });
try { await import('../../tools/local-demo.ts'); }
finally { loaded = true; if (process.connected) process.send({ phase: 'loaded' }); drain(); }
