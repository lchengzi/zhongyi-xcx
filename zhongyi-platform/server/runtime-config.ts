import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { validateAuthOptions, type AuthOptions } from './auth-http.js';
import { publicationEnabled } from './publication-config.js';

export interface RuntimeConfig { port: number; bindHost: '127.0.0.1' | '0.0.0.0'; authentication: AuthOptions; generatedLocalKey: boolean; publicationEnabled: boolean; tls: { mode: 'off' } | { mode: 'direct'; certificateFile: string; keyFile: string } }

// Validate before opening a database: bad deployment configuration must not
// create a local SQLite file or expose legacy editor-key mode on a network.
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const portText = env.PORT || '4310';
  const port = Number(portText);
  if (!/^\d{4,5}$/.test(portText) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT');
  const bindHost = env.BIND_HOST || '127.0.0.1';
  if (bindHost !== '127.0.0.1' && bindHost !== '0.0.0.0') throw new Error('Invalid BIND_HOST');
  const mode = env.AUTH_MODE || 'accounts';
  if (mode !== 'accounts' && mode !== 'local-key') throw new Error('Invalid AUTH_MODE');
  const publication = publicationEnabled(env);
  if (publication && mode !== 'accounts') throw new Error('Publication requires account authentication');
  const tlsMode = env.TLS_MODE || 'off';
  if (tlsMode !== 'off' && tlsMode !== 'direct') throw new Error('Invalid TLS_MODE');
  if (tlsMode === 'off' && (env.TLS_CERT_FILE || env.TLS_KEY_FILE || env.NODE_ENV === 'production')) throw new Error('Production requires explicit direct TLS; certificate files cannot be ignored');
  if (tlsMode === 'direct' && (mode !== 'accounts' || !env.ALLOWED_ORIGINS || !env.TLS_CERT_FILE || !env.TLS_KEY_FILE ||
    !isAbsolute(env.TLS_CERT_FILE) || !isAbsolute(env.TLS_KEY_FILE) || env.TLS_CERT_FILE === env.TLS_KEY_FILE)) throw new Error('Direct TLS requires accounts, trusted origins and separate absolute certificate/key files');
  if (bindHost !== '127.0.0.1' && (mode !== 'accounts' || !env.ALLOWED_ORIGINS?.trim())) throw new Error('Network binding requires accounts and explicit trusted origins');
  const generatedLocalKey = mode === 'local-key' && !env.EDITOR_TOKEN;
  const authentication: AuthOptions = {
    mode,
    token: mode === 'local-key' ? env.EDITOR_TOKEN || randomBytes(32).toString('hex') : undefined,
    secureCookies: env.NODE_ENV === 'production' || tlsMode === 'direct',
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()) :
      [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']
  };
  validateAuthOptions(authentication, env.NODE_ENV === 'production' || tlsMode === 'direct');
  return { port, bindHost, authentication, generatedLocalKey, publicationEnabled: publication, tls: tlsMode === 'direct' ?
    { mode: 'direct', certificateFile: env.TLS_CERT_FILE!, keyFile: env.TLS_KEY_FILE! } : { mode: 'off' } };
}
