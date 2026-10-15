import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import buildConfig from '../../apps/miniprogram/config/public-content-build';
import { publicContentOrigin } from '../../packages/catalog-core/src/education';
import buildOutput from '../../apps/miniprogram/config/build-output';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { PUBLIC_ORIGIN_ENV, publicContentManifest, readPublicContentOrigin } = buildConfig;
const configure = (value: string | undefined) => readPublicContentOrigin({ [PUBLIC_ORIGIN_ENV]: value });
const { readBuildOutput } = buildOutput;

test('verification builds cannot redirect the normal output or accept path-shaped input', () => {
  assert.equal(readBuildOutput({}), 'dist');
  assert.equal(readBuildOutput({ OUTPUT_ROOT: '/wrong', OPENAI_API_KEY: 'not-real' }), 'dist');
  assert.equal(readBuildOutput({ FOOD_EDUCATION_VERIFICATION_ID: 'a2c38e22-ef0d-4d83-bc3a-5e51f223a835' }), '.verification-builds/a2c38e22-ef0d-4d83-bc3a-5e51f223a835');
  for (const id of ['', 'dist', '..', '../dist', '/tmp/output', 'C:\\Users', 'a2c38e22-ef0d-4d83-bc3a-5e51f223a835/../dist']) {
    assert.throws(() => readBuildOutput({ FOOD_EDUCATION_VERIFICATION_ID: id }), /expected a fresh verification UUID/);
  }
});

test('unconfigured builds are disabled; unrelated environment values are ignored', () => {
  assert.equal(configure(undefined), null);
  assert.equal(configure(''), null);
  assert.equal(readPublicContentOrigin({ OPENAI_API_KEY: 'not-a-real-key', API_URL: 'https://wrong.example' }), null);
  assert.deepEqual(publicContentManifest(null), { schemaVersion: 1, protocolVersion: 1, mode: 'disabled', origin: null });
});

test('deployment origin normalizes once and agrees with the runtime contract', () => {
  for (const input of ['https://food.company.cn', 'HTTPS://FOOD.COMPANY.CN:443', 'https://food-service.company.cn']) {
    const origin = configure(input);
    assert.equal(origin, publicContentOrigin(input));
    assert.equal(publicContentManifest(origin).mode, 'configured');
    assert.ok(Object.isFrozen(publicContentManifest(origin)));
  }
});

test('invalid, private, sample and ambiguous addresses fail without echoing the supplied value', () => {
  for (const value of [' ', ' https://food.company.cn', 'http://food.company.cn', 'https://food.company.cn/',
    'https://food.company.cn/a', 'https://food.company.cn?token=private', 'https://food.company.cn#fragment',
    'https://user:secret@food.company.cn', 'https://food.company.cn:4310', 'https://food.company.cn:0443',
    'https://127.0.0.1', 'https://10.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]',
    'https://localhost', 'https://food.local', 'https://food.internal', 'https://food.lan', 'https://food.test',
    'https://service.example', 'https://example.com', 'https://food.example.net', 'https://food.invalid',
    'https://-food.company.cn', 'https://food..company.cn', 'https://food.company.cn.', 'https://%66ood.company.cn',
    'https://food.company.cn\\@evil.company.cn', `https://${'a'.repeat(64)}.company.cn`, 'https://食材.cn']) {
    assert.throws(() => configure(value), error => error instanceof Error
      && error.message === `${PUBLIC_ORIGIN_ENV}: expected an owned public HTTPS origin, without credentials, path, query or nonstandard port`);
  }
});

test('client module uses only the injected literal and still validates it at runtime', () => {
  const source = fs.readFileSync(path.join(root, 'apps/miniprogram/src/config/public-content.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const [injected, expected] of [[null, null], ['https://food.company.cn', 'https://food.company.cn'],
    ['http://food.company.cn', null], [{ origin: 'https://food.company.cn' }, null]] as const) {
    const exported: Record<string, unknown> = {};
    const context = vm.createContext({ exports: exported, __FOOD_EDUCATION_PUBLIC_ORIGIN__: injected,
      require: (name: string) => {
        assert.equal(name, '@food-education/catalog-core');
        return { publicContentOrigin };
      } });
    vm.runInContext(output, context);
    const config = exported.publicContentConfig;
    assert.ok(config && typeof config === 'object' && 'origin' in config);
    assert.equal(config.origin, expected);
    assert.ok(Object.isFrozen(config));
  }
  assert.doesNotMatch(output, /process\.env|localStorage|Taro\.getStorage/);
});

test('preflight really exits nonzero for bad input, without starting a build or leaking credentials', () => {
  const command = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  const run = (origin: string) => spawnSync(process.execPath, [command, 'tools/validate-mini-public-content.ts'], {
    cwd: root, env: { ...process.env, [PUBLIC_ORIGIN_ENV]: origin }, encoding: 'utf8', timeout: 20_000 });
  const invalid = run('https://user:very-private-password@food.company.cn');
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /very-private-password|user:/);
  const disabled = run('');
  assert.equal(disabled.status, 0);
  const report: unknown = JSON.parse(disabled.stdout);
  assert.ok(report && typeof report === 'object' && 'origin' in report && 'mode' in report);
  assert.equal(report.origin, null);
  assert.equal(report.mode, 'disabled');
});

test('build and watch both preflight before Taro, and regular tests include this suite', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/miniprogram/package.json'), 'utf8'));
  const workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(app.scripts['prebuild:weapp'], 'tsx ../../tools/validate-mini-public-content.ts');
  assert.equal(app.scripts['predev:weapp'], app.scripts['prebuild:weapp']);
  assert.match(workspace.scripts.test, /npm run test:mini-config/);
});

test('the real npm build entry rejects invalid configuration before invoking Taro', () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli && path.isAbsolute(npmCli), 'Run this suite through npm run test:mini-config');
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build:weapp', '--workspace', '@food-education/miniprogram'], {
    cwd: root, env: { ...process.env, [PUBLIC_ORIGIN_ENV]: 'https://user:never-print-this@food.company.cn' },
    encoding: 'utf8', timeout: 20_000
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /prebuild:weapp/);
  assert.doesNotMatch(result.stdout + result.stderr, /never-print-this|taro build --type|Taro v/);
});
