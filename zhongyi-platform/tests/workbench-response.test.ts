import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AuditEvent, PlatformSummary, WorkflowEvent } from '../shared/contracts.js';
import { parseAuditEventList, parseCatalogPage, parsePlatformSummary, parseWorkflowEventList } from '../shared/workbench-response.js';
import { CatalogRepository } from '../server/database.js';
import { WorkflowRepository } from '../server/workflow.js';
import { validateSeed } from '../server/seed.js';
import { migrationFixture } from './migration-fixture.js';

const time = '2026-10-11T00:00:00.000Z';
const summary: PlatformSummary = { mode: 'local_editorial_demo', releaseId: 'test-release', contentVersion: 'test-content', sourceAsOf: '2026-08-10',
  importedAt: time, ingredientCount: 106, noteCount: 2, eventCount: 5, publicationEnabled: false };
const audit: AuditEvent = { id: 10, ingredientId: 'huang-qi', action: 'note_saved', revision: 3, createdAt: time, actor: 'test-editor' };
const workflow: WorkflowEvent = { id: 10, ingredientId: null, sourceId: 'test-source', revision: 1, action: 'source_created', actor: 'test-editor', createdAt: time };
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test('summary requires exact read projection, safe counts and real calendar dates; no publication authority', () => {
  assert.deepEqual(parsePlatformSummary(summary), summary);
  for (const bad of [null, {}, { ...summary, secret: 'private' }, { ...summary, publicationEnabled: true }, { ...summary, mode: 'production' },
    { ...summary, noteCount: 107 }, { ...summary, eventCount: '0' }, { ...summary, ingredientCount: -1 }, { ...summary, eventCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...summary, sourceAsOf: '2026-02-30' }, { ...summary, sourceAsOf: '2026-8-10' }, { ...summary, importedAt: '2026-02-30T00:00:00.000Z' }])
    assert.throws(() => parsePlatformSummary(bad));
  // Counts from different HTTP reads are not one transaction; do not invent
  // cross-endpoint equality or claim the latest audit list is a complete log.
  assert.equal(parsePlatformSummary({ ...summary, eventCount: 0 }).eventCount, 0);
});

test('audit is bounded descending history with sequence gaps, never secrets or unknown actions', () => {
  const input = { items: [audit, { ...audit, id: 3, revision: 1, action: 'note_cleared' }] };
  assert.deepEqual(parseAuditEventList(input), input);
  assert.deepEqual(parseAuditEventList({ items: [] }), { items: [] });
  for (const bad of [{ items: [audit, audit] }, { items: [...input.items].reverse() }, { items: [{ ...audit, actor: {} }] },
    { items: [{ ...audit, action: 'published' }] }, { items: [{ ...audit, noteText: 'private note' }] }, { items: [{ ...audit, revision: 0 }] },
    { items: [{ ...audit, ingredientId: '../other' }] }, { items: Array.from({ length: 21 }, (_, index) => ({ ...audit, id: 100 - index })) }])
    assert.throws(() => parseAuditEventList(bad));
  const parsed = parseAuditEventList(input); parsed.items[0].actor = 'changed'; assert.equal(input.items[0].actor, 'test-editor');
});

test('workflow history binds action to one target, correct source revision and bounded descending IDs', () => {
  const input = { items: [{ ...workflow, id: 20, ingredientId: 'huang-qi', sourceId: null, revision: 8, action: 'review_accepted' }, workflow] };
  assert.deepEqual(parseWorkflowEventList(input), input);
  assert.deepEqual(parseWorkflowEventList({ items: [] }), { items: [] });
  for (const event of [{ ...workflow, ingredientId: 'huang-qi' }, { ...workflow, sourceId: null }, { ...workflow, revision: 2 },
    { ...workflow, action: 'source_updated' }, { ...workflow, action: 'draft_saved' }, { ...workflow, action: 'professional_approved' },
    { ...workflow, qualificationEvidence: 'private' }, { ...workflow, createdAt: 'not-a-date' }])
    assert.throws(() => parseWorkflowEventList({ items: [event] }));
  assert.throws(() => parseWorkflowEventList({ items: [workflow, workflow] }));
  assert.throws(() => parseWorkflowEventList({ items: [...input.items].reverse() }));
  assert.throws(() => parseWorkflowEventList({ items: Array.from({ length: 51 }, (_, index) => ({ ...workflow, id: 100 - index })) }));
  assert.equal(parseWorkflowEventList({ items: [{ ...workflow, action: 'source_updated', revision: 4 }] }).items[0].revision, 4);
});

test('real catalog pages bind pagination, literal search, fullness and ordering without mutating their source', () => {
  const seed = validateSeed(JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url), 'utf8')));
  const repo = new CatalogRepository(':memory:', seed);
  try {
    for (const query of ['', '黄芪', 'HUANG QI', '%', '_', "'", '  姜  ']) for (const page of [1, 2, 100]) {
      const input = repo.list(query.trim(), page, 12);
      assert.deepEqual(parseCatalogPage(input, { page, pageSize: 12, query }), input);
    }
    const input = repo.list('', 1, 12), expected = { page: 1, pageSize: 12, query: '' };
    for (const bad of [{ ...input, page: 2 }, { ...input, pageSize: 8 }, { ...input, items: input.items.slice(1) },
      { ...input, items: [...input.items].reverse() }, { ...input, items: input.items.map(item => ({ ...item, secret: 'private' })) }])
      assert.throws(() => parseCatalogPage(bad, expected));
    assert.throws(() => parseCatalogPage(input, { ...expected, query: '黄芪' }));
    const parsed = parseCatalogPage(input, expected); parsed.items[0].aliases.push('changed'); assert.deepEqual(input, repo.list('', 1, 12));
  } finally { repo.close(); }
});

test('actual SQLite summary, note audit and all six workflow actions survive the HTTP JSON projection', async () => {
  const fixture = await migrationFixture(undefined, false);
  const repo = new CatalogRepository(fixture.filename, fixture.seed);
  try {
    assert.deepEqual(parsePlatformSummary(wire(repo.summary())), repo.summary());
    const audit = parseAuditEventList(wire({ items: repo.events() }));
    assert.equal(audit.items.length, 4); assert.deepEqual(audit, wire({ items: repo.events() }));
    const events = new WorkflowRepository(repo.db).events();
    assert.deepEqual(parseWorkflowEventList(wire({ items: events })), wire({ items: events }));
    assert.deepEqual(new Set(events.map(event => event.action)), new Set(['source_created', 'source_updated', 'draft_saved', 'draft_submitted', 'review_returned', 'review_accepted']));
  } finally { repo.close(); fixture.dispose(); }
});
