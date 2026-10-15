import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPostgresPool } from '../server/postgres-migration.js';

const connection = process.env.PG_TEST_DATABASE_URL;
if (!connection || !process.connected || !/^[a-f0-9]{32}$/.test(process.env.PG_TEST_NONCE || '')) throw new Error('Live owned PostgreSQL TLS controller required');
const original = new URL(connection);
if (original.hostname !== 'localhost' || original.searchParams.get('sslmode') !== 'verify-full' || !original.searchParams.has('sslrootcert')) {
  throw new Error('Full PostgreSQL verification requires the owned TLS connection, never a fallback');
}
const verified = new Set<string>();
function proof(name: string) {
  verified.add(name);
  if (verified.size === 4) process.send?.({ type: 'postgres-tls-proof', nonce: process.env.PG_TEST_NONCE,
    certificateChainVerified: true, hostnameMismatchRejected: true, untrustedCaRejected: true, plaintextRejected: true });
}

test('PostgreSQL application pool negotiates authenticated TLS and confirms encryption from the actual SQL backend', async () => {
  const pool = createPostgresPool(connection);
  try {
    const result = await pool.query('SELECT ssl, version, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].ssl, true);
    assert(['TLSv1.2', 'TLSv1.3'].includes(result.rows[0].version)); assert(result.rows[0].bits >= 128);
    proof('trusted');
  } finally { await pool.end(); }
});
test('PostgreSQL private CA is not accepted when absent from the application trust configuration', async () => {
  const url = new URL(connection); url.searchParams.delete('sslrootcert');
  const pool = createPostgresPool(url.toString());
  try {
    await assert.rejects(pool.query('SELECT 1'), (error: NodeJS.ErrnoException) =>
      ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code || ''));
    proof('untrusted');
  } finally { await pool.end(); }
});
test('PostgreSQL correct private CA cannot authorize a certificate for a different hostname', async () => {
  const url = new URL(connection); url.hostname = '127.0.0.1';
  const pool = createPostgresPool(url.toString());
  try {
    await assert.rejects(pool.query('SELECT 1'), (error: NodeJS.ErrnoException) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
    proof('hostname');
  } finally { await pool.end(); }
});
test('PostgreSQL TLS-only fixture rejects a real plaintext SQL connection instead of silently downgrading', async () => {
  const url = new URL(connection); url.search = '';
  const pool = createPostgresPool(url.toString());
  try {
    await assert.rejects(pool.query('SELECT 1'), (error: NodeJS.ErrnoException) => error.code === '28000');
    proof('plaintext');
  } finally { await pool.end(); }
});
