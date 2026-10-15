import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('native ZIP guards reject traversal, Windows aliases, links and special files before extraction', () => {
  const cases = [
    ...['README.md', '.github/workflows/check.yml', 'zhongyi-platform/.env.example', 'tools/public-safety-projection.d.mts', '资料/说明.md']
      .map(value => ({ kind: 'name', value, allowed: true })),
    ...['', '../outside', '/absolute', 'C:/outside', 'a\\..\\outside', './a', 'a//b', 'a/', 'CON.txt', 'x/NUL', 'x/LPT1.md',
      'a.', 'a ', 'a:b', 'a\0b', 'a?b', 'a*b'].map(value => ({ kind: 'name', value, allowed: false })),
    ...[0, 0x81a40000, 0x41ed0000].map(value => ({ kind: 'attributes', value, allowed: true })),
    ...[0xa1ff0000, 0x21b60000, 0x400].map(value => ({ kind: 'attributes', value, allowed: false })),
  ];
  const script = fileURLToPath(new URL('../source-archive.ps1', import.meta.url)).replaceAll("'", "''");
  const code = `. '${script}'; $cases = [Console]::In.ReadToEnd() | ConvertFrom-Json; $results = @(); foreach ($case in $cases) { try { if ($case.kind -eq 'name') { Assert-ArchiveName $case.value } else { Assert-ArchiveKind $case.value }; $results += $true } catch { $results += $false } }; ConvertTo-Json -InputObject $results -Compress`;
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {
    input: JSON.stringify(cases), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), cases.map(value => value.allowed));
});
test('shared WeChat example has no account identifier and preserves safe build and domain settings', () => {
  const example = JSON.parse(readFileSync(new URL('../../apps/miniprogram/project.config.example.json', import.meta.url), 'utf8'));
  assert.equal(example.appid, ''); assert.equal(example.miniprogramRoot, 'dist/'); assert.equal(example.compileType, 'miniprogram');
  assert.equal(example.setting.urlCheck, true); assert.equal(example.setting.uploadWithSourceMap, false);
  assert(!Object.keys(example).some(key => /secret|token|password/i.test(key)));
  const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['source:export'], 'node tools/export-workspace-source.mjs');
});
