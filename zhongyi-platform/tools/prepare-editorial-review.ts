import { resolve } from 'node:path';
import { prepareEditorialReviewDemo, readEditorialReviewPack } from '../server/editorial-review-pack.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Exactly one private pack path required');
  const demo = await prepareEditorialReviewDemo(resolve('.'), readEditorialReviewPack(resolve(args[0]!)));
  console.log(JSON.stringify({ ...demo.report, directory: demo.directory,
    start: `npm.cmd run demo:start:compiled -- ${demo.demoId}`, workingDatabaseModified: false }));
  console.log('Independent local account details remain in credentials.json in the private demo directory; do not share or record them.');
} catch {
  console.error('Private review preparation failed. No working-store fallback, approval, publication or external AI action was performed. An interrupted isolated demo may remain; do not treat it as a completed import.');
  process.exitCode = 1;
}
