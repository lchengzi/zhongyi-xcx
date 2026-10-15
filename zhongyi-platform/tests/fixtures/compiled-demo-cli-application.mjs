// Fixed test-only observer for the actual compiled manual CLI. The application
// itself has no IPC/HTTP shutdown API and is stopped with its normal SIGTERM.
process.argv = [process.argv[0], 'local-demo', 'start', ...process.argv.slice(2)];
let loaded = false, requested = false, stopped = false;
function drain() {
  if (!loaded || !requested || stopped) return;
  stopped = true; process.emit('SIGTERM');
  if (process.connected) process.disconnect();
}
process.on('message', (message) => { if (message === 'test-stop') { requested = true; drain(); } });
process.on('disconnect', () => { requested = true; drain(); });
try { await import('../../build/tools/local-demo.js'); }
finally { loaded = true; if (process.connected) process.send({ phase: 'loaded' }); drain(); }
