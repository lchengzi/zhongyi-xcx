import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tapProof } from './ci-core.js';
import { assertNoLinks } from '../server/demo-secrets.js';

export function httpsTestBuildPlan(root: string, directory: string) {
  const owned = relative(join(root, '.local', 'https-tests'), directory);
  if (!isAbsolute(root) || !isAbsolute(directory) || !owned || owned === '..' || owned.startsWith(`..${sep}`) || isAbsolute(owned) ||
    !/^run-[A-Za-z0-9_-]{6}$/.test(basename(directory))) throw new Error('Fresh owned HTTPS directory required');
  return {
    backend: resolve(directory, 'build'), frontend: resolve(directory, 'dist'),
    commands: [
      [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.server.json'), '--outDir', resolve(directory, 'build')],
      [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', resolve(directory, 'dist')]
    ]
  };
}

export function httpsTestProvider(args: string[]): 'sqlite' | 'postgres' {
  if (args.length === 0) return 'sqlite';
  if (args.length === 1 && args[0] === '--postgres') return 'postgres';
  throw new Error('Only the default SQLite or owned --postgres HTTPS scope is supported');
}

export function ownedHttpsPostgres(env: NodeJS.ProcessEnv, connected: boolean) {
  const fail = () => { throw new Error('Live isolated PostgreSQL controller required; no working database or SQLite fallback'); };
  if (!connected || !/^[a-f0-9]{32}$/.test(env.PG_TEST_NONCE || '') || !env.PG_TEST_DATABASE_URL) return fail();
  let url: URL; try { url = new URL(env.PG_TEST_DATABASE_URL); } catch { return fail(); }
  if (url.protocol !== 'postgresql:' || url.hostname !== 'localhost' || url.username !== 'postgres_fixture' ||
    !/^[a-f0-9]{64}$/.test(url.password) || url.pathname !== '/postgres' || !/^\d+$/.test(url.port) ||
    Number(url.port) < 1 || Number(url.port) > 65535 || url.hash || url.searchParams.get('sslmode') !== 'verify-full' ||
    [...url.searchParams.keys()].sort().join() !== 'sslmode,sslrootcert') return fail();
  const caFile = url.searchParams.get('sslrootcert') || '';
  const owned = relative(resolve(import.meta.dirname, '../.local/postgres-tests'), caFile).split(sep);
  if (!isAbsolute(caFile) || resolve(caFile) !== caFile || owned.length !== 2 || !/^cluster-[A-Za-z0-9_-]{6}$/.test(owned[0]) || owned[1] !== 'ca.pem') return fail();
  try { assertNoLinks(caFile); } catch { return fail(); }
  return { connection: env.PG_TEST_DATABASE_URL, controllerNonce: env.PG_TEST_NONCE!, caFile };
}

export function httpsOwnedReportPath(root: string, filename: string) {
  if (!isAbsolute(filename) || basename(filename) !== 'result.json') throw new Error('Owned HTTPS result.json required');
  const directory = resolve(filename, '..'); httpsTestBuildPlan(root, directory);
  return resolve(filename);
}

export function httpsTestProof(output: string, code: number | null, value: unknown, nonce: string, provider: 'sqlite' | 'postgres' = 'sqlite') {
  const tap = tapProof(output);
  const proof = value as Record<string, unknown> | null;
  if (code !== 0 || tap.passed !== 6 || !proof || proof.type !== 'https-proof' || proof.nonce !== nonce || proof.databaseProvider !== provider ||
    proof.postgresSchemasVerified !== (provider === 'postgres' ? 4 : 0) || proof.diagnosticApplications !== (provider === 'postgres' ? 9 : 7) ||
    proof.databaseTlsApplicationsVerified !== (provider === 'postgres' ? 9 : 0) ||
    proof.databaseRestrictedApplicationsVerified !== (provider === 'postgres' ? 9 : 0) ||
    proof.databaseRuntimePermissionsVerified !== (provider === 'postgres') ||
    ['databaseTlsVerified', 'databaseCertificateChainVerified', 'databaseHostnameMismatchRejected', 'databaseUntrustedCaRejected',
      'databasePlaintextRejected'].some((key) => proof[key] !== (provider === 'postgres')) ||
    !Number.isSafeInteger(proof.diagnosticMatchedRequests) || Number(proof.diagnosticMatchedRequests) < 7 ||
    !Number.isSafeInteger(proof.publicEducationClientRequests) || Number(proof.publicEducationClientRequests) < (provider === 'postgres' ? 28 : 21) ||
    proof.publicEducationRecoveryVerified !== (provider === 'postgres') ||
    proof.publicEducationRecoveryRequests !== (provider === 'postgres' ? 7 : 0) ||
    ['fixturesStopped', 'storageEngineVerified', 'certificateChainVerified', 'secureCookieVerified', 'browserFlowVerified', 'applicationRestartVerified',
      'publicationFlowVerified', 'publicationDefaultOffVerified', 'publicationRestartVerified', 'publicationBrowserFlowVerified',
      'requestDiagnosticsVerified', 'diagnosticFaultsVerified', 'publicEducationClientVerified'].some((key) => proof[key] !== true)) {
    throw new Error('All six compiled HTTPS cases and authenticated teardown proof required');
  }
  return tap;
}
