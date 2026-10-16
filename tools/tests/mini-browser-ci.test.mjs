import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = new URL('../../', import.meta.url);
const { parseDocument } = createRequire(fileURLToPath(new URL('zhongyi-platform/package.json', root)))('yaml');
function workflow() {
  const document = parseDocument(readFileSync(new URL('.github/workflows/ts-refactor.yml', root), 'utf8'), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test('mini browser CI is read-only, uses pinned actions and never enables real AI', () => {
  const value = workflow(), job = value.jobs['mini-reading-browser'];
  assert.deepEqual(value.permissions, { contents: 'read' });
  assert.equal(job['runs-on'], 'windows-2025'); assert.equal(job['timeout-minutes'], 20);
  assert.deepEqual(job.env, { AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false' });
  const actions = job.steps.filter(step => step.uses);
  assert.equal(actions.length, 3);
  for (const action of actions) assert.match(action.uses, /^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/);
  assert.equal(actions[0].with['persist-credentials'], false);
  for (const forbidden of ['secrets.', 'continue-on-error', 'pull_request_target']) assert.equal(JSON.stringify(value).includes(forbidden), false);
});

test('mini browser CI runs actual layout, connectivity and storage entrypoints after locked dependencies and strict types', () => {
  const job = workflow().jobs['mini-reading-browser'];
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), [
    'npm ci --no-fund', 'npm --prefix zhongyi-platform ci --no-fund', 'npm run typecheck',
    'npm run test:mini-browser-ci', 'npm run test:mini-reading', 'npm run test:mini-education', 'npm run test:mini-storage',
    'npm run test:mini-photos', 'npm run test:mini-catalog-photos',
  ]);
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(scripts['test:mini-reading'], 'node tools/check-mini-reading-layout.mjs');
  assert.equal(scripts['test:mini-education'], 'node tools/check-mini-education-recovery.mjs');
  assert.equal(scripts['test:mini-storage'], 'node tools/check-mini-storage-recovery.mjs');
  assert.equal(scripts['test:mini-photos'], 'node tools/check-mini-photos.mjs');
  assert.equal(scripts['test:mini-catalog-photos'], 'node tools/check-mini-catalog-photos.mjs');
  assert.equal(scripts['test:mini-browser-ci'], 'node --test tools/tests/mini-browser-ci.test.mjs');
  assert.ok(scripts.test.split(' && ').includes('npm run test:mini-browser-ci'));
});

test('mini browser evidence upload is limited to fixture reports and named screenshots', () => {
  const step = workflow().jobs['mini-reading-browser'].steps.find(value => value.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(step.if, 'always()'); assert.equal(step.with['include-hidden-files'], true); assert.equal(step.with['retention-days'], 7);
  assert.deepEqual(step.with.path.trim().split('\n'), [
    '.refactor/evidence/reading-layout-runs/run-*/report.json',
    '.refactor/evidence/reading-layout-runs/run-*/320-compare-four-viewport.png',
    '.refactor/evidence/reading-layout-runs/run-*/failure-viewport.png',
    '.refactor/evidence/education-recovery-runs/run-*/report.json',
    '.refactor/evidence/education-recovery-runs/run-*/reconnected-viewport.png',
    '.refactor/evidence/education-recovery-runs/run-*/offline-expired-viewport.png',
    '.refactor/evidence/education-recovery-runs/run-*/failure-viewport.png',
    '.refactor/evidence/storage-recovery-runs/run-*/report.json',
    '.refactor/evidence/storage-recovery-runs/run-*/confirmed-deletion-viewport.png',
    '.refactor/evidence/storage-recovery-runs/run-*/unavailable-compare-slot.png',
    '.refactor/evidence/storage-recovery-runs/run-*/320-unavailable-extra-large.png',
    '.refactor/evidence/storage-recovery-runs/run-*/persisted_then_exception_never_invites_blind_retry-failure.png',
    '.refactor/evidence/storage-recovery-runs/run-*/deletion_read_failure_clears_only_memory_then_explicit_retry-failure.png',
    '.refactor/evidence/photo-ui-runs/run-*/report.json',
    '.refactor/evidence/photo-ui-runs/run-*/320-extra-large-gallery.png',
    '.refactor/evidence/catalog-photo-runs/run-*/report.json',
    '.refactor/evidence/catalog-photo-runs/run-*/320-standard-card.png',
    '.refactor/evidence/catalog-photo-runs/run-*/390-extra-large-card.png',
    '.refactor/evidence/catalog-photo-runs/run-*/390-detail-photo-retry.png',
    '.refactor/evidence/catalog-photo-runs/run-*/390-detail-photo-renewed.png',
    '.refactor/evidence/catalog-photo-runs/run-*/failure.png',
  ]);
});

test('photo publication UI is included in fullstack CI without uploading the actual review packets or original libraries', () => {
  const job = workflow().jobs['fullstack-browser'];
  assert(job.steps.some(step => step.run === 'npm --prefix zhongyi-platform run test:photo-publication'));
  assert(job.steps.some(step => step.run === 'npm --prefix zhongyi-platform run test:container-photos'));
  const platform = JSON.parse(readFileSync(new URL('zhongyi-platform/package.json', root), 'utf8'));
  assert.equal(platform.scripts['test:container-photos'], 'npm run build:server && tsx --test tests/container-photo-backup.test.ts');
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  const paths = upload.with.path.trim().split('\n');
  assert(paths.includes('zhongyi-platform/.local/photo-publication-tests/run-*/browser-report.json'));
  assert(paths.includes('zhongyi-platform/.local/photo-publication-tests/run-*/review-390.png'));
  assert(paths.includes('zhongyi-platform/.local/photo-publication-tests/run-*/resource-report.json'));
  assert(paths.includes('zhongyi-platform/.local/photo-publication-tests/run-*/recovery-ui.png'));
  assert(!paths.some(value => value.includes('photo-review-packets') || value.includes('content-private') || value.endsWith('*.jpg')));
  assert(!paths.some(value => value.includes('encrypted') || value.includes('key.txt') || value.endsWith('/*.json') || value.endsWith('/**')));
});
test('default CI keeps private corpus checks opt-in and observes source boundary configuration changes', () => {
  const value = workflow(), { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(scripts['test:photo-research'], 'tsx --test tools/tests/photo-research.test.ts && node --test tools/tests/photo-research-isolation.test.mjs');
  assert.equal(scripts['test:photo-research:local'], 'tsx --test tools/tests/photo-research-local.test.ts');
  assert.equal(scripts['test:source-boundaries'], 'node --test tools/tests/source-boundaries.test.mjs');
  assert(scripts.test.split(' && ').includes('npm run test:source-boundaries'));
  assert(!scripts.test.includes('test:photo-research:local') && !scripts.test.includes('photo-research:check'));
  for (const job of Object.values(value.jobs)) for (const step of job.steps.filter(step => step.run)) {
    assert(!step.run.includes('test:photo-research:local') && !step.run.includes('photo-research:check'));
  }
  for (const event of ['push', 'pull_request']) for (const path of ['.gitignore', 'zhongyi/.gitignore', 'tsconfig.research.json']) {
    assert(value.on[event].paths.includes(path));
  }
});

test('archive compatibility runs real POSIX regressions in a pinned read-only Linux job and Windows default tests', () => {
  const value = workflow(), job = value.jobs['archive-compat-posix'];
  assert.equal(job['runs-on'], 'ubuntu-24.04'); assert.equal(job['timeout-minutes'], 10);
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), [
    'npm ci --ignore-scripts --no-fund', 'npm run test:archive-compat',
  ]);
  const actions = job.steps.filter(step => step.uses); assert.equal(actions.length, 2);
  for (const action of actions) assert.match(action.uses, /^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
  assert.equal(actions[0].with['persist-credentials'], false);
  assert.equal(actions[1].with['node-version'], '22');
  assert.equal(value.jobs.verify['runs-on'], 'windows-2025');
  assert(value.jobs.verify.steps.some(step => step.run === 'npm test'));
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.scripts['test:archive-compat'], 'node --test tools/tests/archive-extractor-compat.test.mjs');
  assert(manifest.scripts.test.split(' && ').includes('npm run test:archive-compat'));
  assert.equal(manifest.devDependencies.decompress, 'file:packages/archive-extractor-compat');
  assert.deepEqual(manifest.overrides, { decompress: '$decompress' });
  for (const forbidden of ['secrets.', 'continue-on-error', 'pull_request_target']) assert.equal(JSON.stringify(value).includes(forbidden), false);
});
