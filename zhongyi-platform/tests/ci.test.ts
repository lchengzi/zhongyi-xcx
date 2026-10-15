import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import ts from 'typescript';
import { ciEnvironment, ciPlan, ciScriptArgs, parseCiProfile, tapProof, postgresProof, browserProof, browserExecutionProof, offlineProof, httpsProof, postgresHttpsProof, runCi, type CiReport } from '../tools/ci-core.js';

const start = Date.parse('2026-10-08T00:00:00Z'); const end = start + 1000;
const pg = () => ({ testedAt: new Date(start).toISOString(), engine: 'real-postgresql', status: 'passed', fixtureStopped: true,
  sourceWorkingDatabaseModified: false, passed: 28, failed: 0, scope: 'migration-api-and-recovery', restarts: 3,
  databaseTlsVerified: true, operatingSystemTrustModified: false, certificateChainVerified: true,
  hostnameMismatchRejected: true, untrustedCaRejected: true, plaintextRejected: true });
const browser = () => ({ stats: { startTime: new Date(start).toISOString(), expected: 16, skipped: 0, unexpected: 0, flaky: 0 }, errors: [] });
function report(): CiReport {
  return { schemaVersion: 1, profile: 'core', runId: 'unit-not-a-real-CI-run', startedAt: new Date(start).toISOString(), finishedAt: null,
    runtime: { node: process.version, platform: process.platform }, status: 'running', commit: null, deploymentVerified: false, externalAiEnabled: false,
    steps: ciPlan('core').map((step) => ({ ...step, status: 'pending' })) };
}

function webTestConfig() {
  const filename = resolve('tsconfig.web-tests.json');
  const source = ts.readConfigFile(filename, ts.sys.readFile);
  assert.equal(source.error, undefined);
  const config = ts.parseJsonConfigFileContent(source.config, ts.sys, resolve('.'), undefined, filename);
  assert.deepEqual(config.errors, []);
  return config;
}

test('daily typecheck includes every browser TypeScript file, Playwright config and SQLite/PostgreSQL fixtures', () => {
  const config = webTestConfig();
  const key = (filename: string) => process.platform === 'win32' ? resolve(filename).toLowerCase() : resolve(filename);
  const checked = new Set(config.fileNames.map(key));
  const browserFiles = ts.sys.readDirectory(resolve('tests/browser'), ['.ts']);
  assert(browserFiles.length > 0);
  for (const filename of [...browserFiles, 'playwright.config.ts', 'tests/browser-server.ts',
    'tests/photo-professional-browser.test.ts', 'tests/photo-professional-response.test.ts', 'tests/photo-professional-response-fixture.ts',
    'tests/photo-professional-http.test.ts', 'tests/photo-professional-http-fixture.ts', 'tests/postgres-photo-professional-http.test.ts', 'tests/photo-rights-browser.test.ts',
    'tests/publication-browser-server.ts', 'tests/postgres-browser-fixture.ts', 'tests/ci.test.ts', 'web/api.ts', 'tests/web-request.test.ts', 'tests/private-photos.test.ts', 'tests/private-photos-browser.test.ts', 'tests/private-photo-library.test.ts', 'tests/private-photo-library-fixture.ts', 'tests/photo-notes.test.ts', 'tests/postgres-photo-notes.test.ts', 'tests/photo-note-response.test.ts', 'tests/photo-note-http.test.ts', 'tests/postgres-photo-note-http.test.ts', 'tests/photo-submissions.test.ts', 'tests/postgres-photo-submissions.test.ts', 'tests/postgres-deployment.test.ts', 'tests/postgres-permissions.test.ts', 'tests/photo-submission-response.test.ts', 'tests/photo-submission-http.test.ts', 'tests/postgres-photo-submission-http.test.ts', 'tests/photo-submissions-browser.test.ts']) {
    assert(checked.has(key(filename)), `Missing from daily web-test typecheck: ${filename}`);
  }
  const scripts = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts;
  assert(scripts.typecheck.split(' && ').includes('tsc --noEmit -p tsconfig.web-tests.json'));
  assert.equal(ciPlan('core').find((step) => step.id === 'types')?.script, 'typecheck');
});

test('browser typecheck really rejects incompatible types and implicit any without writing or running fixtures', () => {
  const config = webTestConfig();
  assert.equal(config.options.strict, true);
  assert.equal(config.options.noEmit, true);
  assert.notEqual(config.options.noImplicitAny, false);
  const filename = resolve('tests/browser/source-recovery.spec.ts');
  const host = ts.createCompilerHost(config.options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = original(path, languageVersion, onError, shouldCreateNewSourceFile);
    if (!source || resolve(path) !== filename) return source;
    return ts.createSourceFile(path, source.text + '\nconst __typecheckProbe: string = 1;\nfunction __implicitAnyProbe(value) { return value; }\n', languageVersion, true);
  };
  host.writeFile = () => assert.fail('Typecheck must not emit files');
  const program = ts.createProgram(config.fileNames, config.options, host);
  const source = program.getSourceFile(filename);
  assert(source, 'Browser spec is missing from the compiler program');
  const diagnostics = program.getSemanticDiagnostics(source);
  assert(diagnostics.some((item) => item.code === 2322), 'Compiler did not reject number assigned to string');
  assert(diagnostics.some((item) => item.code === 7006), 'Compiler did not reject implicit any');
});
test('CI profiles are exact fixed plans and include real migration/recovery, browser, native safety and build commands', () => {
  for (const name of ['core', 'postgres', 'browser', 'postgres-browser', 'https'] as const) assert.equal(parseCiProfile([name]), name);
  for (const args of [[], ['core', 'postgres'], ['--skip'], ['deploy'], ['core; echo secret']]) assert.throws(() => parseCiProfile(args));
  assert.deepEqual(ciPlan('core').map((step) => step.script), ['catalog:check', 'typecheck', 'test', 'eval:assistant', 'check', 'test', 'build', 'test:request-log:runtime']);
  assert.equal(ciPlan('core').at(-1)?.proof, 'tap');
  assert.equal(ciPlan('core').filter((step) => step.project === 'mini').length, 2);
  assert.equal(ciPlan('postgres')[0].script, 'test:postgres'); assert.equal(ciPlan('postgres-browser')[0].script, 'test:postgres:browser');
  assert.equal(ciPlan('https')[0].script, 'test:https'); assert.equal(ciPlan('https')[0].proof, 'https');
  assert.deepEqual(ciPlan('https').map(({ script, proof }) => ({ script, proof })), [
    { script: 'test:https', proof: 'https' }, { script: 'test:postgres:https', proof: 'postgres-https' }
  ]);
});
test('CI child environment clears real database/model/bootstrap/backup secrets and uses an owned unused SQLite path', () => {
  const env = ciEnvironment({ PATH: 'keep-tool-path', DATABASE_URL: 'secret', DATABASE_SCHEMA: 'work', DATABASE_PROVIDER: 'postgres', PG_TEST_DATABASE_URL: 'work',
    PG_TEST_NONCE: 'secret', PRIVATE_PHOTO_ROOT: '/private-images', PRIVATE_PHOTO_MANIFEST: '/private-images/manifest.json', EDUCATION_PUBLICATION_ENABLED: 'true', OPENAI_API_KEY: 'secret', AI_MODEL: 'paid-model', AI_EXTERNAL_ENABLED: 'true', AI_PROVIDER: 'openai', EDITOR_TOKEN: 'secret',
    BOOTSTRAP_PASSWORD: 'secret', BACKUP_ENCRYPTION_KEY: 'secret', BACKUP_ENCRYPTION_KEY_FILE: '/backup-key', BACKUP_INPUT_DIRECTORY: '/private-input', BACKUP_OUTPUT_DIRECTORY: '/private-output', DB_PATH: 'real.sqlite', NODE_ENV: 'production', BIND_HOST: '0.0.0.0', DATABASE_URL_FILE: '/work-secret', DATABASE_RUNTIME_URL_FILE: '/runtime-secret', DATABASE_OWNER_URL_FILE: '/owner-secret',
    TLS_MODE: 'direct', TLS_CERT_FILE: '/real-cert', TLS_KEY_FILE: '/real-key', TLS_HEALTH_CA_FILE: '/real-ca', HTTPS_TEST_DIRECTORY: '/real-directory', HTTPS_TEST_NONCE: 'secret', HTTPS_TEST_PASSWORD: 'secret',
    HTTPS_TEST_DATABASE_PROVIDER: 'postgres', HTTPS_TEST_POSTGRES_SCHEMA: 'work', HTTPS_TEST_RUNTIME_DATABASE_URL: 'private-runtime', NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'owned-ci/unused.sqlite');
  for (const key of ['DATABASE_URL', 'DATABASE_SCHEMA', 'PG_TEST_DATABASE_URL', 'PG_TEST_NONCE', 'OPENAI_API_KEY', 'AI_MODEL', 'EDITOR_TOKEN', 'BOOTSTRAP_PASSWORD', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY_FILE', 'BACKUP_INPUT_DIRECTORY', 'BACKUP_OUTPUT_DIRECTORY', 'BIND_HOST', 'DATABASE_URL_FILE', 'DATABASE_RUNTIME_URL_FILE', 'DATABASE_OWNER_URL_FILE', 'TLS_MODE', 'TLS_CERT_FILE', 'TLS_KEY_FILE', 'TLS_HEALTH_CA_FILE', 'HTTPS_TEST_DIRECTORY', 'HTTPS_TEST_NONCE', 'HTTPS_TEST_PASSWORD', 'HTTPS_TEST_DATABASE_PROVIDER', 'HTTPS_TEST_POSTGRES_SCHEMA', 'HTTPS_TEST_RUNTIME_DATABASE_URL']) assert.equal(env[key], '', key);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, '1');
  assert.equal(ciEnvironment({ PG_INITIALIZATION_DIAGNOSTICS: 'true' }, 'owned-ci/unused.sqlite').PG_INITIALIZATION_DIAGNOSTICS, 'false');
  assert.equal(env.DB_PATH, 'owned-ci/unused.sqlite'); assert.equal(env.DATABASE_PROVIDER, 'sqlite'); assert.equal(env.AI_PROVIDER, 'disabled');
  assert.equal(env.AI_EXTERNAL_ENABLED, 'false'); assert.equal(env.NODE_ENV, undefined, 'Vite must choose its production build, not test/development React'); assert.equal(env.PATH, 'keep-tool-path');
  assert.equal(env.EDUCATION_PUBLICATION_ENABLED, 'false');
  assert.equal(env.PRIVATE_PHOTO_ROOT, undefined); assert.equal(env.PRIVATE_PHOTO_MANIFEST, undefined);
});

test('SQLite browser CI isolates screenshots in its own run instead of cleaning shared historical output', () => {
  const directory = resolve('.local/ci-runs/browser-01234567-0123-4567-89ab-0123456789ab');
  const step = ciPlan('browser')[1];
  assert.deepEqual(ciScriptArgs(step, directory), ['run', 'test:browser', '--', `--output=${resolve(directory, 'browser-artifacts')}`]);
  for (const path of ['relative', resolve('.local/ci-runs/browser-unit'), resolve('browser-01234567-0123-4567-89ab-0123456789ab'),
    resolve('.local/other/browser-01234567-0123-4567-89ab-0123456789ab')]) assert.throws(() => ciScriptArgs(step, path));
  for (const profile of ['core', 'postgres', 'postgres-browser', 'https'] as const) for (const other of ciPlan(profile)) {
    assert.deepEqual(ciScriptArgs(other, directory), ['run', other.script]);
  }
  const config = readFileSync(resolve('playwright.config.ts'), 'utf8');
  assert.match(config, /outputDir: resolve\('\.local\/browser-tests', `run-\$\{randomUUID\(\)\}`\)/);
});
test('CI TAP proof requires nonzero fully passing tests with no skipped, cancelled or todo cases', () => {
  const output = '# tests 5\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(tapProof(output).passed, 5);
  for (const bad of ['', output.replaceAll('5', '0'), output.replace('# skipped 0', '# skipped 1'), output.replace('# pass 5', '# pass 4'), output.replace('# todo 0', '# todo 1')]) assert.throws(() => tapProof(bad));
});
test('CI PostgreSQL proof refuses stale, unfinished, partially passing, wrong-scope and insufficient-restart reports', () => {
  assert.equal(postgresProof(pg(), start, end).fixtureStopped, true);
  for (const change of [{ testedAt: new Date(start - 1).toISOString() }, { testedAt: new Date(end + 1).toISOString() }, { fixtureStopped: false },
    { status: 'failed' }, { passed: 0 }, { failed: 1 }, { sourceWorkingDatabaseModified: true }, { restarts: 2 }, { scope: 'migration-and-api' }]) assert.throws(() => postgresProof({ ...pg(), ...change }, start, end));
  assert.equal(postgresProof({ ...pg(), scope: 'react-browser', restarts: 0 }, start, end, true).restarts, 0);
  for (const key of ['databaseTlsVerified', 'certificateChainVerified', 'hostnameMismatchRejected', 'untrustedCaRejected', 'plaintextRejected']) {
    assert.throws(() => postgresProof({ ...pg(), [key]: false }, start, end));
  }
  assert.throws(() => postgresProof({ ...pg(), operatingSystemTrustModified: true }, start, end));
});
test('CI browser proof refuses old reports, skipped/flaky/failed cases and framework errors', () => {
  assert.equal(browserProof(browser(), start, end).passed, 16);
  for (const change of [{ expected: 0 }, { skipped: 1 }, { flaky: 1 }, { unexpected: 1 }, { startTime: new Date(start - 1).toISOString() }]) {
    const data = browser(); assert.throws(() => browserProof({ ...data, stats: { ...data.stats, ...change } }, start, end));
  }
  assert.throws(() => browserProof({ ...browser(), errors: ['framework error'] }, start, end));
  const data = { ...browser(), config: { forbidOnly: true } };
  assert.equal(browserExecutionProof(data, '  16 passed (1m)', 0, start, end).passed, 16);
  for (const output of ['', '15 passed', '17 passed']) assert.throws(() => browserExecutionProof(data, output, 0, start, end));
  assert.throws(() => browserExecutionProof({ ...data, config: { forbidOnly: false } }, '16 passed', 0, start, end));
  for (const code of [1, null]) assert.throws(() => browserExecutionProof(data, '16 passed', code, start, end));
});
test('CI runner stops at failure, marks remaining steps not-run and does not persist raw secret errors', async () => {
  const value = report(); const calls: string[] = []; const snapshots: string[] = []; let clock = start;
  await runCi(value, async (step) => { calls.push(step.id); if (calls.length === 2) throw new Error('secret connection/password'); return { code: 0 }; }, (data) => snapshots.push(JSON.stringify(data)), () => clock++);
  assert.equal(value.status, 'failed'); assert.equal(calls.length, 2); assert.equal(value.steps[0].status, 'passed'); assert.equal(value.steps[1].status, 'failed');
  assert(value.steps.slice(2).every((step) => step.status === 'not_run')); assert.equal(snapshots.join().includes('secret connection/password'), false);
  assert(value.finishedAt); assert.equal(value.deploymentVerified, false);
});
test('CI offline proof is fresh and complete but cannot masquerade as real-model quality or external calls', () => {
  const data = { kind: 'offline-contract', testedAt: new Date(start).toISOString(), caseCount: 1, passed: 1, failed: 0,
    realModelCalls: 0, externalTransfers: 0, modelQualityMeasured: false, costMeasured: false, results: [{ id: 'unit-case', passed: true }] };
  assert.equal(offlineProof(data, start, end).modelQualityMeasured, false);
  for (const change of [{ testedAt: new Date(start - 1).toISOString() }, { realModelCalls: 1 }, { modelQualityMeasured: true }, { costMeasured: true },
    { results: [] }, { passed: 0 }, { failed: 1 }, { results: [{ passed: false }] }]) assert.throws(() => offlineProof({ ...data, ...change }, start, end));
});
test('CI runner requires a real plan and every required proof; only all-success transitions can mark a run passed', async () => {
  const success = report(); await runCi(success, async (step) => ({ code: 0, ...(step.proof ? { proof: { passed: 5, failed: 0, skipped: 0 } } : {}) }), () => {}, () => start);
  assert.equal(success.status, 'passed'); assert(success.steps.every((step) => step.status === 'passed'));
  const missing = report(); await runCi(missing, async () => ({ code: 0 }), () => {}, () => start); assert.equal(missing.status, 'failed');
  const failedExit = report(); await runCi(failedExit, async () => ({ code: null }), () => {}, () => start); assert.equal(failedExit.status, 'failed');
  const empty = report(); empty.steps = []; await runCi(empty, async () => { throw new Error('not called'); }, () => {}, () => start); assert.equal(empty.status, 'failed');
});

test('GitHub workflow YAML is valid and keeps fixed actions, exact profiles, read-only permissions and scoped artifacts without deploy or secret inputs', () => {
  const source = readFileSync(resolve('../.github/workflows/ci.yml'), 'utf8'); const parsed = parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(parsed.errors, []); const workflow = parsed.toJS();
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  const attributes = readFileSync(resolve('../.gitattributes'), 'utf8');
  assert.match(attributes, /^zhongyi\/\*\* -text$/m); assert.match(attributes, /^zhongyi-platform\/\*\* -text$/m);
  assert(workflow.on.push.paths.includes('.gitattributes')); assert(workflow.on.pull_request.paths.includes('.gitattributes'));
  assert(workflow.on.push.paths.includes('packages/catalog-core/**'));
  assert(workflow.on.pull_request.paths.includes('packages/catalog-core/**'));
  assert.deepEqual(workflow.permissions, { contents: 'read' }); assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(workflow.jobs), ['verify']); const job = workflow.jobs.verify;
  assert.equal(job['runs-on'], 'windows-2025'); assert.deepEqual(job.strategy.matrix.profile, ['core', 'postgres', 'browser', 'postgres-browser', 'https']);
  assert.equal(job.strategy['fail-fast'], false); assert(job['timeout-minutes'] >= 30);
  const actions = job.steps.filter((step: any) => step.uses);
  assert.equal(actions.length, 3); for (const action of actions) assert.match(action.uses, /^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/);
  assert.equal(actions[0].with['persist-credentials'], false); assert.equal(actions[1].with['node-version'], '22');
  const uploaded = actions[2]; assert.equal(uploaded.if, 'always()'); assert.equal(uploaded.with['include-hidden-files'], true); assert.equal(uploaded.with['retention-days'], 7);
  assert.deepEqual(uploaded.with.path.trim().split('\n'), ['zhongyi-platform/.local/ci-runs/*/report.json', 'zhongyi-platform/.local/ci-results.*.latest.json', 'zhongyi-platform/.local/assistant-contract-eval.latest.json', 'zhongyi-platform/.local/ci-runs/*/browser-artifacts/*/*.png',
    'zhongyi-platform/.local/https-tests/*/result.json', 'zhongyi-platform/.local/https-tests/*/application-*.json',
    'zhongyi-platform/.local/https-tests/*/diagnostic-faults.json', 'zhongyi-platform/.local/https-tests/*/https-workbench-desktop.png',
    'zhongyi-platform/.local/https-tests/*/https-workbench-mobile.png', 'zhongyi-platform/.local/https-tests/*/https-publication-desktop.png',
    'zhongyi-platform/.local/https-tests/*/https-publication-mobile.png', 'zhongyi-platform/.local/postgres-tests/*/result.json',
    'zhongyi-platform/.local/postgres-tests/*/browser-artifacts/*/*.png', 'zhongyi-platform/.local/request-log-runs/*/report.json']);
  assert.equal(source.includes('secrets.'), false); assert.equal(source.includes('continue-on-error'), false); assert.equal(source.includes('pull_request_target:'), false);
  assert(job.steps.some((step: any) => step.run === 'npm ci')); assert(job.steps.some((step: any) => step.run === 'npm run ci -- $env:CI_PROFILE'));
  const platform = JSON.parse(readFileSync(resolve('package.json'), 'utf8')); const mini = JSON.parse(readFileSync(resolve('../zhongyi/package.json'), 'utf8'));
  for (const profile of job.strategy.matrix.profile) for (const step of ciPlan(profile)) assert.equal(typeof (step.project === 'mini' ? mini : platform).scripts[step.script], 'string');
});

test('catalog check CLI verifies the actual 106-row release without rewriting the seed and refuses unknown arguments', async () => {
  const execute = promisify(execFile); const filename = resolve('data/catalog.seed.json'); const before = readFileSync(filename);
  const options = { cwd: resolve('.'), env: ciEnvironment(process.env, 'unused-ci.sqlite'), windowsHide: true };
  const result = await execute(process.execPath, ['--import', 'tsx', 'tools/import-catalog.ts', '--check'], options);
  const proof = JSON.parse(result.stdout); assert.equal(proof.verified, true); assert.equal(proof.ingredients, 106);
  assert.deepEqual(readFileSync(filename), before);
  await assert.rejects(execute(process.execPath, ['--import', 'tsx', 'tools/import-catalog.ts', '--check', '--unknown'], options));
  assert.deepEqual(readFileSync(filename), before);
});

test('HTTPS CI proof rejects stale/incomplete/skipped verification and cannot claim public trust or deployment', () => {
  const value = { testedAt: new Date(start).toISOString(), kind: 'local-https-engineering', scope: 'compiled-https-sqlite', databaseProvider: 'sqlite', storageEngineVerified: true, postgresSchemasVerified: 0, status: 'passed', passed: 6, failed: 0, skipped: 0,
    fixturesStopped: true, certificateChainVerified: true, secureCookieVerified: true, browserFlowVerified: true, applicationRestartVerified: true,
    compiledBackendVerified: true, publicationFlowVerified: true, publicationDefaultOffVerified: true, publicationRestartVerified: true, publicationBrowserFlowVerified: true,
    publicEducationClientVerified: true, publicEducationClientRequests: 21,
    publicEducationRecoveryVerified: false, publicEducationRecoveryRequests: 0,
    publicTrustVerified: false, deploymentVerified: false, operatingSystemTrustModified: false, realModelCalls: 0,
    databaseTlsVerified: false, databaseCertificateChainVerified: false, databaseHostnameMismatchRejected: false,
    databaseUntrustedCaRejected: false, databasePlaintextRejected: false, databaseTlsApplicationsVerified: 0,
    databaseRuntimePermissionsVerified: false, databaseRestrictedApplicationsVerified: 0 };
  const diagnostics = { requestDiagnosticsVerified: true, diagnosticFaultsVerified: true, diagnosticApplications: 7, diagnosticMatchedRequests: 20 };
  Object.assign(value, diagnostics);
  assert.equal(httpsProof(value, start, end).publicTrustVerified, false);
  assert.equal(httpsProof(value, start, end).publicEducationClientVerified, true);
  assert.equal(httpsProof(value, start, end).publicEducationClientRequests, 21);
  for (const change of [{ requestDiagnosticsVerified: false }, { diagnosticFaultsVerified: false }, { diagnosticApplications: 6 },
    { diagnosticMatchedRequests: 6 }, { diagnosticMatchedRequests: 7.1 }, { diagnosticMatchedRequests: undefined }]) assert.throws(() => httpsProof({ ...value, ...change }, start, end));
  for (const change of [{ testedAt: new Date(start - 1).toISOString() }, { fixturesStopped: false }, { passed: 0 }, { failed: 1 }, { skipped: 1 },
    { certificateChainVerified: false }, { secureCookieVerified: false }, { browserFlowVerified: false }, { applicationRestartVerified: false },
    { scope: 'typescript-https' }, { databaseProvider: 'postgres' }, { storageEngineVerified: false }, { postgresSchemasVerified: 3 }, { passed: 4 }, { compiledBackendVerified: false }, { publicationFlowVerified: false },
    { publicationDefaultOffVerified: false }, { publicationRestartVerified: false }, { publicationBrowserFlowVerified: false },
    { publicEducationClientVerified: false }, { publicEducationClientVerified: undefined },
    { publicEducationClientRequests: 20 }, { publicEducationClientRequests: 21.1 }, { publicEducationClientRequests: undefined },
    { publicTrustVerified: true }, { deploymentVerified: true }, { operatingSystemTrustModified: true }, { realModelCalls: 1 }]) assert.throws(() => httpsProof({ ...value, ...change }, start, end));
  const postgres = { ...value, scope: 'compiled-https-postgres', databaseProvider: 'postgres', postgresSchemasVerified: 4,
    diagnosticApplications: 9, publicEducationClientRequests: 28, publicEducationRecoveryVerified: true, publicEducationRecoveryRequests: 7,
    databaseTlsVerified: true, databaseCertificateChainVerified: true, databaseHostnameMismatchRejected: true,
    databaseUntrustedCaRejected: true, databasePlaintextRejected: true, databaseTlsApplicationsVerified: 9,
    databaseRuntimePermissionsVerified: true, databaseRestrictedApplicationsVerified: 9 };
  assert.equal(httpsProof(postgres, start, end, 'postgres').passed, 6);
  for (const change of [{ publicEducationRecoveryVerified: false }, { publicEducationRecoveryVerified: undefined },
    { publicEducationRecoveryRequests: 6 }, { publicEducationRecoveryRequests: 7.1 }, { publicEducationRecoveryRequests: undefined },
    { publicEducationClientRequests: 21 }, { publicEducationClientRequests: 27 }, { diagnosticApplications: 7 }, { postgresSchemasVerified: 3 }]) {
    assert.throws(() => httpsProof({ ...postgres, ...change }, start, end, 'postgres'));
  }
  for (const change of [{ publicEducationRecoveryVerified: true }, { publicEducationRecoveryVerified: undefined },
    { publicEducationRecoveryRequests: 7 }, { publicEducationRecoveryRequests: undefined }]) {
    assert.throws(() => httpsProof({ ...value, ...change }, start, end));
  }
  assert.equal(httpsProof(postgres, start, end, 'postgres').databaseTlsVerified, true);
  assert.equal(httpsProof(value, start, end).databaseTlsVerified, undefined);
  assert.throws(() => httpsProof(postgres, start, end));
  assert.throws(() => httpsProof(value, start, end, 'postgres'));
  assert.throws(() => httpsProof({ ...postgres, postgresSchemasVerified: 2 }, start, end, 'postgres'));
  for (const key of ['databaseTlsVerified', 'databaseCertificateChainVerified', 'databaseHostnameMismatchRejected',
    'databaseUntrustedCaRejected', 'databasePlaintextRejected', 'databaseRuntimePermissionsVerified']) {
    assert.throws(() => httpsProof({ ...postgres, [key]: false }, start, end, 'postgres'));
    assert.throws(() => httpsProof({ ...postgres, [key]: undefined }, start, end, 'postgres'));
    assert.throws(() => httpsProof({ ...value, [key]: true }, start, end));
  }
  for (const count of [0, 6, 7, 8, undefined]) assert.throws(() => httpsProof({ ...postgres, databaseTlsApplicationsVerified: count }, start, end, 'postgres'));
  for (const count of [0, 6, 7, 8, undefined]) assert.throws(() => httpsProof({ ...postgres, databaseRestrictedApplicationsVerified: count }, start, end, 'postgres'));
  assert.throws(() => httpsProof({ ...value, databaseRestrictedApplicationsVerified: 7 }, start, end));
  assert.throws(() => httpsProof({ ...value, databaseTlsApplicationsVerified: 7 }, start, end));
});

test('joint PostgreSQL/HTTPS CI requires fresh nested six-case proofs, real storage and both controllers stopped', () => {
  const date = (offset: number) => new Date(start + offset).toISOString();
  const value = { startedAt: date(0), testedAt: date(700), finishedAt: date(900), engine: 'real-postgresql', status: 'passed',
    fixtureStopped: true, httpsFixturesStopped: true, sourceWorkingDatabaseModified: false, passed: 6, failed: 0, skipped: 0, cancelled: 0,
    restarts: 0, scope: 'compiled-https-postgres', applicationRuntime: 'compiled-https-postgres', compiledBackendVerified: true,
    deploymentVerified: false, databaseProvider: 'postgres', storageEngineVerified: true, postgresSchemasVerified: 4,
    databaseTlsVerified: true, operatingSystemTrustModified: false, certificateChainVerified: true,
    hostnameMismatchRejected: true, untrustedCaRejected: true, plaintextRejected: true,
    databaseRuntimePermissionsVerified: true, databaseRestrictedApplicationsVerified: 9 };
  const https = { startedAt: date(100), testedAt: date(600), finishedAt: date(600), kind: 'local-https-engineering',
    scope: 'compiled-https-postgres', databaseProvider: 'postgres', storageEngineVerified: true, postgresSchemasVerified: 4,
    status: 'passed', passed: 6, failed: 0, skipped: 0, fixturesStopped: true, certificateChainVerified: true, secureCookieVerified: true,
    browserFlowVerified: true, applicationRestartVerified: true, compiledBackendVerified: true, publicationFlowVerified: true,
    publicationDefaultOffVerified: true, publicationRestartVerified: true, publicationBrowserFlowVerified: true,
    publicEducationClientVerified: true, publicEducationClientRequests: 28,
    publicEducationRecoveryVerified: true, publicEducationRecoveryRequests: 7,
    publicTrustVerified: false, deploymentVerified: false, operatingSystemTrustModified: false, realModelCalls: 0,
    databaseTlsVerified: true, databaseCertificateChainVerified: true, databaseHostnameMismatchRejected: true,
    databaseUntrustedCaRejected: true, databasePlaintextRejected: true, databaseTlsApplicationsVerified: 9,
    databaseRuntimePermissionsVerified: true, databaseRestrictedApplicationsVerified: 9 };
  Object.assign(https, { requestDiagnosticsVerified: true, diagnosticFaultsVerified: true, diagnosticApplications: 9, diagnosticMatchedRequests: 20 });
  assert.equal(postgresHttpsProof(value, https, start, end).passed, 6);
  for (const change of [{ startedAt: date(-1) }, { testedAt: date(-1) }, { finishedAt: date(1001) }, { finishedAt: date(699) },
    { engine: 'sqlite' }, { status: 'running' }, { fixtureStopped: false }, { httpsFixturesStopped: false }, { sourceWorkingDatabaseModified: true },
    { passed: 5 }, { failed: 1 }, { skipped: 1 }, { cancelled: 1 }, { restarts: 1 }, { scope: 'migration-api-and-recovery' },
    { applicationRuntime: 'source' }, { compiledBackendVerified: false }, { deploymentVerified: true }, { databaseProvider: 'sqlite' },
    { storageEngineVerified: false }, { postgresSchemasVerified: 2 }, { databaseRuntimePermissionsVerified: false },
    { databaseRuntimePermissionsVerified: undefined }, { databaseRestrictedApplicationsVerified: 6 }, { databaseRestrictedApplicationsVerified: undefined }]) assert.throws(() => postgresHttpsProof({ ...value, ...change }, https, start, end));
  for (const change of [{ startedAt: date(-1) }, { finishedAt: date(701) }, { finishedAt: date(99) }, { testedAt: date(601) },
    { databaseProvider: 'sqlite' }, { fixturesStopped: false }, { passed: 5 }, { skipped: 1 }, { publicationBrowserFlowVerified: false }]) {
    assert.throws(() => postgresHttpsProof(value, { ...https, ...change }, start, end));
  }
  assert.throws(() => postgresHttpsProof(value, null, start, end));
  for (const key of ['databaseTlsVerified', 'certificateChainVerified', 'hostnameMismatchRejected', 'untrustedCaRejected', 'plaintextRejected']) {
    for (const invalid of [false, undefined]) assert.throws(() => postgresHttpsProof({ ...value, [key]: invalid }, https, start, end));
  }
  assert.throws(() => postgresHttpsProof({ ...value, operatingSystemTrustModified: true }, https, start, end));
  for (const key of ['databaseTlsVerified', 'databaseCertificateChainVerified', 'databaseHostnameMismatchRejected', 'databaseUntrustedCaRejected', 'databasePlaintextRejected']) {
    assert.throws(() => postgresHttpsProof(value, { ...https, [key]: false }, start, end));
  }
  assert.throws(() => postgresHttpsProof(value, { ...https, databaseTlsApplicationsVerified: 6 }, start, end));
});
