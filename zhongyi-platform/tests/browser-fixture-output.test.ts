import assert from 'node:assert/strict';
import test from 'node:test';
import { browserFixtureOutput } from '../tools/browser-fixture-output.js';

test('browser fixture stdout is opt-in and every owned service has a distinct non-secret label', () => {
  const labels = new Set<string>();
  for (const port of [4311, 4312, 4313, 4314, 4315]) {
    const enabled = browserFixtureOutput(port, 'true');
    assert.deepEqual(enabled, { name: `fixture-${port}`, stdout: 'pipe' }); labels.add(enabled.name);
    for (const flag of [undefined, '', 'false', 'TRUE', '1', 'private-connection-string']) {
      assert.deepEqual(browserFixtureOutput(port, flag), { name: enabled.name, stdout: 'ignore' });
    }
  }
  assert.equal(labels.size, 5);
});

test('browser fixture output refuses unowned ports and never reflects flag data', () => {
  for (const port of [0, 80, 4310, 4316, NaN, Infinity, 4311.5]) assert.throws(() => browserFixtureOutput(port, 'true'));
  assert.doesNotMatch(JSON.stringify(browserFixtureOutput(4311, 'postgres://private:secret@host/db')), /postgres|secret|host|private/);
});
