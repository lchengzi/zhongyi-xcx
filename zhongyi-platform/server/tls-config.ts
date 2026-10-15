import { X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { createSecureContext, type SecureContextOptions } from 'node:tls';
import { readSecretFile } from './secret-file.js';
import type { RuntimeConfig } from './runtime-config.js';

export function tlsOptions(config: RuntimeConfig, now = Date.now()): SecureContextOptions | undefined {
  if (config.tls.mode === 'off') return undefined;
  const cert = readSecretFile(config.tls.certificateFile, 65536); const key = readSecretFile(config.tls.keyFile, 16384);
  const certificate = new X509Certificate(cert); const privateKey = createPrivateKey(key);
  if (!certificate.checkPrivateKey(privateKey) || certificate.ca || now < Date.parse(certificate.validFrom) || now >= Date.parse(certificate.validTo)) throw new Error('Certificate identity, validity or key mismatch');
  for (const origin of config.authentication.allowedOrigins || []) {
    const hostname = new URL(origin).hostname;
    if (!(isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname, { subject: 'never' }))) throw new Error('Trusted origin not covered by certificate SAN');
  }
  const options: SecureContextOptions = { cert, key, minVersion: 'TLSv1.2' };
  createSecureContext(options); // Parse/verify key pair before any database opens.
  return options;
}
