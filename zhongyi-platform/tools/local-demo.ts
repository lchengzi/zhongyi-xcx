import { resolve } from 'node:path';
import { localDemoStartArgs, prepareLocalDemo, startLocalDemo } from '../server/local-demo.js';

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === 'prepare') {
    const demo = await prepareLocalDemo(resolve('.'));
    console.log(`Prepared isolated local demo: ${demo.demoId}`);
    console.log(`Private credentials file (do not record or share): ${demo.credentialsFile}`);
    console.log(`Start: npm.cmd run demo:start -- ${demo.demoId}`);
    console.log(`Compiled start (after npm.cmd run build): npm.cmd run demo:start:compiled -- ${demo.demoId}`);
    console.log('No working database was opened. No professional review, AI calls or public education publication was enabled.');
  } else if (args[0] === 'start') {
    const { demoId, port, photos, researchManifest } = localDemoStartArgs(args);
    let requested = false; let service: Awaited<ReturnType<typeof startLocalDemo>> | undefined;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      requested = true;
      if (service) stopping ??= service.close().then(() => { console.log('Local demo stopped. Database and private credentials retained.'); }, () => {
        console.error('Local demo shutdown failed. No forced termination or deletion was attempted.'); process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      service = await startLocalDemo(resolve('.'), demoId, port, photos, researchManifest);
      console.log(`Isolated local demo: ${service.url}`);
      console.log(`Demo ID: ${demoId}. Accounts only; AI, education and photo publication disabled. Press Ctrl+C to stop; reuse the same ID to resume.`);
      if (photos) console.log('Explicit private photo previews configured. No publication journal or approval was created.');
      if (researchManifest) console.log('Explicit read-only research references configured; no candidate approval or publication capability.');
      if (requested) stop();
    } catch (error) {
      process.off('SIGINT', stop); process.off('SIGTERM', stop); throw error;
    }
  } else throw new Error('Invalid demo arguments');
} catch {
  console.error('Local demo failed. Use demo:prepare or demo:start -- DEMO_ID [--port 4314] [--photo-manifest ABSOLUTE_PATH --photo-derivatives ABSOLUTE_DIRECTORY] [--research-manifest ABSOLUTE_PATH]. Production mode is prohibited. Check the prepared files, built web page and free loopback port. No working-store fallback or secret output was attempted.');
  process.exitCode = 1;
}
