import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePhotoResearch, photoBaseline, photoResearchPath } from './photo-leads';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function readOwned(relative: string): Buffer {
  if (![photoResearchPath, ...photoBaseline.map((binding) => binding.path)].includes(relative)) throw new Error('Unknown research input');
  for (let target = workspace; ; target = dirname(target)) {
    if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) throw new Error('Linked research root');
    if (dirname(target) === target) break;
  }
  let target = workspace;
  const parts = relative.split('/');
  parts.forEach((part, index) => {
    target = join(target, part); const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() || stat.size > 4 * 1024 * 1024 : !stat.isDirectory())) throw new Error('Invalid research input');
  });
  return readFileSync(target);
}
export function checkPhotoResearch() {
  const batch = parsePhotoResearch(JSON.parse(readOwned(photoResearchPath).toString('utf8')));
  for (const binding of batch.baselineBindings) {
    if (`sha256:${createHash('sha256').update(readOwned(binding.path)).digest('hex')}` !== binding.sha256) throw new Error('Historical photo baseline changed; reassess instead of rebinding');
  }
  return { scope: 'offline-private-research-contract-only', checkedAt: batch.checkedAt, leads: batch.leads.length,
    ingredients: new Set(batch.leads.map((lead) => lead.ingredientId)).size,
    declaredOpenLicenseLeads: batch.leads.filter((lead) => lead.rights.state === 'declared_cc_by_sa_4').length,
    permissionRequiredLeads: batch.leads.filter((lead) => lead.rights.state !== 'declared_cc_by_sa_4').length,
    historicalLeadsWithNewRightsNotice: batch.rightsAddenda.reduce((sum, addendum) => sum + addendum.affectedIngredientIds.length, 0),
    baselineUnmodified: true, localImagesAdded: 0, visualReviewsPerformed: 0, gapsClosed: 0, publicPhotosAdded: 0,
    websiteAccessRechecked: false, factualAccuracyVerified: false, rightsApproved: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('This read-only research checker accepts no arguments or approval actions.');
    console.log(JSON.stringify(checkPhotoResearch(), null, 2));
  }
  catch (error) { console.error(error instanceof Error ? error.message : 'Photo research check failed'); process.exitCode = 1; }
}
