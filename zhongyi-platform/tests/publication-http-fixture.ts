import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { AssistantRepository } from '../server/assistant-repository.js';
import { PhotoNoteRepository } from '../server/photo-notes.js';
import { PhotoSubmissionRepository } from '../server/photo-submissions.js';
import { PhotoRightsRepository } from '../server/photo-rights.js';
import { PhotoProfessionalRepository } from '../server/photo-professional.js';
import { createPostgresPool, migrateSqliteToPostgres } from '../server/postgres-migration.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { identifier } from '../server/migration-snapshot.js';
import type { RepositoryBundle } from '../server/stores.js';
import type { Account, ContentDraft, ContentRevision, DraftDetail, ProfessionalDetail, ProfessionalKind, PublicationSnapshotView, PublicationWorkspaceView, SessionInfo } from '../shared/contracts.js';
import { publicationFixture } from './publication-fixture.js';
import { fileDigest, fixturePassword } from './migration-fixture.js';

const comment = 'ENGINEERING_SIMULATION_NOT_REAL：仅本机隔离 HTTP 验收。';
const origin = 'https://publication.example.test';
export interface PublicationHttpBackend {
  stores: RepositoryBundle;
  admin: Account; editor: Account; reviewer: Account; approver: Account; physician: Account; pharmacist: Account;
  corrupt(kind: 'catalog' | 'history', snapshotId: string): void | Promise<void>;
  close(): void | Promise<void>;
}
const actors = (state: Awaited<ReturnType<typeof publicationFixture>>) => ({ admin: state.admin, editor: state.editor, reviewer: state.reviewer,
  approver: state.approver, physician: state.physician, pharmacist: state.pharmacist });

export async function sqlitePublicationHttpBackend(): Promise<PublicationHttpBackend> {
  const state = await publicationFixture();
  try {
    const stores: RepositoryBundle = { engine: 'sqlite', catalog: state.catalog, auth: state.auth, workflow: state.workflow,
      publication: state.publication, assistant: new AssistantRepository(state.catalog.db), photoNotes: new PhotoNoteRepository(state.catalog.db), photoSubmissions: new PhotoSubmissionRepository(state.catalog.db), photoRights: new PhotoRightsRepository(state.catalog.db), photoProfessional: new PhotoProfessionalRepository(state.catalog.db), close: () => state.close() };
    return { ...actors(state), stores, close: stores.close,
      corrupt: (kind, id) => {
        if (kind === 'catalog') state.catalog.db.prepare("UPDATE ingredients SET name='PRIVATE_UNTRUSTED_EDIT' WHERE id='huang-qi'").run();
        else {
          state.catalog.db.exec('DROP TRIGGER immutable_publication_snapshots_update');
          state.catalog.db.prepare("UPDATE publication_snapshots SET basis_payload='PRIVATE_CORRUPT_JSON' WHERE id=?").run(id);
        }
      }
    };
  } catch (error) { state.close(); throw error; }
}

export async function postgresPublicationHttpBackend(): Promise<PublicationHttpBackend> {
  const connection = process.env.PG_TEST_DATABASE_URL;
  if (!connection || !process.env.PG_TEST_NONCE) throw new Error('Owned real PostgreSQL controller fixture required; no skips or SQLite fallback');
  const state = await publicationFixture(); const sourceDigest = fileDigest(state.filename);
  const schema = `publication_http_${randomUUID().replaceAll('-', '')}`; const target = identifier(schema);
  const pool = createPostgresPool(connection); let stores: RepositoryBundle | undefined;
  async function close() {
    try { await stores?.close(); } finally {
      try { await pool.end(); } finally {
        try { assert.equal(fileDigest(state.filename), sourceDigest, 'PostgreSQL HTTP must not write to its SQLite migration source'); }
        finally { state.close(); }
      }
    }
  }
  try {
    await migrateSqliteToPostgres(pool, schema, state.read(), state.seed);
    stores = await openPostgresStore(connection, schema, state.seed);
    assert.equal(stores.engine, 'postgres');
    return { ...actors(state), stores, close,
      corrupt: async (kind, id) => {
        if (kind === 'catalog') await pool.query(`UPDATE ${target}.ingredients SET name='PRIVATE_UNTRUSTED_EDIT' WHERE id='huang-qi'`);
        else {
          // Corrupt only this newly created test namespace, never a working DB.
          await pool.query(`ALTER TABLE ${target}.publication_snapshots DISABLE TRIGGER immutable_publication_snapshots_change`);
          await pool.query(`UPDATE ${target}.publication_snapshots SET basis_payload='PRIVATE_CORRUPT_JSON' WHERE id=$1`, [id]);
        }
      }
    };
  } catch (error) { await close(); throw error; }
}

export async function servePublicationHttpFixture(state: PublicationHttpBackend, engine: 'sqlite' | 'postgres', enabled = false) {
  let server: Server | undefined;
  async function close() {
    try { if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done())); }
    finally { await state.close(); }
  }
  try {
    assert.equal(state.stores.engine, engine, 'An engine-specific HTTP result must use its real repository bundle');
    server = createApp(state.stores, { mode: 'accounts', allowedOrigins: [origin] }, undefined, { publicationEnabled: enabled }).listen(0, '127.0.0.1');
    await once(server, 'listening'); const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const sessions = new Map<string, { cookie: string; info: SessionInfo }>();
    for (const actor of [state.admin, state.editor, state.reviewer, state.approver, state.physician, state.pharmacist]) {
      const response = await fetch(`${root}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password: fixturePassword }) });
      assert.equal(response.status, 200); sessions.set(actor.id, { cookie: response.headers.get('set-cookie')!.split(';')[0], info: await response.json() as SessionInfo });
    }
    const api = (path: string, actor: Account = state.admin, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => fetch(root + path, {
      method, headers: { Origin: origin, Cookie: sessions.get(actor.id)!.cookie, 'X-CSRF-Token': sessions.get(actor.id)!.info.csrfToken, 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    async function checked<T>(path: string, actor: Account, method = 'GET', body?: unknown, status = 200): Promise<T> {
      const response = await api(path, actor, method, body); assert.equal(response.status, status, await response.clone().text()); return await response.json() as T;
    }
    const workspace = (version?: number) => checked<PublicationWorkspaceView>('/editorial/publications/huang-qi' + (version === undefined ? '' : `/versions/${version}`), state.admin);
    const control = (action: 'resume' | 'freeze') => workspace().then((w) => checked('/editorial/publication-controls', state.admin, 'POST', {
      action, expectedVersion: w.control?.version || 0, evidenceReference: 'ENGINEERING_SIMULATION_NOT_REAL', comment, confirmed: true
    }, 201));
    const snapshot = async () => checked<PublicationSnapshotView>('/editorial/publications/huang-qi/snapshots', state.editor, 'POST', {
      expectedBasisDigest: (await workspace()).basisDigest!, comment, confirmed: true
    }, 201);
    const approvalInput = async (fixed: PublicationSnapshotView, decision: 'approve' | 'revoke' = 'approve') => {
      const w = await workspace(fixed.version); return { snapshotId: fixed.id, snapshotDigest: fixed.digest,
        expectedApprovalVersion: w.approvals.find((item) => item.snapshotId === fixed.id)?.version || 0,
        expectedControlVersion: w.control?.version || 0, decision, comment, confirmed: true };
    };
    const approve = async (fixed: PublicationSnapshotView) => checked('/editorial/publications/huang-qi/approvals', state.approver, 'POST', await approvalInput(fixed), 201);
    const actionInput = async (fixed: PublicationSnapshotView, action: 'publish' | 'withdraw' | 'rollback' = 'publish') => {
      const w = await workspace(); return { snapshotId: fixed.id, action, expectedVersion: w.eventVersion,
        expectedControlVersion: w.control?.version || 0, comment, confirmed: true };
    };
    const action = async (fixed: PublicationSnapshotView, kind: 'publish' | 'withdraw' | 'rollback' = 'publish') => checked('/editorial/publications/huang-qi/actions', state.approver, 'POST', await actionInput(fixed, kind), 201);
    const anonymous = (path = '/public/education/huang-qi', init?: RequestInit) => fetch(root + path, init);
    async function review(profession: ProfessionalKind, revision?: number, decision: 'approve' | 'revoke' = 'approve') {
      const detail = await checked<ProfessionalDetail>('/editorial/professional/huang-qi', state.admin);
      const fixed = await checked<ContentRevision>(`/editorial/ingredients/huang-qi/revisions/${revision ?? detail.draft!.revision}`, state.admin);
      return checked('/editorial/professional/huang-qi', profession === 'tcm_physician' ? state.physician : state.pharmacist, 'POST', {
        profession, decision, contentRevision: fixed.revision, contentDigest: fixed.digest, expectedLockVersion: detail.draft!.lockVersion,
        expectedReviewVersion: detail.reviewVersion, expectedQualificationRevision: 1, comment
      });
    }
    async function advance(text: string) {
      const detail = await checked<DraftDetail>('/editorial/ingredients/huang-qi', state.editor); const old = detail.draft!;
      const next = await checked<ContentDraft>('/editorial/ingredients/huang-qi', state.editor, 'PUT', {
        content: { ...old.content, educationText: text }, expectedLockVersion: old.lockVersion
      });
      const submitted = await checked<{ draft: ContentDraft; task: { id: string } }>('/editorial/ingredients/huang-qi/submit', state.editor, 'POST', { expectedLockVersion: next.lockVersion });
      await checked(`/editorial/tasks/${submitted.task.id}/decision`, state.reviewer, 'POST', { decision: 'accept', comment, expectedLockVersion: submitted.draft.lockVersion });
      await review('tcm_physician'); await review('pharmacist');
    }
    async function seedValidPointer() {
      await control('resume'); const fixed = await snapshot(); await approve(fixed);
      // Deliberately seed an already-valid pointer behind a disabled HTTP app.
      // This is the default-off regression, not an API bypass in production.
      await state.stores.publication.action('huang-qi', await actionInput(fixed), state.approver, undefined, true);
    }
    return { ...state, root, api, workspace, control, snapshot, approvalInput, approve, actionInput, action, anonymous, advance, review, seedValidPointer, close };
  } catch (error) { await close(); throw error; }
}
