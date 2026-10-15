import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { projectIngredient, seedDigest, validateSeed } from '../server/seed.js';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Only --check is supported; no source/output override.');
const projectRoot = process.cwd();
const miniRoot = resolve(projectRoot, '../zhongyi');
const { verifyWorkspace } = require(resolve(miniRoot, 'tools/version-core.js'));
const verified = verifyWorkspace(miniRoot);
const catalog = require(resolve(miniRoot, 'data/ingredients.js'));
const payload = {
  schemaVersion: 1 as const,
  releaseId: verified.releaseId as string,
  releaseDigest: require(resolve(miniRoot, 'data/version-active.json')).releaseDigest as string,
  contentVersion: catalog.contentVersion as string,
  sourceAsOf: catalog.catalogCoverage.asOf as string,
  ingredients: catalog.ingredients.map(projectIngredient)
};
const seed = validateSeed({ ...payload, digest: seedDigest(payload) });
const destination = resolve(projectRoot, 'data/catalog.seed.json');
const rendered = JSON.stringify(seed, null, 2) + '\n';
if (args[0] === '--check') {
  if (readFileSync(destination, 'utf8') !== rendered) throw new Error('Catalog seed is stale or changed; verify the release and explicitly re-import. CI will not rewrite it.');
  console.log(JSON.stringify({ verified: true, ingredients: seed.ingredients.length, releaseId: seed.releaseId, sourceAsOf: seed.sourceAsOf }));
} else {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, rendered, 'utf8');
  console.log(JSON.stringify({ imported: seed.ingredients.length, releaseId: seed.releaseId, sourceAsOf: seed.sourceAsOf, destination }));
}
