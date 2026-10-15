import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectPackage } from './inspect-mini-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/miniprogram');
const staging = path.join(app, '.verification-builds');
// Webpack cleans its output directory. Never give it an unvalidated path or a
// link, and never replace the dist currently loaded by WeChat's simulator.
for (const directory of [root, path.join(root, 'apps'), app]) assertRealDirectory(directory);
if (!fs.existsSync(staging)) fs.mkdirSync(staging);
assertRealDirectory(staging);
const id = randomUUID(), output = path.join(staging, id);
assert.equal(path.dirname(output), staging);
fs.mkdirSync(output); assertRealDirectory(output);
const before = fingerprint(path.join(app, 'dist'));
const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), output,
  wechatRuntimeVerified: false, deviceVerified: false, activeDistUnchanged: false };
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/@tarojs/cli/bin/taro'), 'build', '--type', 'weapp'], {
      cwd: app, stdio: 'inherit', env: { ...process.env, FOOD_EDUCATION_VERIFICATION_ID: id }
    });
    child.on('error', reject); child.on('close', resolve);
  });
  assert.equal(code, 0, 'Taro verification build must exit successfully');
  report.package = inspectPackage(output);
  const css = fs.readFileSync(path.join(output, 'app.wxss'), 'utf8');
  assert.match(css, /page--large/); assert.match(css, /page--extra-large/);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Unknown verification error'; process.exitCode = 1;
} finally {
  report.activeDistUnchanged = JSON.stringify(before) === JSON.stringify(fingerprint(path.join(app, 'dist')));
  if (!report.activeDistUnchanged) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'verification-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, output, activeDistUnchanged: report.activeDistUnchanged,
    totalCompiledBytes: report.package?.totalCompiledBytes, error: report.error ?? null }));
}
function assertRealDirectory(directory) {
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Expected a real owned directory');
  assert.equal(fs.realpathSync.native(directory).toLowerCase(), path.resolve(directory).toLowerCase(), 'Directory must not redirect to a different target');
}
function fingerprint(directory) {
  if (!fs.existsSync(directory)) return null;
  assertRealDirectory(directory);
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'No links in the active compiled output');
      if (entry.isDirectory()) walk(filename);
      else { assert.ok(entry.isFile()); files.push({ path: path.relative(directory, filename), sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }); }
    }
  }
  walk(directory); return files.sort((a, b) => a.path.localeCompare(b.path));
}
