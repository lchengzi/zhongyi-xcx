import { registerPublicationHttpCases } from './publication-http-cases.js';
import { postgresPublicationHttpBackend } from './publication-http-fixture.js';

if (!process.env.PG_TEST_DATABASE_URL || !process.env.PG_TEST_NONCE) throw new Error('Use the owned real PostgreSQL test controller; no optional skipped tests');
registerPublicationHttpCases('postgres', postgresPublicationHttpBackend);
