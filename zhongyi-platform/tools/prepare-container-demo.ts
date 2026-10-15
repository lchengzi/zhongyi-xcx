import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoLinks, prepareDemoSecrets } from '../server/demo-secrets.js';

try {
  if (process.argv.length !== 2) throw new Error('No arguments accepted');
  const parent = resolve('.local/container-demo');
  assertNoLinks(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  // Only the path is printed. Existing setups are never replaced.
  console.log(prepareDemoSecrets(parent));
} catch {
  console.error('Demo secret preparation failed; no existing setup is overwritten. Inspect permissions and retain any partial new setup.');
  process.exitCode = 1;
}
