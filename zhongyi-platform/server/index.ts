import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createApp } from './app.js';
import { runtimeConfig } from './runtime-config.js';
import { tlsOptions } from './tls-config.js';
import { openConfiguredStore } from './store-config.js';
import { MigrationError } from './migration-snapshot.js';
import type { RepositoryBundle } from './stores.js';
import { writeRequestLog } from './request-log.js';
import { writeFailureLog } from './failure-diagnostics.js';
import { privatePhotosFromEnvironment } from './private-photos.js';
import { photoPublicationFiles } from './photo-publication-config.js';

let stores: RepositoryBundle | undefined;
let closingStores: Promise<void> | undefined;
const closeStores = () => closingStores ??= Promise.resolve().then(() => stores?.close());
try {
  const config = runtimeConfig();
  const tls = tlsOptions(config);
  const privatePhotos = privatePhotosFromEnvironment(process.env, config.authentication.mode);
  const photoPublication = photoPublicationFiles(process.env, privatePhotos);
  const root = process.cwd();
  const seed = JSON.parse(readFileSync(resolve(root, 'data/catalog.seed.json'), 'utf8'));
  stores = await openConfiguredStore(seed);
  const app = createApp(stores, config.authentication, resolve(root, 'dist'), { publicationEnabled: config.publicationEnabled, privatePhotos, photoPublication,
    requestLog: writeRequestLog, ...(process.env.API_FAILURE_DIAGNOSTICS === 'true' ? { failureLog: writeFailureLog } : {}) });
  const server = (tls ? httpsServer(tls, app) : httpServer(app)).listen(config.port, config.bindHost, () => {
    console.log(`Workbench listener: ${config.bindHost}:${config.port}`);
    if (config.bindHost === '127.0.0.1') console.log(`Local workbench: ${tls ? 'https' : 'http'}://127.0.0.1:${config.port}`);
    console.log(`Transport: ${tls ? 'direct HTTPS (TLS 1.2 minimum)' : 'local HTTP demo'}`);
    console.log(`Database provider: ${stores!.engine}`);
    if (config.generatedLocalKey) console.log(`Local editor key (this process only): ${config.authentication.token}`);
    if (config.authentication.mode === 'accounts') console.log('Account mode. Initialize the first admin with the bootstrap CLI. No default password is provided.');
    console.log(`Education publication capability: ${config.publicationEnabled ? 'explicitly enabled; each snapshot still requires independent current authorization' : 'disabled'}. Medical services are not supported.`);
  });
  server.once('error', () => {
    console.error('Server could not start. No database fallback was attempted.');
    void closeStores().catch(() => console.error('Database close failed. Credentials are not printed.')).finally(() => { process.exitCode = 1; });
  });
  let stopping: Promise<void> | undefined;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopping ??= new Promise<void>((done) => { server.close(() => done()); server.closeIdleConnections(); })
        .then(closeStores).then(() => { process.exitCode = 0; }, () => {
          console.error('Graceful shutdown failed. Credentials are not printed.'); process.exitCode = 1;
        });
    });
  }
} catch (error) {
  await closeStores().catch(() => {});
  console.error(error instanceof MigrationError ? `${error.code}: ${error.message}` : 'Application startup failed. Check configuration and database availability; credentials are not printed.');
  process.exitCode = 1;
}
