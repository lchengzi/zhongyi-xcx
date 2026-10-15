import { basename, dirname, isAbsolute, join } from 'node:path';

export const CI_PROFILES = ['core', 'public-core', 'postgres', 'browser', 'postgres-browser', 'https'] as const;
export type CiProfile = typeof CI_PROFILES[number];
export interface CiStep { id: string; project: 'platform' | 'mini'; script: string; proof?: 'tap' | 'offline' | 'postgres' | 'browser' | 'postgres-browser' | 'https' | 'postgres-https' }
export interface CiProof { passed?: number; failed?: number; skipped?: number; restarts?: number; fixtureStopped?: boolean; databaseTlsVerified?: true; kind?: 'offline-contract' | 'local-https-engineering'; realModelCalls?: 0; modelQualityMeasured?: false; certificateChainVerified?: true; secureCookieVerified?: true; browserFlowVerified?: true; applicationRestartVerified?: true; publicTrustVerified?: false; publicEducationClientVerified?: true; publicEducationClientRequests?: number }
export interface CiStepResult extends CiStep { status: 'pending' | 'running' | 'passed' | 'failed' | 'not_run'; durationMs?: number; exitCode?: number | null; proofResult?: CiProof; error?: string }
export interface CiReport {
  schemaVersion: 1; profile: CiProfile; runId: string; startedAt: string; finishedAt: string | null;
  runtime: { node: string; platform: string }; status: 'running' | 'passed' | 'failed';
  commit: string | null; deploymentVerified: false; externalAiEnabled: false; steps: CiStepResult[];
}
export function ciPlan(profile: CiProfile): CiStep[] {
  if (profile === 'public-core') return ciPlan('core').map(step => step.project === 'mini'
    ? { ...step, id: `public-${step.id}`, script: step.script === 'check' ? 'check:public' : 'test:public' } : step);
  if (profile === 'core') return [
    { id: 'catalog', project: 'platform', script: 'catalog:check' },
    { id: 'types', project: 'platform', script: 'typecheck' },
    { id: 'api-sqlite-contracts', project: 'platform', script: 'test', proof: 'tap' },
    { id: 'offline-assistant-contracts', project: 'platform', script: 'eval:assistant', proof: 'offline' },
    { id: 'mini-project', project: 'mini', script: 'check' },
    { id: 'mini-regressions', project: 'mini', script: 'test' },
    { id: 'web-api-build', project: 'platform', script: 'build' },
    { id: 'compiled-api-diagnostics', project: 'platform', script: 'test:request-log:runtime', proof: 'tap' }
  ];
  if (profile === 'postgres') return [{ id: 'postgres-migration-api-recovery', project: 'platform', script: 'test:postgres', proof: 'postgres' }];
  if (profile === 'browser') return [{ id: 'web-build', project: 'platform', script: 'build' }, { id: 'edge-sqlite', project: 'platform', script: 'test:browser', proof: 'browser' }];
  if (profile === 'postgres-browser') return [{ id: 'edge-postgres', project: 'platform', script: 'test:postgres:browser', proof: 'postgres-browser' }];
  if (profile === 'https') return [
    { id: 'local-https-cookie-readiness-browser', project: 'platform', script: 'test:https', proof: 'https' },
    { id: 'local-postgres-https-cookie-readiness-browser', project: 'platform', script: 'test:postgres:https', proof: 'postgres-https' }
  ];
  throw new Error('Unknown CI profile');
}
export function ciScriptArgs(step: CiStep, directory: string): string[] {
  const args = ['run', step.script];
  if (step.proof === 'browser') {
    if (!isAbsolute(directory) || !/^browser-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(basename(directory)) ||
      basename(dirname(directory)) !== 'ci-runs' || basename(dirname(dirname(directory))) !== '.local') throw new Error('Owned fresh browser CI directory required');
    args.push('--', `--output=${join(directory, 'browser-artifacts')}`);
  }
  return args;
}
export function parseCiProfile(args: string[]): CiProfile {
  if (args.length !== 1 || !(CI_PROFILES as readonly string[]).includes(args[0])) throw new Error('Specify exactly one CI profile: core, public-core, postgres, browser, postgres-browser, https.');
  return args[0] as CiProfile;
}
export function ciEnvironment(original: NodeJS.ProcessEnv, isolatedDbPath: string): NodeJS.ProcessEnv {
  // Leave NODE_ENV absent: Vite must set production for build, while HTTP test
  // fixtures remain non-production. NODE_ENV=test would bundle development React.
  const isolated = { ...original };
  for (const name of Object.keys(isolated)) if (name.startsWith('PHOTO_BACKUP_') || name.startsWith('PHOTO_RESOURCE_BACKUP_')) delete isolated[name];
  return { ...isolated, CI: 'true', NODE_ENV: undefined, AUTH_MODE: 'accounts', DB_PATH: isolatedDbPath,
    PRIVATE_PHOTO_ROOT: undefined, PRIVATE_PHOTO_MANIFEST: undefined, PG_INITIALIZATION_DIAGNOSTICS: 'false',
    PHOTO_DERIVATIVE_ROOT: undefined, PHOTO_PUBLICATION_ROOT: undefined, ENABLE_PHOTO_PUBLICATION: 'false',
    DATABASE_PROVIDER: 'sqlite', DATABASE_URL: '', DATABASE_SCHEMA: '', PG_TEST_DATABASE_URL: '', PG_TEST_NONCE: '', EDUCATION_PUBLICATION_ENABLED: 'false',
    PORT: '', BIND_HOST: '', DATABASE_URL_FILE: '', DATABASE_RUNTIME_URL_FILE: '', DATABASE_OWNER_URL_FILE: '', TLS_MODE: '', TLS_CERT_FILE: '', TLS_KEY_FILE: '', TLS_HEALTH_CA_FILE: '', ALLOWED_ORIGINS: '', EDITOR_TOKEN: '', BOOTSTRAP_PASSWORD: '', BACKUP_ENCRYPTION_KEY: '', BACKUP_ENCRYPTION_KEY_FILE: '', BACKUP_INPUT_DIRECTORY: '', BACKUP_OUTPUT_DIRECTORY: '',
    HTTPS_TEST_DIRECTORY: '', HTTPS_TEST_NONCE: '', HTTPS_TEST_PASSWORD: '', HTTPS_TEST_DATABASE_PROVIDER: '', HTTPS_TEST_POSTGRES_SCHEMA: '', HTTPS_TEST_RUNTIME_DATABASE_URL: '', NODE_TLS_REJECT_UNAUTHORIZED: '1',
    AI_PROVIDER: 'disabled', AI_EXTERNAL_ENABLED: 'false', OPENAI_API_KEY: '', AI_MODEL: '',
    AI_INPUT_USD_PER_MILLION: '', AI_OUTPUT_USD_PER_MILLION: '', AI_DAILY_CALL_LIMIT: '20', AI_ACTOR_DAILY_CALL_LIMIT: '5' };
}
export function tapProof(output: string): CiProof {
  const count = (key: string) => { const value = new RegExp(`^# ${key} (\\d+)\\r?$`, 'm').exec(output); return value ? Number(value[1]) : NaN; };
  const total = count('tests'); const passed = count('pass'); const failed = count('fail'); const skipped = count('skipped');
  if (!Number.isSafeInteger(total) || total <= 0 || passed !== total || failed !== 0 || skipped !== 0 || count('cancelled') !== 0 || count('todo') !== 0) throw new Error('Node test proof missing, incomplete or not fully passed.');
  return { passed, failed, skipped };
}
function fresh(value: unknown, start: number, end: number): boolean {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time >= start && time <= end;
}
export function postgresProof(value: any, start: number, end: number, browser = false): CiProof {
  if (!value || !fresh(value.testedAt, start, end) || value.engine !== 'real-postgresql' || value.status !== 'passed' || value.fixtureStopped !== true ||
    value.sourceWorkingDatabaseModified !== false || !Number.isSafeInteger(value.passed) || value.passed <= 0 || value.failed !== 0 ||
    value.scope !== (browser ? 'react-browser' : 'migration-api-and-recovery') || !Number.isSafeInteger(value.restarts) || (browser ? value.restarts !== 0 : value.restarts < 3)) throw new Error('Fresh, complete PostgreSQL proof with confirmed fixture shutdown is required.');
  if (!browser && (value.databaseTlsVerified !== true || value.operatingSystemTrustModified !== false ||
    ['certificateChainVerified', 'hostnameMismatchRejected', 'untrustedCaRejected', 'plaintextRejected'].some((key) => value[key] !== true))) {
    throw new Error('Full PostgreSQL proof requires authenticated TLS and real rejection cases without system trust changes.');
  }
  return { passed: value.passed, failed: 0, restarts: value.restarts, fixtureStopped: true, ...(!browser ? { databaseTlsVerified: true } : {}) };
}
export function browserProof(value: any, start: number, end: number): CiProof {
  const stats = value?.stats;
  if (!stats || !fresh(stats.startTime, start, end) || !Number.isSafeInteger(stats.expected) || stats.expected <= 0 ||
    stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 || !Array.isArray(value.errors) || value.errors.length !== 0) throw new Error('Fresh browser proof without skips, flakes or errors is required.');
  return { passed: stats.expected, failed: 0, skipped: 0 };
}
export function browserExecutionProof(value: unknown, output: string, code: number | null, start: number, end: number): CiProof {
  if (code !== 0) throw new Error('Browser child did not exit successfully');
  const proof = browserProof(value, start, end);
  const config = (value as { config?: { forbidOnly?: unknown } } | null)?.config;
  const consoleCount = Number(/(?:^|\n)\s*(\d+) passed/.exec(output)?.[1] || 0);
  if (config?.forbidOnly !== true || consoleCount !== proof.passed) throw new Error('Browser JSON and console must agree with focused tests forbidden');
  return proof;
}
export function offlineProof(value: any, start: number, end: number): CiProof {
  if (!value || !fresh(value.testedAt, start, end) || value.kind !== 'offline-contract' || value.realModelCalls !== 0 || value.externalTransfers !== 0 ||
    value.modelQualityMeasured !== false || value.costMeasured !== false || !Number.isSafeInteger(value.caseCount) || value.caseCount <= 0 ||
    value.passed !== value.caseCount || value.failed !== 0 || !Array.isArray(value.results) || value.results.length !== value.caseCount ||
    value.results.some((item: any) => !item || item.passed !== true)) throw new Error('Fresh fully passing offline contract proof is required; it is not real model quality.');
  return { kind: 'offline-contract', passed: value.passed, failed: 0, realModelCalls: 0, modelQualityMeasured: false };
}
export function httpsProof(value: any, start: number, end: number, provider: 'sqlite' | 'postgres' = 'sqlite'): CiProof {
  if (!value || !fresh(value.testedAt, start, end) || value.kind !== 'local-https-engineering' || value.status !== 'passed' ||
    !Number.isSafeInteger(value.passed) || value.passed <= 0 || value.failed !== 0 || value.skipped !== 0 || value.fixturesStopped !== true ||
    value.certificateChainVerified !== true || value.secureCookieVerified !== true || value.browserFlowVerified !== true || value.applicationRestartVerified !== true ||
    value.scope !== `compiled-https-${provider}` || value.databaseProvider !== provider || value.storageEngineVerified !== true ||
    value.postgresSchemasVerified !== (provider === 'postgres' ? 4 : 0) || value.passed !== 6 || value.compiledBackendVerified !== true || value.publicationFlowVerified !== true ||
    value.publicationDefaultOffVerified !== true || value.publicationRestartVerified !== true || value.publicationBrowserFlowVerified !== true ||
    value.publicEducationClientVerified !== true || !Number.isSafeInteger(value.publicEducationClientRequests) || value.publicEducationClientRequests < (provider === 'postgres' ? 28 : 21) ||
    value.publicEducationRecoveryVerified !== (provider === 'postgres') || value.publicEducationRecoveryRequests !== (provider === 'postgres' ? 7 : 0) ||
    value.requestDiagnosticsVerified !== true || value.diagnosticFaultsVerified !== true || value.diagnosticApplications !== (provider === 'postgres' ? 9 : 7) ||
    value.databaseTlsApplicationsVerified !== (provider === 'postgres' ? 9 : 0) ||
    value.databaseRestrictedApplicationsVerified !== (provider === 'postgres' ? 9 : 0) ||
    value.databaseRuntimePermissionsVerified !== (provider === 'postgres') ||
    ['databaseTlsVerified', 'databaseCertificateChainVerified', 'databaseHostnameMismatchRejected', 'databaseUntrustedCaRejected',
      'databasePlaintextRejected'].some((key) => value[key] !== (provider === 'postgres')) ||
    !Number.isSafeInteger(value.diagnosticMatchedRequests) || value.diagnosticMatchedRequests < 7 ||
    value.publicTrustVerified !== false || value.deploymentVerified !== false || value.operatingSystemTrustModified !== false || value.realModelCalls !== 0) throw new Error('Fresh complete local HTTPS engineering proof required; public trust/deployment remain unverified.');
  return { kind: 'local-https-engineering', passed: value.passed, failed: 0, skipped: 0, fixtureStopped: true, certificateChainVerified: true,
    secureCookieVerified: true, browserFlowVerified: true, applicationRestartVerified: true, publicTrustVerified: false, realModelCalls: 0,
    publicEducationClientVerified: true, publicEducationClientRequests: value.publicEducationClientRequests,
    ...(provider === 'postgres' ? { databaseTlsVerified: true, databaseRuntimePermissionsVerified: true } : {}) };
}
export function postgresHttpsProof(value: any, https: any, start: number, end: number): CiProof {
  if (!value || !fresh(value.startedAt, start, end) || !fresh(value.testedAt, start, end) || !fresh(value.finishedAt, start, end) ||
    Date.parse(value.startedAt) > Date.parse(value.testedAt) || Date.parse(value.testedAt) > Date.parse(value.finishedAt) ||
    value.engine !== 'real-postgresql' || value.status !== 'passed' || value.fixtureStopped !== true || value.httpsFixturesStopped !== true ||
    value.sourceWorkingDatabaseModified !== false || value.passed !== 6 || value.failed !== 0 || value.skipped !== 0 || value.cancelled !== 0 ||
    value.restarts !== 0 || value.scope !== 'compiled-https-postgres' || value.applicationRuntime !== 'compiled-https-postgres' ||
    value.compiledBackendVerified !== true || value.deploymentVerified !== false || value.databaseProvider !== 'postgres' ||
    value.storageEngineVerified !== true || value.postgresSchemasVerified !== 4 ||
    value.databaseRuntimePermissionsVerified !== true || value.databaseRestrictedApplicationsVerified !== 9 ||
    value.databaseTlsVerified !== true || value.operatingSystemTrustModified !== false ||
    ['certificateChainVerified', 'hostnameMismatchRejected', 'untrustedCaRejected', 'plaintextRejected'].some((key) => value[key] !== true) ||
    !fresh(https?.startedAt, Date.parse(value.startedAt), Date.parse(value.testedAt)) ||
    !fresh(https?.finishedAt, Date.parse(https?.startedAt), Date.parse(value.testedAt))) {
    throw new Error('Fresh joint PostgreSQL/HTTPS proof with both fixtures stopped is required.');
  }
  const proof = httpsProof(https, Date.parse(https.startedAt), Date.parse(https.finishedAt), 'postgres');
  return { ...proof, restarts: 0 };
}
export async function runCi(report: CiReport, execute: (step: CiStep, start: number) => Promise<{ code: number | null; proof?: CiProof }>, persist: (report: CiReport) => void, now = Date.now): Promise<CiReport> {
  if (!report.steps.length) { report.status = 'failed'; report.finishedAt = new Date(now()).toISOString(); persist(report); return report; }
  persist(report);
  for (let index = 0; index < report.steps.length; index++) {
    const step = report.steps[index]; const start = now(); step.status = 'running'; persist(report);
    try {
      const result = await execute(step, start); step.exitCode = result.code;
      if (result.code !== 0) throw new Error('CI step failed; see its process output.');
      if (step.proof && !result.proof) throw new Error('Required fresh test proof is missing.');
      step.proofResult = result.proof; step.status = 'passed';
    } catch {
      // No raw exceptions/arguments/env or private rows enter persisted summaries.
      step.status = 'failed'; step.error = 'Step failed or required fresh verification was not satisfied.';
      for (const remaining of report.steps.slice(index + 1)) remaining.status = 'not_run';
      report.status = 'failed';
    }
    step.durationMs = Math.max(0, now() - start); persist(report);
    if (report.status === 'failed') break;
  }
  if (report.status === 'running') report.status = 'passed';
  report.finishedAt = new Date(now()).toISOString(); persist(report); return report;
}
