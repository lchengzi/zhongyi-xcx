import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, sha256, stageWorkspaceSource, verifyWorkspaceSource } from './workspace-source.mjs';

assert.equal(process.argv.length, 2, 'No arbitrary input or output paths are accepted');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); plain(root);
for (const part of ['.refactor', '.refactor/deliveries']) { const path = join(root, part); if (!existsSync(path)) mkdirSync(path); plain(path); }
const evidence = join(root, '.refactor/deliveries', `source-${randomUUID()}`); mkdirSync(evidence); plain(evidence);
plain(tmpdir()); const temporary = mkdtempSync(join(tmpdir(), 'food-education-source-export-')); plain(temporary);
const source = join(temporary, 'source'), extracted = join(temporary, 'extracted'); mkdirSync(source); mkdirSync(extracted);
const archive = join(evidence, 'food-education-source.zip');
const report = { schemaVersion: 'workspace-source-export.1', status: 'running', phase: 'source-copy', startedAt: new Date().toISOString(),
  source, extracted, archive, dependenciesCopied: false, privateResearchCopied: false, credentialsOrDatabasesCopied: false,
  actualWeChatConfigCopied: false, networkRequests: 0, remoteUploadPerformed: false, validationProcessId: null };
const persist = () => writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
persist(); console.log(`Source delivery: ${evidence}`);
try {
  const files = stageWorkspaceSource(root, source);
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 'food-source-manifest.1', generatedAt: new Date().toISOString(), files,
    excluded: ['private research/media', 'databases/accounts/credentials', 'dependencies/builds/caches', 'actual WeChat configuration', 'private execution evidence/plans'],
    contentApprovalGranted: false, deploymentVerified: false }, null, 2));
  writeFileSync(join(source, 'SOURCE_MANIFEST.json'), manifestBytes, { flag: 'wx' });
  const inventory = [...files, { path: 'SOURCE_MANIFEST.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) }];
  const inventoryPath = join(evidence, 'inventory.json'); writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), { flag: 'wx' });
  const resultPath = join(evidence, 'archive-check.json'), job = join(evidence, 'job.json');
  writeFileSync(job, JSON.stringify({ source, extracted, archive, inventory: inventoryPath, result: resultPath }, null, 2), { flag: 'wx' });
  report.phase = 'archive-and-extract'; report.sourceFiles = files.length; persist();
  const log = createWriteStream(join(evidence, 'archive.log'), { flags: 'wx' });
  let code;
  try {
    code = await new Promise((done, reject) => {
      const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(root, 'tools/source-archive.ps1'), '-Job', job], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      report.validationProcessId = child.pid ?? null; persist();
      child.stdout.on('data', bytes => log.write(bytes)); child.stderr.on('data', bytes => log.write(bytes));
      child.once('error', reject); child.once('close', done);
    });
  } finally { await new Promise((done, reject) => { log.once('error', reject); log.end(done); }); }
  report.archiveToolExitCode = code; assert.equal(code, 0, 'Archive validation failed; retained log available');
  const checked = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(checked.status, 'passed'); assert.equal(checked.files, inventory.length);
  report.phase = 'source-integrity'; persist();
  verifyWorkspaceSource(root, source, files); verifyWorkspaceSource(root, extracted, files);
  assert.equal(sha256(readFileSync(join(extracted, 'SOURCE_MANIFEST.json'))), sha256(manifestBytes));
  report.archiveFiles = checked.files; report.archiveBytes = statSync(archive).size; report.archiveSha256 = sha256(readFileSync(archive));
  report.exactInventoryVerified = true; report.extractedSourceAndLocksMatch = true; report.workingSourceUnchanged = true;
  report.status = 'passed'; report.phase = 'finished';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Export failed'; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); persist(); console.log(JSON.stringify({ status: report.status, evidence, archive, error: report.error ?? null })); }
