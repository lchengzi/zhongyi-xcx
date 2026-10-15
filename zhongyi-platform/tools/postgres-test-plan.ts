import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { browserExecutionProof, tapProof } from './ci-core.js';

export function postgresTestPlan(args: string[]) {
  if (args.length > 1 || (args.length === 1 && !['--browser', '--publication-http', '--https', '--permissions'].includes(args[0]))) {
    throw new Error('Specify no arguments, --browser, --publication-http, --https, or --permissions; arbitrary test paths are not supported.');
  }
  const mode = args[0] === '--browser' ? 'browser' : args[0] === '--publication-http' ? 'publication-http' : args[0] === '--https' ? 'https' : args[0] === '--permissions' ? 'permissions' : 'full';
  return {
    mode,
    browser: mode === 'browser',
    reportPath: mode === 'browser' ? '.local/postgres-browser-test-results.latest.json' :
      mode === 'publication-http' ? '.local/postgres-publication-http-test-results.latest.json' : mode === 'https' ? '.local/postgres-https-test-results.latest.json' : mode === 'permissions' ? '.local/postgres-permissions-test-results.latest.json' : '.local/postgres-test-results.latest.json',
    scope: mode === 'browser' ? 'react-browser' : mode === 'publication-http' ? 'publication-http' : mode === 'https' ? 'compiled-https-postgres' : mode === 'permissions' ? 'runtime-role-separation' : 'migration-api-and-recovery',
    childArgs: mode === 'browser' ? ['node_modules/@playwright/test/cli.js', 'test'] :
      mode === 'https' ? ['--import', 'tsx', 'tools/test-https.ts', '--postgres'] :
        ['--import', 'tsx', mode === 'publication-http' ? 'tests/postgres-publication-http.test.ts' : mode === 'permissions' ? 'tests/postgres-permissions.test.ts' : 'tests/postgres.test.ts']
  } as const;
}

export function postgresPermissionsProof(output: string, code: number | null) {
  if (code !== 0) throw new Error('Runtime permission verification did not exit successfully');
  const proof = tapProof(output);
  if (proof.passed !== 13) throw new Error('All nine permission/recovery and four actual TLS cases must pass');
  return { passed: 13, failed: 0, skipped: 0, cancelled: 0 } as const;
}

export function postgresBrowserReportPath(root: string, directory: string, inherited?: string): string {
  if (!isAbsolute(root) || !isAbsolute(directory)) throw new Error('Absolute owned paths required');
  const local = resolve(root, '.local');
  const inside = (parent: string, target: string) => {
    const path = relative(parent, target); return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  if (!inside(join(local, 'postgres-tests'), directory) || !/^cluster-[A-Za-z0-9_-]{6}$/.test(basename(directory))) throw new Error('Owned test cluster directory required');
  const filename = inherited || join(directory, 'browser-results.json');
  if (!isAbsolute(filename) || !inside(local, filename) || basename(filename) !== 'browser-results.json') throw new Error('Browser proof must use a fresh local browser-results.json');
  return resolve(filename);
}

export function postgresBrowserProof(value: unknown, output: string, code: number | null, start: number, end: number) {
  return browserExecutionProof(value, output, code, start, end);
}

// This narrow result can never substitute for the complete PostgreSQL profile.
// The shared registration currently contains exactly seven behavioral cases.
export function publicationHttpProof(output: string, code: number | null) {
  if (code !== 0) throw new Error('Publication HTTP child did not exit successfully');
  const proof = tapProof(output);
  if (proof.passed !== 7) throw new Error('All seven shared publication HTTP cases must pass');
  return { passed: 7, failed: 0, skipped: 0, cancelled: 0 } as const;
}
