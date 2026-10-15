import { waitForOwnedPostgresRestart } from '../tools/postgres-restart.js';

export async function restartPostgres(): Promise<void> {
  if (!process.send || !process.env.PG_TEST_NONCE) throw new Error('A verified live test-server controller is required for restart proof');
  await waitForOwnedPostgresRestart({
    connected: () => process.connected,
    subscribe: (message, disconnect) => {
      process.on('message', message); process.on('disconnect', disconnect);
      return () => { process.off('message', message); process.off('disconnect', disconnect); };
    },
    send: (request, failed) => { process.send!(request, failed); }
  }, process.env.PG_TEST_NONCE);
}
