import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { UserRole } from '../shared/contracts.js';
import { createApp } from './app.js';
import { DEFAULT_ASSISTANT_LIMITS } from './assistant-limits.js';
import { providerFromEnv } from './assistant-provider.js';
import { assertNoLinks } from './demo-secrets.js';
import { runtimeConfig } from './runtime-config.js';
import { validateSeed } from './seed.js';
import { openConfiguredStore } from './store-config.js';
import { PrivatePhotoRegistry } from './private-photos.js';
import { PhotoDerivativeRegistry } from './photo-derivative-registry.js';
import { EditorialReferenceRegistry } from './editorial-references.js';

const demoIdPattern = /^demo-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const purpose = 'isolated_local_editorial_demo';
interface DemoManifest { schemaVersion: 1; purpose: typeof purpose; demoId: string; catalogDigest: string; releaseId: string; createdAt: string }
export interface DemoCredential { username: string; password: string; role: UserRole }
export interface LocalDemoPhotoOptions { manifest: string; derivatives: string }

export function localDemoStartArgs(args: readonly string[]): { demoId: string; port: number; photos?: LocalDemoPhotoOptions; researchManifest?: string } {
  if (args[0] !== 'start' || !demoIdPattern.test(args[1] ?? '') || args.length < 2 || args.length > 10 || args.length % 2 !== 0) throw new Error('Invalid local demo arguments');
  const values = new Map<string, string>();
  for (let index = 2; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--port', '--photo-manifest', '--photo-derivatives', '--research-manifest'].includes(key) || !value || values.has(key)) throw new Error('Invalid local demo arguments');
    values.set(key, value);
  }
  const rawPort = values.get('--port') ?? '4314', port = Number(rawPort);
  if (!/^\d{4,5}$/.test(rawPort) || port < 1024 || port > 65535) throw new Error('Invalid local demo port');
  const manifest = values.get('--photo-manifest'), derivatives = values.get('--photo-derivatives');
  if ((manifest === undefined) !== (derivatives === undefined) || (manifest !== undefined && derivatives !== undefined && (!isAbsolute(manifest) || !isAbsolute(derivatives)))) throw new Error('Explicit paired private photo paths required');
  const researchManifest = values.get('--research-manifest');
  if (researchManifest !== undefined && !isAbsolute(researchManifest)) throw new Error('Explicit private research manifest required');
  return { demoId: args[1], port, ...(manifest && derivatives ? { photos: { manifest, derivatives } } : {}), ...(researchManifest ? { researchManifest } : {}) };
}

const contained = (parent: string, child: string) => { const value = relative(parent, child); return !!value && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value); };
function demoPhotoLibrary(root: string, options?: LocalDemoPhotoOptions) {
  if (options === undefined) return;
  if (!options || Object.keys(options).sort().join(',') !== 'derivatives,manifest' ||
    typeof options.manifest !== 'string' || typeof options.derivatives !== 'string' || !isAbsolute(options.manifest) || !isAbsolute(options.derivatives)) throw new Error('Explicit paired private photo paths required');
  const manifest = resolve(options.manifest), assetRoot = dirname(manifest), derivatives = resolve(options.derivatives);
  if (!contained(resolve(root, '../zhongyi/content-private'), assetRoot) || !contained(resolve(root, '.local/photo-derivatives'), derivatives)) throw new Error('Local demo photos must remain in project-private asset directories');
  const privatePhotos = new PrivatePhotoRegistry(assetRoot, manifest), privateDerivatives = new PhotoDerivativeRegistry(derivatives, privatePhotos);
  for (const target of [resolve(root, 'dist'), resolve(root, '../apps/miniprogram')]) { privatePhotos.assertStaticIsolation(target); privateDerivatives.assertIsolation(target); }
  if (privatePhotos.list().items.some(photo => !privateDerivatives.metadata(photo.id))) throw new Error('Local demo display library is incomplete');
  return { privatePhotos, privateDerivatives };
}

function demoParent(root: string): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Local HTTP demos cannot run in production mode');
  if (!isAbsolute(root)) throw new Error('Absolute project root required');
  assertNoLinks(root);
  if (!lstatSync(root).isDirectory()) throw new Error('Project directory required');
  const parent = resolve(root, '.local', 'local-demo');
  assertNoLinks(parent);
  return parent;
}
function regularFile(path: string, maxBytes?: number): void {
  assertNoLinks(path);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size === 0 || (maxBytes !== undefined && stat.size > maxBytes)) throw new Error('Expected a nonempty regular demo file');
}
function jsonFile(path: string, maxBytes: number): unknown {
  regularFile(path, maxBytes);
  return JSON.parse(readFileSync(path, 'utf8'));
}
function directoryFor(root: string, demoId: string): string {
  if (!demoIdPattern.test(demoId)) throw new Error('Expected the generated demo ID, not a filesystem path');
  const directory = join(demoParent(root), demoId);
  assertNoLinks(directory);
  if (!lstatSync(directory).isDirectory()) throw new Error('Prepared demo directory required');
  return directory;
}

// Provisioning never opens the host's configured database or reads its secrets.
// A final manifest is the commit marker; interrupted preparation cannot start.
export async function prepareLocalDemo(root: string): Promise<{ demoId: string; directory: string; credentialsFile: string }> {
  const parent = demoParent(root);
  const seed = validateSeed(jsonFile(resolve(root, 'data', 'catalog.seed.json'), 2 * 1024 * 1024));
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertNoLinks(parent);
  const demoId = `demo-${randomUUID()}`;
  const directory = join(parent, demoId);
  mkdirSync(directory, { mode: 0o700 });
  const filename = join(directory, 'editorial.sqlite');
  closeSync(openSync(filename, 'wx', 0o600));
  writeFileSync(join(directory, 'catalog.seed.json'), JSON.stringify(seed), { flag: 'wx', mode: 0o600 });
  const stores = await openConfiguredStore(seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: filename });
  const credentials: DemoCredential[] = [];
  try {
    for (const role of ['admin', 'editor', 'reviewer'] as const) {
      const username = `demo-${role}`; const password = randomBytes(24).toString('base64url');
      await stores.auth.createUser(username, password, role, 'isolated-demo-setup', role === 'admin');
      credentials.push({ username, password, role });
    }
  } finally { await stores.close(); }
  // An ownership marker, not authorization or professional review evidence.
  const db = new DatabaseSync(filename);
  try { db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('localDemoId', demoId); }
  finally { db.close(); }
  const credentialsFile = join(directory, 'credentials.json');
  writeFileSync(credentialsFile, JSON.stringify({ purpose, accounts: credentials }, null, 2), { flag: 'wx', mode: 0o600 });
  const manifest: DemoManifest = { schemaVersion: 1, purpose, demoId, catalogDigest: seed.digest, releaseId: seed.releaseId, createdAt: new Date().toISOString() };
  writeFileSync(join(directory, 'demo.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return { demoId, directory, credentialsFile };
}

export async function startLocalDemo(root: string, demoId: string, port = 4314, photoOptions?: LocalDemoPhotoOptions, researchManifest?: string) {
  // Deliberately pass complete explicit configuration, not process.env. No
  // inherited database URL, bind host, TLS, publication or AI switch applies.
  // The application's production-mode prohibition remains in force.
  const config = runtimeConfig({ PORT: String(port), BIND_HOST: '127.0.0.1', AUTH_MODE: 'accounts',
    ALLOWED_ORIGINS: `http://127.0.0.1:${port}`, EDUCATION_PUBLICATION_ENABLED: 'false', TLS_MODE: 'off' });
  const directory = directoryFor(root, demoId);
  const value = jsonFile(join(directory, 'demo.json'), 4096);
  const keys = ['schemaVersion', 'purpose', 'demoId', 'catalogDigest', 'releaseId', 'createdAt'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))) throw new Error('Invalid demo manifest');
  const manifest = value as DemoManifest;
  if (manifest.schemaVersion !== 1 || manifest.purpose !== purpose || manifest.demoId !== demoId ||
    typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Invalid demo manifest');
  const seed = validateSeed(jsonFile(join(directory, 'catalog.seed.json'), 2 * 1024 * 1024));
  if (seed.digest !== manifest.catalogDigest || seed.releaseId !== manifest.releaseId) throw new Error('Demo catalog identity changed');
  const staticRoot = resolve(root, 'dist');
  regularFile(join(staticRoot, 'index.html'));
  // Explicit paths only. Viewing prepared private pixels does not initialize a
  // publication journal or inherit a publication/AI switch from the host.
  const photoLibrary = demoPhotoLibrary(root, photoOptions);
  let editorialReferences: EditorialReferenceRegistry | undefined;
  if (researchManifest !== undefined) {
    if (!isAbsolute(researchManifest) || !contained(resolve(root, '../zhongyi/content-private'), resolve(researchManifest))) throw new Error('Research manifest must be project-private');
    editorialReferences = new EditorialReferenceRegistry(researchManifest);
    for (const target of [staticRoot, resolve(root, '../apps/miniprogram')]) editorialReferences.assertIsolation(target);
  }
  const filename = join(directory, 'editorial.sqlite');
  regularFile(filename);
  // Fail before a writable connection if a file was removed or another demo's
  // database was substituted. No silent recreation or working-store fallback.
  const check = new DatabaseSync(filename, { readOnly: true });
  try {
    const marker = check.prepare("SELECT value FROM metadata WHERE key = 'localDemoId'").get() as { value: string } | undefined;
    if (marker?.value !== demoId) throw new Error('Database does not belong to this demo');
  } finally { check.close(); }
  const stores = await openConfiguredStore(seed, { DATABASE_PROVIDER: 'sqlite', DB_PATH: filename });
  try {
    await stores.catalog.publicSnapshot();
    const app = createApp(stores, config.authentication, staticRoot, { publicationEnabled: false, ...photoLibrary, editorialReferences,
      assistantProvider: providerFromEnv({}), assistantLimits: DEFAULT_ASSISTANT_LIMITS });
    const server = createServer(app);
    await new Promise<void>((ready, reject) => {
      const failed = (error: Error) => { server.off('listening', listening); reject(error); };
      const listening = () => { server.off('error', failed); ready(); };
      server.once('error', failed); server.once('listening', listening); server.listen(config.port, config.bindHost);
    });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done()); server.closeIdleConnections();
    }).then(() => stores.close());
    return { url: `http://127.0.0.1:${config.port}`, close };
  } catch (error) { await stores.close(); throw error; }
}
