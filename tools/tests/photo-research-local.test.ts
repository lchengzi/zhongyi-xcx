import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parsePhotoResearch, photoResearchPath } from '../research/photo-leads';
import { checkPhotoResearch } from '../research/check-photo-leads';

// Explicit local integration check. A missing private corpus must FAIL, not skip,
// pass as an empty list, be synthesized, or become a public/CI input.
const root = fileURLToPath(new URL('../../', import.meta.url));
test('actual private corpus remains bound to its unchanged historical files and never gains approval', () => {
  const batch = parsePhotoResearch(JSON.parse(readFileSync(resolve(root, photoResearchPath), 'utf8')) as unknown);
  assert.equal(batch.leads.length, 4); assert.equal(batch.rightsAddenda[0]?.affectedIngredientIds.length, 3);
  assert.deepEqual(checkPhotoResearch(), { scope: 'offline-private-research-contract-only', checkedAt: '2026-10-11', leads: 4, ingredients: 2,
    declaredOpenLicenseLeads: 2, permissionRequiredLeads: 2, historicalLeadsWithNewRightsNotice: 3, baselineUnmodified: true,
    localImagesAdded: 0, visualReviewsPerformed: 0, gapsClosed: 0, publicPhotosAdded: 0, websiteAccessRechecked: false,
    factualAccuracyVerified: false, rightsApproved: false });
});
test('actual corpus CLI is read-only and does not open a configured database', () => {
  const database = resolve(root, '.refactor/reports', `photo-readonly-${randomUUID()}.sqlite`); assert.equal(existsSync(database), false);
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/research/check-photo-leads.ts'], { cwd: root,
    env: { ...process.env, DB_PATH: database }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), checkPhotoResearch());
  assert.equal(existsSync(database), false);
});
