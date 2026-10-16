import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const download = require('download'), downloadRepo = require('download-git-repo');
const downloadRequire = createRequire(require.resolve('download'));
const extract = downloadRequire('decompress');
const fixture = mkdtempSync(join(tmpdir(), 'food-archive-regression-'));
// Every attack target is inside this newly owned fixture. Retain it: no recursive cleanup.
function output(name) { const path = join(fixture, name); assert(!existsSync(path)); mkdirSync(path); return path; }
function tar(entries) {
  const blocks = [];
  for (const { path, data = '', mode = 0o644, type = '0', link = '' } of entries) {
    const bytes = Buffer.from(data), h = Buffer.alloc(512);
    h.write(path, 0, 100); h.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8);
    h.write('0000000\0', 108, 8); h.write('0000000\0', 116, 8);
    h.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12); h.write('00000000000\0', 136, 12);
    h.fill(32, 148, 156); h.write(type, 156, 1); h.write(link, 157, 100); h.write('ustar\0', 257, 6); h.write('00', 263, 2);
    h.write(h.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [path, text] of entries) {
    const name = Buffer.from(path), data = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, name, data); central.push(c, name); offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const sample = zip([['template-main/readme.txt', 'template content'], ['template-main/parts/part.txt', 'edible part']]);

test('legacy download resolves the callable adapter and exact maintained implementation', () => {
  assert.equal(typeof extract, 'function');
  assert.equal(realpathSync(downloadRequire.resolve('decompress')), realpathSync(require.resolve('../../packages/archive-extractor-compat/index.cjs')));
  const manifest = JSON.parse(readFileSync(downloadRequire.resolve('decompress/package.json')));
  assert.equal(manifest.name, '@food-education/archive-extractor-compat');
  const adapterRequire = createRequire(downloadRequire.resolve('decompress'));
  const patched = JSON.parse(readFileSync(join(dirname(adapterRequire.resolve('@xhmikosr/decompress')), 'package.json')));
  assert.equal(patched.name, '@xhmikosr/decompress'); assert.equal(patched.version, '11.1.4');
});
test('ZIP extraction retains Promise, strip and nested-file behavior', async () => {
  const dest = output('zip'), result = extract(sample, dest, { strip: 1 }); assert.equal(typeof result.then, 'function');
  assert.equal((await result).length, 2); assert.equal(readFileSync(join(dest, 'parts/part.txt'), 'utf8'), 'edible part');
});
test('old buffer-only signature retains filter and map', async () => {
  const entries = await extract(sample, { strip: 1, filter: f => f.path === 'readme.txt', map: f => ({ ...f, path: 'renamed.txt' }) });
  assert.equal(entries.length, 1); assert.equal(entries[0].path, 'renamed.txt'); assert.equal(entries[0].data.toString(), 'template content');
});
test('file input, TAR and gzip remain usable', async () => {
  const bytes = tar([{ path: 'source/readme.txt', data: 'tar content' }]), file = join(fixture, 'sample.tar'); writeFileSync(file, bytes, { flag: 'wx' });
  const a = output('tar'), b = output('gzip'); await extract(file, a, { strip: 1 }); await extract(gzipSync(bytes), b, { strip: 1 });
  for (const dest of [a, b]) assert.equal(readFileSync(join(dest, 'readme.txt'), 'utf8'), 'tar content');
});
test('output prefix does not allow overwriting a sibling', async () => {
  const dest = output('out'), sibling = output('out-old'), guard = join(sibling, 'guard.txt'); writeFileSync(guard, 'unchanged', { flag: 'wx' });
  await assert.rejects(extract(tar([{ path: '../out-old/guard.txt', data: 'attempt' }]), dest), /Refusing/);
  assert.equal(readFileSync(guard, 'utf8'), 'unchanged');
});
for (const [name, type] of [['symbolic', '2'], ['hard', '1']]) test(`${name} links cannot expose a sibling file`, async () => {
  const dest = output(`${name}-link`), guard = join(fixture, `${name}-guard.txt`); writeFileSync(guard, 'private fixture', { flag: 'wx' });
  await assert.rejects(extract(tar([{ path: 'leak', type, link: `../${name}-guard.txt` }]), dest), /Refusing/);
  assert(!existsSync(join(dest, 'leak'))); assert.equal(readFileSync(guard, 'utf8'), 'private fixture');
});
test('absolute hard-link target outside output is rejected', async () => {
  const dest = output('absolute-link'), guard = join(fixture, 'absolute-guard.txt'); writeFileSync(guard, 'private fixture', { flag: 'wx' });
  await assert.rejects(extract(tar([{ path: 'leak', type: '1', link: guard }]), dest), /Refusing/);
  assert(!existsSync(join(dest, 'leak')));
});
test('duplicate paths are rejected before competing writes', async () => {
  const dest = output('duplicate'); await assert.rejects(extract(tar([{ path: 'same.txt', data: 'first' }, { path: 'same.txt', data: 'second' }]), dest), /duplicate entry path/);
  assert(!existsSync(join(dest, 'same.txt')));
});
test('POSIX self-referential chain cannot expose a sibling', { skip: process.platform === 'win32' ? 'Requires real POSIX symlinks; covered by Linux CI' : false }, async () => {
  const dest = output('self-chain'), guard = join(fixture, 'chain-guard.txt'); writeFileSync(guard, 'private chain fixture', { flag: 'wx' });
  await assert.rejects(extract(tar([
    { path: 'anchor', type: '2', link: '.' },
    { path: 'escape', type: '2', link: 'anchor/../chain-guard.txt' }
  ]), dest), /Refusing/);
  assert(!existsSync(join(dest, 'escape'))); assert.equal(readFileSync(guard, 'utf8'), 'private chain fixture');
});
test('POSIX hard-linking a symlink cannot relocate its relative target', { skip: process.platform === 'win32' ? 'Requires POSIX symlink inode behavior; covered by Linux CI' : false }, async () => {
  const dest = output('relocated-link');
  await assert.rejects(extract(tar([
    { path: 'target.txt', data: 'inside fixture' },
    { path: 'sub/alias', type: '2', link: '../target.txt' },
    { path: 'moved', type: '1', link: 'sub/alias' }
  ]), dest), /Refusing to hardlink to a symlink/);
  assert(!existsSync(join(dest, 'moved')));
});
test('special archive mode bits are stripped (POSIX enforcement is Linux-only)', async () => {
  const dest = output('mode'); await extract(tar([{ path: 'safe.txt', data: 'safe', mode: 0o7777 }]), dest);
  assert.equal(statSync(join(dest, 'safe.txt')).mode & 0o7000, 0);
});
test('maintained path guard rejects Windows devices and alternate streams on every test OS', async () => {
  const adapterRequire = createRequire(downloadRequire.resolve('decompress'));
  const { assertSafeEntryPath } = await import(pathToFileURL(adapterRequire.resolve('@xhmikosr/decompress')).href);
  for (const path of ['NUL.txt', 'folder/CON', 'safe.txt:hidden', 'dir/a\0b']) assert.throws(() => assertSafeEntryPath(path, true), /Refusing/);
  assert.doesNotThrow(() => assertSafeEntryPath('safe name/food.txt', true));
  if (process.platform === 'win32') for (const [name, path] of [['ads', 'safe.txt:hidden'], ['device', 'NUL.txt']]) {
    await assert.rejects(extract(tar([{ path, data: 'attempt' }]), output(name)), /Refusing/);
  }
});
test('invalid input rejects asynchronously and empty plugins are respected', async () => {
  await assert.rejects(extract(123), /Input file required/); assert.deepEqual(await extract(sample, { plugins: [] }), []);
});
test('actual legacy download and repository callback work over owned loopback HTTP', async () => {
  let requests = 0, callbacks = 0;
  const server = createServer((req, res) => { requests++; assert.equal(req.url, '/sample.zip'); res.writeHead(200, { 'content-type': 'application/zip', 'content-length': sample.length }); res.end(sample); });
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const url = `http://127.0.0.1:${server.address().port}/sample.zip`, a = output('download'), b = output('repo');
    assert.equal((await download(url, a, { extract: true, strip: 1, retries: 0 })).length, 2);
    await new Promise((done, reject) => downloadRepo(`direct:${url}`, b, { retries: 0 }, error => { callbacks++; error ? reject(error) : done(); }));
    for (const dest of [a, b]) assert.equal(readFileSync(join(dest, 'parts/part.txt'), 'utf8'), 'edible part');
    assert.equal(callbacks, 1); assert.equal(requests, 2);
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  assert.equal(server.listening, false);
});
