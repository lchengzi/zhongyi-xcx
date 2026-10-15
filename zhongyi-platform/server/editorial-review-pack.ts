import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DraftContent, SourceInput, ManagedSource } from '../shared/contracts.js';
import { exact, validateContent, validateSource } from './workflow.js';
import { assertNoLinks } from './demo-secrets.js';
import { prepareLocalDemo } from './local-demo.js';
import { validateSeed } from './seed.js';
import { openConfiguredStore } from './store-config.js';
import { editorialReviewHtml } from './editorial-review-html.js';

interface ReviewSource { key: string; input: SourceInput; accessedOn: string; evidenceNote: string }
export interface EditorialReviewPack {
  schemaVersion: 'private-editorial-pack.1'; visibility: 'private'; professionalReviewState: 'pending';
  publicationEnabled: false; externalAiEnabled: false;
  sources: ReviewSource[]; drafts: { ingredientId: string; content: DraftContent }[];
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.trim() === value && value.length <= max;
function invalid(): never { throw new Error('Invalid private editorial pack'); }

export function parseEditorialReviewPack(value: unknown): EditorialReviewPack {
  if (!exact(value, ['schemaVersion', 'visibility', 'professionalReviewState', 'publicationEnabled', 'externalAiEnabled', 'sources', 'drafts']) ||
    value.schemaVersion !== 'private-editorial-pack.1' || value.visibility !== 'private' || value.professionalReviewState !== 'pending' ||
    value.publicationEnabled !== false || value.externalAiEnabled !== false || !Array.isArray(value.sources) || !Array.isArray(value.drafts) ||
    !value.sources.length || value.sources.length > 10 || !value.drafts.length || value.drafts.length > 15) invalid();
  const keys = new Set<string>(), ingredientIds = new Set<string>();
  const sources = value.sources.map((item: unknown): ReviewSource => {
    if (!exact(item, ['key', 'input', 'accessedOn', 'evidenceNote']) || !id(item.key) || keys.has(item.key) || !text(item.evidenceNote, 800) ||
      typeof item.accessedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.accessedOn) ||
      !Number.isFinite(Date.parse(item.accessedOn)) || new Date(item.accessedOn).toISOString().slice(0, 10) !== item.accessedOn) invalid();
    const input = validateSource(item.input);
    if (!input.url.startsWith('https:')) invalid();
    keys.add(item.key); return { key: item.key, input, accessedOn: item.accessedOn, evidenceNote: item.evidenceNote };
  });
  const used = new Set<string>();
  const drafts = value.drafts.map((item: unknown) => {
    if (!exact(item, ['ingredientId', 'content']) || !id(item.ingredientId) || ingredientIds.has(item.ingredientId)) invalid();
    const content = validateContent(item.content);
    if (!content.educationText || !content.safetyText || !content.sourceRefs.length ||
      content.sourceRefs.some(ref => !keys.has(ref.id) || ref.revision !== 1)) invalid();
    content.sourceRefs.forEach(ref => used.add(ref.id)); ingredientIds.add(item.ingredientId);
    return { ingredientId: item.ingredientId, content };
  });
  if (used.size !== keys.size) invalid();
  return { schemaVersion: 'private-editorial-pack.1', visibility: 'private', professionalReviewState: 'pending',
    publicationEnabled: false, externalAiEnabled: false, sources, drafts };
}

export function readEditorialReviewPack(filename: string): EditorialReviewPack {
  const path = resolve(filename); assertNoLinks(path);
  const stat = lstatSync(path); if (!stat.isFile() || stat.size < 1 || stat.size > 128 * 1024) invalid();
  return parseEditorialReviewPack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Only provisions a NEW isolated demo. It cannot import into a working store,
 * attest source checks/qualifications, submit tasks, publish, or invoke AI. */
export async function prepareEditorialReviewDemo(root: string, raw: unknown) {
  const pack = parseEditorialReviewPack(raw);
  const seedFile = join(root, 'data/catalog.seed.json'); assertNoLinks(seedFile);
  const seed = validateSeed(JSON.parse(readFileSync(seedFile, 'utf8')) as unknown);
  if (pack.drafts.some(draft => !seed.ingredients.some(item => item.id === draft.ingredientId))) invalid();
  const prepared = await prepareLocalDemo(root);
  const credentialValue: unknown = JSON.parse(readFileSync(prepared.credentialsFile, 'utf8'));
  if (!exact(credentialValue, ['purpose', 'accounts']) || credentialValue.purpose !== 'isolated_local_editorial_demo' || !Array.isArray(credentialValue.accounts)) invalid();
  const editor = credentialValue.accounts.find((value: unknown) => exact(value, ['username', 'password', 'role']) && value.role === 'editor');
  if (!exact(editor, ['username', 'password', 'role']) || editor.role !== 'editor' || !text(editor.username, 80) || !text(editor.password, 100)) invalid();
  const stores = await openConfiguredStore(seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: join(prepared.directory, 'editorial.sqlite') });
  let token: string | undefined;
  const mapping = new Map<string, ManagedSource>();
  const revisions: { ingredientId: string; revision: number; digest: string }[] = [];
  try {
    const login = await stores.auth.login(editor.username, editor.password, 'private-review-pack'); token = login.token;
    for (const source of pack.sources) mapping.set(source.key, await stores.workflow.saveSource(source.input, login.info.user, undefined, 0, token));
    for (const draft of pack.drafts) {
      const content: DraftContent = { ...draft.content, sourceRefs: draft.content.sourceRefs.map(ref => {
        const source = mapping.get(ref.id); if (!source) invalid();
        return { id: source.id, revision: source.revision, locator: ref.locator };
      }) };
      const saved = await stores.workflow.saveDraft(draft.ingredientId, content, 0, login.info.user, token);
      if (saved.state !== 'draft' || saved.visibility !== 'private' || saved.publicationEnabled !== false || saved.professionalReviewState !== 'pending') throw new Error('Private draft invariant failed');
      revisions.push({ ingredientId: saved.ingredientId, revision: saved.revision, digest: saved.digest });
    }
  } finally { try { if (token) await stores.auth.logout(token, editor.username); } finally { await stores.close(); } }
  const packDigest = `sha256:${createHash('sha256').update(JSON.stringify(pack)).digest('hex')}`;
  const report = { schemaVersion: 'private-editorial-demo.1', demoId: prepared.demoId, packDigest, sourceCount: mapping.size, revisions,
    sourceChecksRecorded: 0, professionalReviewsRecorded: 0, tasksSubmitted: 0, publicationEnabled: false, externalAiEnabled: false };
  writeFileSync(join(prepared.directory, 'review-pack.json'), JSON.stringify(pack, null, 2), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(prepared.directory, 'review-pack.html'), editorialReviewHtml(pack), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(prepared.directory, 'review-pack-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return { ...prepared, report };
}
