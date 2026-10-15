import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, RequestHandler } from 'express';
import { AccountError, isRole, validUsername } from './auth.js';
import type { AuthStore, WriteAuthority } from './stores.js';
import type { Account, SessionInfo, UserRole } from '../shared/contracts.js';

export interface AuthOptions {
  mode: 'accounts' | 'local-key';
  token?: string;
  allowedOrigins?: string[];
  secureCookies?: boolean;
}
interface Principal { kind: 'account' | 'local-key'; username: string; role: UserRole; token: string; info?: SessionInfo }
const same = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
function cookie(req: Request): string {
  const values = (req.get('Cookie') || '').split(';').map((item) => item.trim()).filter((item) => item.startsWith('food_session='));
  return values.length === 1 ? values[0].slice('food_session='.length) : '';
}
export const requireEditor: RequestHandler = (_req, res, next) => {
  const principal = res.locals.principal as Principal;
  if (principal.role === 'reviewer') { res.status(403).json({ error: 'forbidden', message: '审阅账号仅可查阅，不能修改编辑备注。' }); return; }
  next();
};
export const actorName = (locals: Record<string, unknown>): string => (locals.principal as Principal).username;
export const currentSessionToken = (locals: Record<string, unknown>): string | undefined => {
  const principal = locals.principal as Principal;
  return principal.kind === 'account' ? principal.token : undefined;
};
export function writeAuthority(locals: Record<string, unknown>): WriteAuthority | undefined {
  const principal = locals.principal as Principal;
  return principal.info ? { account: principal.info.user, token: principal.token } : undefined;
}
export function currentAccount(locals: Record<string, unknown>): Account {
  const principal = locals.principal as Principal;
  if (!principal.info) throw new AccountError(403, 'account_required', '内容协作需使用正式账号，本地密钥模式不可操作。');
  return principal.info.user;
}

export function validateAuthOptions(options: AuthOptions, production = process.env.NODE_ENV === 'production'): Set<string> {
  if (options.mode === 'local-key' && (!options.token || options.token.length < 32)) throw new Error('Local editor token must have at least 32 characters');
  if (production && (options.mode !== 'accounts' || !options.secureCookies)) throw new Error('Production requires account authentication and HTTPS cookies');
  const origins = new Set(options.allowedOrigins || ['http://127.0.0.1:4310', 'http://localhost:4310', 'http://127.0.0.1:5173', 'http://localhost:5173']);
  if (!origins.size) throw new Error('At least one trusted origin is required');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol) ||
      (production && url.protocol !== 'https:')) throw new Error('Invalid trusted origin');
  }
  return origins;
}

export function configureAuth(app: Express, auth: AuthStore, options: AuthOptions): void {
  const origins = validateAuthOptions(options);
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: !!options.secureCookies, path: '/' };
  const originAllowed: RequestHandler = (req, res, next) => {
    if (!origins.has(req.get('Origin') || '') || req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ error: 'invalid_origin', message: '请求来源不允许，请从工作台页面操作。' }); return;
    }
    next();
  };
  app.get('/api/v1/auth/config', (_req, res) => { res.json({ mode: options.mode }); });
  app.post('/api/v1/auth/login', originAllowed, async (req, res) => {
    if (options.mode !== 'accounts') { res.status(404).json({ error: 'not_found', message: '当前为本地密钥演示模式。' }); return; }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
      !validUsername(body.username) || typeof body.password !== 'string' || !body.password.length || body.password.length > 128) {
      res.status(400).json({ error: 'invalid_login', message: '请输入有效的用户名和密码。' }); return;
    }
    const previous = cookie(req);
    const { token, info } = await auth.login(body.username, body.password, req.ip || 'unknown');
    // Successful login rotates the browser's existing session; failed login leaves it untouched.
    const previousInfo = await auth.session(previous);
    if (previousInfo) await auth.logout(previous, previousInfo.user.username);
    res.cookie('food_session', token, { ...cookieOptions, expires: new Date(info.expiresAt) });
    res.json(info);
  });
  app.use('/api', async (req, res, next) => {
    let principal: Principal | undefined;
    if (options.mode === 'local-key') {
      if (same(req.get('Authorization') || '', `Bearer ${options.token}`)) principal = { kind: 'local-key', username: 'local-key', role: 'editor', token: '' };
    } else if (!req.get('Authorization')) {
      const token = cookie(req);
      const info = await auth.session(token);
      if (info) principal = { kind: 'account', username: info.user.username, role: info.user.role, token, info };
    }
    if (!principal) { res.status(401).json({ error: 'unauthorized', message: options.mode === 'accounts' ? '会话已失效，请重新登录；未保存的输入仍留在当前页面。' : '请输入本地服务启动时显示的编辑密钥。' }); return; }
    res.locals.principal = principal;
    if (principal.kind === 'account' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!same(req.get('X-CSRF-Token') || '', principal.info!.csrfToken)) {
        res.status(403).json({ error: 'invalid_csrf', message: '请求校验失败，请重新登录后操作。' }); return;
      }
      originAllowed(req, res, next); return;
    }
    next();
  });
  app.get('/api/v1/auth/me', (_req, res) => {
    const principal = res.locals.principal as Principal;
    if (!principal.info) { res.status(404).json({ error: 'not_found', message: '本地密钥模式不提供账号会话。' }); return; }
    res.json(principal.info);
  });
  app.post('/api/v1/auth/logout', async (_req, res) => {
    const principal = res.locals.principal as Principal;
    if (principal.kind === 'account') await auth.logout(principal.token, principal.username);
    res.clearCookie('food_session', cookieOptions);
    res.json({ ok: true });
  });
  const admin: RequestHandler = (_req, res, next) => {
    const principal = res.locals.principal as Principal;
    if (principal.kind !== 'account' || principal.role !== 'admin') { res.status(403).json({ error: 'forbidden', message: '仅管理员可以管理账号。' }); return; }
    next();
  };
  app.get('/api/v1/users', admin, async (_req, res) => { res.json({ items: await auth.users() }); });
  app.get('/api/v1/security-events', admin, async (_req, res) => { res.json({ items: await auth.events() }); });
  app.post('/api/v1/users', admin, async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || !isRole(body.role)) {
      res.status(400).json({ error: 'invalid_account', message: '账号字段或角色无效。' }); return;
    }
    const principal = res.locals.principal as Principal;
    res.status(201).json(await auth.createUser(body.username, body.password, body.role, principal.username, false, undefined, principal.token));
  });
  app.put('/api/v1/users/:id', admin, async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || !isRole(body.role) ||
      typeof body.active !== 'boolean' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
      res.status(400).json({ error: 'invalid_account', message: '账号状态、角色或修订号无效。' }); return;
    }
    const principal = res.locals.principal as Principal;
    if (principal.info?.user.id === id && (body.role !== 'admin' || !body.active)) {
      throw new AccountError(409, 'self_lockout', '不能禁用自己或取消自己的管理员权限。');
    }
    res.json(await auth.updateUser(id, body.role, body.active, body.expectedRevision, principal.username, principal.token));
  });
}
