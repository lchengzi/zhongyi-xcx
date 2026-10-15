// No database or network. Parent deliberately holds module initialization so
// the real IPC child can receive cleanup BEFORE its signal handler exists.
await new Promise((ready) => {
  const message = (value) => { if (value === 'finish-loading') finish(); };
  const finish = () => { process.off('message', message); process.off('disconnect', finish); ready(); };
  process.on('message', message); process.once('disconnect', finish);
  if (process.connected) process.send({ phase: 'before-ready' }); else finish();
});
const keepAlive = setInterval(() => {}, 1000);
process.once('SIGTERM', () => {
  clearInterval(keepAlive);
  if (process.connected) process.send({ phase: 'graceful-stop' });
});
if (process.connected) process.send({ phase: 'ready' });
