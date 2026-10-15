import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { parseCiProfile, ciPlan, ciScriptArgs, ciEnvironment, runCi, tapProof, postgresProof, browserExecutionProof, offlineProof, httpsProof, postgresHttpsProof, type CiReport } from './ci-core.js';
import { httpsOwnedReportPath } from './https-test-plan.js';

async function main() {
  const profile = parseCiProfile(process.argv.slice(2)); const root = process.cwd(); const mini = resolve(root, '../zhongyi');
  if (!existsSync(join(root, 'server/app.ts')) || !existsSync(join(mini, 'tools/version-core.js'))) throw new Error('Run from zhongyi-platform with sibling zhongyi present.');
  const npmCli = process.env.npm_execpath;
  if (!npmCli || basename(npmCli) !== 'npm-cli.js' || !lstatSync(npmCli).isFile()) throw new Error('Run through the documented npm run ci:* entry, not a shell-built command.');
  const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  function ordinaryDirectory(path: string) {
    for (let current = path; ; current = dirname(current)) {
      if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink() || !same(realpathSync(current), current)) throw new Error('CI report directories must not traverse links.');
      if (dirname(current) === current) break;
    }
  }
  ordinaryDirectory(root);
  const local = join(root, '.local'); if (!existsSync(local)) mkdirSync(local); ordinaryDirectory(local);
  const runs = join(local, 'ci-runs'); if (!existsSync(runs)) mkdirSync(runs); ordinaryDirectory(runs);
  const directory = join(runs, `${profile}-${randomUUID()}`); mkdirSync(directory); ordinaryDirectory(directory);
  const filename = join(directory, 'report.json');
  const latest = join(local, `ci-results.${profile}.latest.json`);
  const report: CiReport & { sourceScope: 'working-tree' | 'public-source'; privateCorpusVerified: boolean } = {
    sourceScope: profile === 'core' ? 'working-tree' : 'public-source', privateCorpusVerified: false,
    schemaVersion: 1, profile, runId: basename(directory), startedAt: new Date().toISOString(), finishedAt: null,
    runtime: { node: process.version, platform: process.platform }, status: 'running',
    commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA! : null,
    deploymentVerified: false, externalAiEnabled: false, steps: ciPlan(profile).map((step) => ({ ...step, status: 'pending' })) };
  const env = ciEnvironment(process.env, join(directory, 'unused-working-database.sqlite'));
  env.CI_BROWSER_REPORT = join(directory, 'browser-results.json');
  const persist = (value: CiReport) => {
    for (const path of [filename, latest]) {
      if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || !same(realpathSync(path), path))) throw new Error('Unsafe CI report file');
      writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    }
  };
  const result = await runCi(report, async (step, start) => {
    console.log(`[ci:${profile}] ${step.id}: npm run ${step.script}`);
    if (step.proof === 'browser' && existsSync(join(directory, 'browser-artifacts'))) throw new Error('Browser artifacts must use a fresh, unused directory.');
    const child = spawn(process.execPath, [npmCli, ...ciScriptArgs(step, directory)], { cwd: step.project === 'mini' ? mini : root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = ''; child.stdout.on('data', (chunk) => { process.stdout.write(chunk); tail = (tail + chunk.toString()).slice(-256 * 1024); });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    const [code] = await once(child, 'close'); const end = Date.now();
    if (code !== 0) return { code };
    const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    let proof;
    if (step.proof === 'tap') proof = tapProof(tail);
    if (step.proof === 'offline') proof = offlineProof(json(join(local, 'assistant-contract-eval.latest.json')), start, end);
    if (step.proof === 'https') {
      proof = httpsProof(json(join(local, 'https-test-results.latest.json')), start, end);
      if (proof.passed !== tapProof(tail).passed) throw new Error('HTTPS report and actual test counts differ.');
    }
    if (step.proof === 'postgres-https') {
      const pg = json(join(local, 'postgres-https-test-results.latest.json'));
      const httpsPath = httpsOwnedReportPath(root, pg.httpsReportPath);
      ordinaryDirectory(dirname(httpsPath));
      if (!lstatSync(httpsPath).isFile() || lstatSync(httpsPath).isSymbolicLink() || !same(realpathSync(httpsPath), httpsPath)) throw new Error('Unsafe HTTPS proof file.');
      const https = json(httpsPath);
      if (!same(https.directory, dirname(httpsPath))) throw new Error('HTTPS proof directory differs from the owned report.');
      proof = postgresHttpsProof(pg, https, start, end);
      if (proof.passed !== tapProof(tail).passed) throw new Error('Joint PostgreSQL/HTTPS report and actual test counts differ.');
    }
    if (step.proof === 'postgres') {
      proof = postgresProof(json(join(local, 'postgres-test-results.latest.json')), start, end);
      if (proof.passed !== tapProof(tail).passed) throw new Error('PostgreSQL report and actual test counts differ.');
    }
    if (step.proof === 'browser' || step.proof === 'postgres-browser') {
      proof = browserExecutionProof(json(env.CI_BROWSER_REPORT!), tail, code, start, end);
      if (step.proof === 'postgres-browser') {
        const pg = postgresProof(json(join(local, 'postgres-browser-test-results.latest.json')), start, end, true);
        if (pg.passed !== proof.passed) throw new Error('Browser and PostgreSQL proof counts differ.');
        proof = { ...proof, ...pg };
      }
    }
    return { code, proof };
  }, persist);
  report.privateCorpusVerified = profile === 'core' && result.status === 'passed'; persist(report);
  console.log(JSON.stringify({ profile, status: result.status, report: filename, sourceScope: report.sourceScope,
    privateCorpusVerified: report.privateCorpusVerified, professionalApprovalGranted: false, deploymentVerified: false }));
  if (result.status !== 'passed') process.exitCode = 1;
}
main().catch(() => { console.error('CI verification failed. No deployment performed; inspect the last safe report and process output.'); process.exitCode = 1; });
