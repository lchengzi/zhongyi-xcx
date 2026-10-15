import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { parseDocument } from 'yaml';

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
function config() {
  const filename = resolve('tsconfig.publication-client-browser.json');
  const source = ts.readConfigFile(filename, ts.sys.readFile); assert.equal(source.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(source.config, ts.sys, resolve('.'), undefined, filename);
  assert.deepEqual(parsed.errors, []); return parsed;
}
function workflow() {
  const parsed = parseDocument(readFileSync(resolve('../.github/workflows/ts-refactor.yml'), 'utf8'), { uniqueKeys: true });
  assert.deepEqual(parsed.errors, []); return object(parsed.toJS());
}

test('new browser/client integration and its CI checks are included in daily strict typechecking', () => {
  const parsed = config();
  assert.equal(parsed.options.strict, true); assert.equal(parsed.options.noEmit, true);
  const files = parsed.fileNames.map(file => resolve(file).toLowerCase());
  for (const file of ['tests/public-education-client-browser.test.ts', 'tests/publication-client-ci.test.ts']) assert.ok(files.includes(resolve(file).toLowerCase()));
  const scripts = object(object(JSON.parse(readFileSync('package.json', 'utf8'))).scripts);
  assert.equal(typeof scripts.typecheck, 'string');
  assert.ok(String(scripts.typecheck).split(' && ').includes('tsc --noEmit -p tsconfig.publication-client-browser.json'));
});

test('integration compiler rejects invalid assignment and implicit any without writing files or running fixtures', () => {
  const parsed = config(); const filename = resolve('tests/public-education-client-browser.test.ts');
  const host = ts.createCompilerHost(parsed.options); const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = original(file, languageVersion, onError, shouldCreateNewSourceFile);
    if (!source || resolve(file).toLowerCase() !== filename.toLowerCase()) return source;
    return ts.createSourceFile(file, source.text + '\nconst __badIntegrationType: string = 1;\nfunction __badIntegrationImplicit(value) { return value; }\n', languageVersion, true);
  };
  host.writeFile = () => assert.fail('Typechecking cannot emit files');
  const program = ts.createProgram(parsed.fileNames, parsed.options, host); const source = program.getSourceFile(filename); assert.ok(source);
  const diagnostics = program.getSemanticDiagnostics(source);
  assert.ok(diagnostics.some(item => item.code === 2322)); assert.ok(diagnostics.some(item => item.code === 7006));
});

test('fullstack CI uses pinned actions, read-only permissions, isolated browser command and disabled AI', () => {
  const parsed = workflow(); assert.deepEqual(parsed.permissions, { contents: 'read' });
  const job = object(object(parsed.jobs)['fullstack-browser']);
  assert.equal(job['runs-on'], 'windows-2025'); assert.equal(job['timeout-minutes'], 20);
  assert.deepEqual(job.env, { AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false' });
  assert.ok(Array.isArray(job.steps)); const steps = job.steps.map(object);
  const actions = steps.filter(step => step.uses !== undefined);
  assert.equal(actions.length, 3);
  for (const action of actions) assert.match(String(action.uses), /^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/);
  assert.equal(object(actions[0].with)['persist-credentials'], false);
  assert.equal(object(actions[1].with)['node-version'], '22');
  assert.deepEqual(steps.filter(step => step.run).map(step => step.run), [
    'npm ci --no-fund', 'npm --prefix zhongyi-platform ci --no-fund', 'npm run test:publication-browser',
    'npm --prefix zhongyi-platform run test:photo-publication', 'npm --prefix zhongyi-platform run test:container-photos'
  ]);
  const source = JSON.stringify(parsed);
  for (const forbidden of ['secrets.', 'continue-on-error', 'pull_request_target']) assert.equal(source.includes(forbidden), false);
  const root = object(object(JSON.parse(readFileSync('../package.json', 'utf8'))).scripts);
  assert.equal(root['test:publication-browser'], 'npm --prefix zhongyi-platform run test:publication-client:browser');
  const scripts = object(object(JSON.parse(readFileSync('package.json', 'utf8'))).scripts);
  assert.equal(scripts['test:publication-client:browser'], 'npm run typecheck:publication-client:browser && tsx --test tests/publication-client-ci.test.ts && vite build && tsx --test tests/public-education-client-browser.test.ts');
});

test('uploaded artifacts are only the explicit report and simulated UI screenshots, never DBs or credentials', () => {
  const job = object(object(workflow().jobs)['fullstack-browser']); assert.ok(Array.isArray(job.steps));
  const upload = job.steps.map(object).find(step => String(step.uses).startsWith('actions/upload-artifact@')); assert.ok(upload);
  assert.equal(upload.if, 'always()'); const options = object(upload.with);
  assert.equal(options['include-hidden-files'], true); assert.equal(options['retention-days'], 7);
  assert.deepEqual(String(options.path).trim().split('\n'), [
    '.refactor/evidence/fullstack-client-*/run-*/report.json',
    '.refactor/evidence/fullstack-client-*/run-*/first-publication.png',
    '.refactor/evidence/fullstack-client-*/run-*/reopened-publication.png',
    'zhongyi-platform/.local/photo-publication-tests/run-*/browser-report.json',
    'zhongyi-platform/.local/photo-publication-tests/run-*/resource-report.json',
    'zhongyi-platform/.local/photo-publication-tests/run-*/recovery-ui.png',
    'zhongyi-platform/.local/photo-publication-tests/run-*/recovery-failure.json',
    'zhongyi-platform/.local/photo-publication-tests/run-*/recovery-failure.png',
    'zhongyi-platform/.local/photo-publication-tests/run-*/review-390.png'
  ]);
});
