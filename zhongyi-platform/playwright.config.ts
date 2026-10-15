import { defineConfig } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserFixtureOutput } from './tools/browser-fixture-output';

export const browserToken = 'browser-test-editor-key-is-for-test-only-123';
export default defineConfig({
  testDir: './tests/browser',
  // The default Playwright output directory is cleaned at every run. Keep both
  // standalone runs and controller-provided --output paths away from old proof.
  outputDir: resolve('.local/browser-tests', `run-${randomUUID()}`),
  forbidOnly: true,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['json', { outputFile: process.env.CI_BROWSER_REPORT || resolve('.local/browser-test-results.latest.json') }]],
  use: { baseURL: 'http://127.0.0.1:4311', channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: [{
    ...browserFixtureOutput(4311, process.env.PG_CONNECTION_DIAGNOSTICS),
    command: 'node --import tsx tests/browser-server.ts local-key',
    url: 'http://127.0.0.1:4311/api/health',
    // Fresh file per run; persistence is exercised within that owned service,
    // not by reusing old reports, notes, or credentials from a previous run.
    env: { PORT: '4311', DB_PATH: resolve(process.env.CI_BROWSER_REPORT ? dirname(process.env.CI_BROWSER_REPORT) : '.local', `browser-key-${randomUUID()}.sqlite`) },
    reuseExistingServer: false
  }, {
    ...browserFixtureOutput(4312, process.env.PG_CONNECTION_DIAGNOSTICS),
    command: 'node --import tsx tests/browser-server.ts accounts',
    url: 'http://127.0.0.1:4312/api/health',
    env: { PORT: '4312' },
    reuseExistingServer: false
  }, {
    ...browserFixtureOutput(4313, process.env.PG_CONNECTION_DIAGNOSTICS),
    command: 'node --import tsx tests/publication-browser-server.ts',
    url: 'http://127.0.0.1:4313/api/health',
    env: { PORT: '4313' },
    reuseExistingServer: false
  }, {
    ...browserFixtureOutput(4314, process.env.PG_CONNECTION_DIAGNOSTICS),
    // Source-response tests own an account service as well as their records.
    // Sharing the original suite's IP login window can exhaust its real limit;
    // do not clear counters, spoof forwarded IPs or weaken production throttles.
    command: 'node --import tsx tests/browser-server.ts accounts',
    url: 'http://127.0.0.1:4314/api/health',
    env: { PORT: '4314' },
    reuseExistingServer: false
  }, {
    ...browserFixtureOutput(4315, process.env.PG_CONNECTION_DIAGNOSTICS),
    // Publication response fault injection owns its snapshots and global epoch;
    // never append governance history to another suite's fixed fixture.
    command: 'node --import tsx tests/publication-browser-server.ts',
    url: 'http://127.0.0.1:4315/api/health',
    env: { PORT: '4315' },
    reuseExistingServer: false
  }]
});
