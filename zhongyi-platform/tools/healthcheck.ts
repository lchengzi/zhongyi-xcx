import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { runtimeConfig } from '../server/runtime-config.js';
import { readSecretFile } from '../server/secret-file.js';

try {
  const config = runtimeConfig(); const secure = config.tls.mode === 'direct';
  const hostname = secure ? new URL(config.authentication.allowedOrigins![0]).hostname : '127.0.0.1';
  const ca = secure && process.env.TLS_HEALTH_CA_FILE ? readSecretFile(process.env.TLS_HEALTH_CA_FILE, 65536) : undefined;
  const request = (secure ? httpsRequest : httpRequest)({
    hostname: '127.0.0.1', port: config.port, path: '/api/ready', method: 'GET', timeout: 4000,
    ...(secure ? { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: isIP(hostname) ? undefined : hostname, ca } : {})
  }, (response) => {
    let body = ''; response.setEncoding('utf8');
    response.on('data', (chunk: string) => { body += chunk; if (body.length > 1024) request.destroy(); });
    response.on('error', () => { process.exitCode = 1; });
    response.on('end', () => { try { if (response.statusCode !== 200 || JSON.parse(body).ok !== true) process.exitCode = 1; } catch { process.exitCode = 1; } });
  });
  request.on('timeout', () => request.destroy()); request.on('error', () => { process.exitCode = 1; }); request.end();
} catch { process.exitCode = 1; }
