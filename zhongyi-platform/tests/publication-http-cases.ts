import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import { request as httpRequest } from 'node:http';
import type { PublishedEducation, PublicationSnapshotView, PublicationWorkspaceView } from '../shared/contracts.js';
import { servePublicationHttpFixture, type PublicationHttpBackend } from './publication-http-fixture.js';

const comment = 'ENGINEERING_SIMULATION_NOT_REAL：仅本机隔离 HTTP 验收。';
// The same assertions run against actual SQLite and actual PostgreSQL. Registering
// the cases is not evidence of a completed engine run; terminal reports are required.
export function registerPublicationHttpCases(engine: 'sqlite' | 'postgres', backend: () => Promise<PublicationHttpBackend>): void {
  const test = (name: string, run: () => Promise<void>) => nodeTest(`${engine} publication HTTP: ${name}`, run);
  const setup = async (enabled = false) => servePublicationHttpFixture(await backend(), engine, enabled);

  test('default-off HTTP cannot expose or publish even a valid repository pointer; emergency withdrawal remains available', async () => {
    const s = await setup();
    try {
      await s.seedValidPointer();
      assert.equal((await s.anonymous()).status, 503); assert.equal((await s.anonymous('/public/education/unknown')).status, 503);
      const w = await s.workspace(); assert.equal(w.enabled, false); assert.equal(w.activeSnapshotId, null);
      const view = w.snapshots[0]; const response = await s.api('/editorial/publications/huang-qi/actions', s.approver, 'POST', await s.actionInput(view));
      assert.equal(response.status, 409); assert.equal((await response.json() as { error: string }).error, 'publication_disabled');
      await s.action(view, 'withdraw'); assert.equal((await s.workspace()).events[0].action, 'withdraw');
      assert.equal((await s.anonymous()).status, 503);
    } finally { await s.close(); }
  });

  test('real HTTP snapshot, independent approval, publish, second version and historical rollback preserve the original catalog and redact private credentials', async () => {
    const s = await setup(true);
    try {
      const catalog = await (await s.anonymous('/public/catalog')).text();
      await s.control('resume'); const fixed = await s.snapshot();
      for (const q of fixed.basis.qualifications) assert.deepEqual(Object.keys(q).sort(), ['accountRevision', 'digest', 'evidenceKind', 'profession', 'revision', 'status', 'userId', 'validUntil'].sort());
      assert.equal((await s.api(`/editorial/qualifications/${s.physician.id}`, s.editor)).status, 403);
      for (const actor of [s.admin, s.editor, s.reviewer]) assert.equal((await s.api('/editorial/publications/huang-qi/approvals', actor, 'POST', await s.approvalInput(fixed))).status, 403);
      await s.approve(fixed); assert.equal((await s.anonymous()).status, 404); await s.action(fixed);
      const response = await s.anonymous(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json() as PublishedEducation; assert.equal(body.snapshotId, fixed.id);
      assert.deepEqual(Object.keys(body).sort(), ['scope', 'ingredientId', 'name', 'snapshotId', 'snapshotVersion', 'contentRevision', 'baseReleaseId', 'publishedAt', 'ediblePart', 'latinName', 'educationText', 'safetyText', 'sources', 'boundary'].sort());
      assert.deepEqual(Object.keys(body.sources[0]).sort(), ['title', 'publisher', 'url', 'locator', 'checkedAt', 'validUntil'].sort());
      for (const key of ['password', 'csrfToken', 'qualifications', 'professionalReviews', 'evidenceReference', 'actorId', 'comment', 'basis', 'sourceChecks']) assert.equal(Object.hasOwn(body, key), false);
      await s.advance('第二个独立固定版本，仅工程模拟。');
      assert.equal((await (await s.anonymous()).json() as PublishedEducation).snapshotId, fixed.id);
      const second = await s.snapshot(); await s.approve(second); await s.action(second);
      assert.equal((await (await s.anonymous()).json() as PublishedEducation).snapshotId, second.id);
      await s.action(fixed, 'rollback'); assert.equal((await (await s.anonymous()).json() as PublishedEducation).snapshotId, fixed.id);
      assert.deepEqual((await s.workspace()).events.map((item) => item.action), ['rollback', 'publish', 'publish']);
      assert.equal(await (await s.anonymous('/public/catalog')).text(), catalog);
    } finally { await s.close(); }
  });

  test('publication HTTP enforces account roles, CSRF, trusted origins, exact bodies and fixed GET-only anonymous paths', async () => {
    const s = await setup(true);
    try {
      const w = await s.workspace(); const input = { expectedBasisDigest: w.basisDigest, comment, confirmed: true };
      assert.equal((await s.anonymous('/editorial/publications/huang-qi')).status, 401);
      assert.equal((await s.api('/editorial/publication-controls', s.editor)).status, 403);
      assert.equal((await s.api('/editorial/publications/huang-qi/snapshots', s.reviewer, 'POST', input)).status, 403);
      const rejectedHeaders: Record<string, string>[] = [{ 'X-CSRF-Token': '' }, { Origin: 'https://untrusted.example.test' }, { 'Sec-Fetch-Site': 'cross-site' }];
      for (const headers of rejectedHeaders) {
        assert.equal((await s.api('/editorial/publications/huang-qi/snapshots', s.editor, 'POST', input, headers)).status, 403);
      }
      for (const patch of [{ confirmed: false }, { expectedBasisDigest: 'wrong' }, { extra: 'health information' }, { comment: '' }]) assert.equal((await s.api('/editorial/publications/huang-qi/snapshots', s.editor, 'POST', { ...input, ...patch })).status, 400);
      assert.equal((await s.api('/editorial/publications/huang-qi?profile=secret')).status, 400);
      assert.equal((await s.api('/editorial/publications/huang-qi/snapshots?force=1', s.editor, 'POST', input)).status, 400);
      assert.equal((await s.api('/editorial/publications/huang-qi', s.admin, 'HEAD')).status, 404);
      for (const path of ['/public/education/huang-qi/', '/public/education/huang-qi/snapshots', '/public/publications/huang-qi', '/public/publication-controls', '/public/education/%2e%2e']) assert.equal((await s.anonymous(path)).status, 404);
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) assert.equal((await s.anonymous(undefined, { method })).status, 404);
      for (const query of ['profile=secret', 'health=secret', 'q=a&q=b']) assert.equal((await s.anonymous('/public/education/huang-qi?' + query)).status, 400);
      const bodyStatus = await new Promise<number>((resolveStatus, reject) => {
        const request = httpRequest(s.root + '/public/education/huang-qi', { method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } }, (response) => { response.resume(); resolveStatus(response.statusCode!); });
        request.on('error', reject); request.end('{}');
      });
      assert.equal(bodyStatus, 400); assert.equal((await s.workspace()).snapshots.length, 0);
      assert.equal((await s.api('/editorial/professional/huang-qi')).status, 200, 'Existing unrelated editorial routes must remain available.');
    } finally { await s.close(); }
  });

  test('parallel HTTP snapshot, approval and publish requests have one winner; stale versions and disabled sessions cannot mutate history', async () => {
    const s = await setup(true);
    try {
      await s.control('resume'); const input = { expectedBasisDigest: (await s.workspace()).basisDigest!, comment, confirmed: true };
      const snapshots = await Promise.all([1, 2].map(() => s.api('/editorial/publications/huang-qi/snapshots', s.editor, 'POST', input)));
      assert.deepEqual(snapshots.map((r) => r.status).sort(), [201, 409]); const fixed = await snapshots.find((r) => r.status === 201)!.json() as PublicationSnapshotView;
      const approval = await s.approvalInput(fixed);
      const approvals = await Promise.all([1, 2].map(() => s.api('/editorial/publications/huang-qi/approvals', s.approver, 'POST', approval)));
      assert.deepEqual(approvals.map((r) => r.status).sort(), [201, 409]);
      const inputAction = await s.actionInput(fixed);
      const events = await Promise.all([1, 2].map(() => s.api('/editorial/publications/huang-qi/actions', s.approver, 'POST', inputAction)));
      assert.deepEqual(events.map((r) => r.status).sort(), [201, 409]);
      const before = await s.workspace(); const disabled = await s.api(`/users/${s.approver.id}`, s.admin, 'PUT', { role: 'admin', active: false, expectedRevision: 1 }); assert.equal(disabled.status, 200);
      assert.equal((await s.api('/editorial/publications/huang-qi/actions', s.approver, 'POST', await s.actionInput(fixed, 'withdraw'))).status, 401);
      const after = await s.workspace(); assert.deepEqual(after.events, before.events); assert.equal((await s.anonymous()).status, 404);
    } finally { await s.close(); }
  });

  test('HTTP freeze, resume, new approval and withdrawal never automatically revive an old public pointer', async () => {
    const s = await setup(true);
    try {
      await s.control('resume'); const fixed = await s.snapshot(); await s.approve(fixed); await s.action(fixed); assert.equal((await s.anonymous()).status, 200);
      await s.control('freeze'); assert.equal((await s.anonymous()).status, 404);
      await s.control('resume'); assert.equal((await s.anonymous()).status, 404);
      assert.equal((await s.api('/editorial/publications/huang-qi/actions', s.approver, 'POST', await s.actionInput(fixed))).status, 409);
      await s.approve(fixed); assert.equal((await s.anonymous()).status, 404); await s.action(fixed); assert.equal((await s.anonymous()).status, 200);
      await s.action(fixed, 'withdraw'); assert.equal((await s.anonymous()).status, 404);
      assert.equal((await s.api('/editorial/publications/huang-qi/actions', s.approver, 'POST', await s.actionInput(fixed, 'rollback'))).status, 409);
      await s.approve(fixed); assert.equal((await s.anonymous()).status, 404); await s.action(fixed, 'rollback'); assert.equal((await s.anonymous()).status, 200);
      await s.review('tcm_physician', fixed.basis.draft.revision, 'revoke'); assert.equal((await s.anonymous()).status, 404);
    } finally { await s.close(); }
  });

  test('focused historical workspace includes older snapshot approval without widening public data or changing the bounded default view', async () => {
    const s = await setup(true);
    try {
      await s.control('resume'); const first = await s.snapshot(); await s.approve(first);
      for (let index = 2; index <= 22; index++) { await s.advance(`隔离工程模拟修订 ${index}`); await s.snapshot(); }
      const normal = await s.workspace(); assert.equal(normal.snapshots.length, 20);
      assert.equal(normal.snapshots.some((record) => record.id === first.id), false);
      const response = await s.api('/editorial/publications/huang-qi/versions/1', s.reviewer); assert.equal(response.status, 200);
      const focused = await response.json() as PublicationWorkspaceView; assert.equal(focused.snapshots.length, 21);
      assert.equal(focused.snapshots.find((record) => record.version === 1)?.id, first.id);
      assert.equal(focused.approvals.find((record) => record.snapshotId === first.id)?.version, 1);
      for (const record of focused.snapshots) for (const qualification of record.basis.qualifications) assert.equal(Object.hasOwn(qualification, 'evidenceReference'), false);
      for (const value of ['0', '-1', '01', '1e1', '1.0', '9007199254740992', 'NaN']) assert.equal((await s.api(`/editorial/publications/huang-qi/versions/${value}`)).status, 400);
      assert.equal((await s.api('/editorial/publications/huang-qi/versions/23')).status, 404);
      assert.equal((await s.api('/editorial/publications/jiang/versions/1')).status, 404);
      assert.equal((await s.anonymous('/editorial/publications/huang-qi/versions/1')).status, 401);
      assert.equal((await s.api('/editorial/publications/huang-qi/versions/1?force=1')).status, 400);
      assert.equal((await s.anonymous()).status, 404); assert.equal((await s.workspace()).snapshots.length, 20);
    } finally { await s.close(); }
  });

  test('anonymous education fails closed on catalog drift or malformed publication history without disclosing private errors', async () => {
    for (const kind of ['catalog', 'history'] as const) {
      const s = await setup(true);
      try {
        await s.control('resume'); const fixed = await s.snapshot(); await s.approve(fixed); await s.action(fixed);
        await s.corrupt(kind, fixed.id);
        const response = await s.anonymous(); assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'education_unavailable', message: '公开教育内容暂不可用，请使用本地资料。' });
      } finally { await s.close(); }
    }
  });
}
