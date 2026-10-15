// Switch only a verified, owned compiled directory. Keep the complete old
// directory as a recoverable backup; never clear app data or touch project config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectPackage } from './inspect-mini-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/miniprogram');
const id = process.argv[2];
assert.equal(process.argv.length, 3, 'Expected exactly one verification UUID');
assert.match(id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const source = path.join(app, '.verification-builds', id);
const active = path.join(app, 'dist');
const evidenceParent = path.join(root, '.refactor/evidence/mini-ui-activation');
for (const directory of [root, path.join(root, 'apps'), app, path.dirname(source), source,
  path.join(root, '.refactor'), path.join(root, '.refactor/evidence'), active]) realDirectory(directory);
const report = JSON.parse(fs.readFileSync(path.join(source, 'verification-report.json'), 'utf8'));
assert.equal(report.status, 'passed');
assert.equal(report.activeDistUnchanged, true);
assert.equal(report.output, source);
assert.ok(Array.isArray(report.package.files) && report.package.files.length > 0);
const expected = report.package.files;
const current = inspectPackage(source).files.filter(file => file.path !== 'verification-report.json');
assert.deepEqual(current, expected, 'Compiled files must remain identical to the successful verification artifact');
const originalFiles = fingerprint(active);
assert.ok(originalFiles.length > 0);
assert.equal(path.basename(active), 'dist');
assert.equal(path.dirname(active), app);
if (!fs.existsSync(evidenceParent)) fs.mkdirSync(evidenceParent);
realDirectory(evidenceParent);
const run = path.join(evidenceParent, randomUUID());
assert.equal(path.dirname(run), evidenceParent);
fs.mkdirSync(run);
const backup = path.join(run, 'previous-dist');
const prepared = path.join(app, '.ui-activation-' + randomUUID());
assert.equal(path.dirname(prepared), app);
assert.equal(path.dirname(backup), run);
assert.equal(fs.existsSync(backup), false);
assert.equal(fs.existsSync(prepared), false);
fs.mkdirSync(prepared);
for (const file of expected) {
  const from = path.resolve(source, file.path), to = path.resolve(prepared, file.path);
  assert.ok(within(source, from) && within(prepared, to));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}
const verified = inspectPackage(prepared);
assert.deepEqual(verified.files, expected);
const record = { status: 'prepared', startedAt: new Date().toISOString(), source, active, backup,
  previousFileCount: originalFiles.length, nextFileCount: expected.length,
  previousFiles: originalFiles, nextFiles: expected, userStorageModified: false, projectConfigModified: false };
const recordPath = path.join(run, 'activation.json');
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
// Revalidate both exact move targets and all descendant types immediately before
// the reversible directory moves. Stop on a locked file; no stronger primitive.
realDirectory(active); realDirectory(prepared); realDirectory(run);
assert.deepEqual(fingerprint(active), originalFiles, 'Active output changed while preparing; stop');
assert.deepEqual(inspectPackage(prepared).files, expected);
console.log(JSON.stringify({ action: 'reversible_compiled_directory_switch', active, backup,
  previousFileCount: originalFiles.length, nextFileCount: expected.length }));
fs.renameSync(active, backup);
try { fs.renameSync(prepared, active); }
catch (error) {
  assert.equal(fs.existsSync(active), false, 'Unexpected active path after failed move; stop');
  fs.renameSync(backup, active);
  throw error;
}
assert.deepEqual(inspectPackage(active).files, expected);
record.status = 'activated'; record.finishedAt = new Date().toISOString();
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ status: record.status, recordPath, totalCompiledBytes: verified.totalCompiledBytes,
  backupRetained: true, userStorageModified: false }));

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function realDirectory(directory) {
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Expected a real directory');
  assert.equal(fs.realpathSync.native(directory).toLowerCase(), path.resolve(directory).toLowerCase(), 'Redirected target refused');
}
function fingerprint(directory) {
  realDirectory(directory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name), stat = fs.lstatSync(filename);
    assert.ok(!entry.isSymbolicLink() && !stat.isSymbolicLink(), 'Linked compiled entry refused');
    if (entry.isDirectory()) return fingerprint(filename).map(file => ({ ...file, path: entry.name + '/' + file.path }));
    assert.ok(entry.isFile());
    return [{ path: entry.name, bytes: stat.size, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
