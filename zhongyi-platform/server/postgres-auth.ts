import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Account, SecurityEvent, SessionInfo, UserRole } from '../shared/contracts.js';
import type { AuthStore } from './stores.js';
import { AccountError, derive, isRole, SESSION_MS, tokenHash, validPassword, validUsername } from './auth.js';
import { accountColumns, PostgresContext, PostgresRuntime, sessionIn, toAccount, type StoredAccount } from './postgres-runtime.js';

export class PostgresAuth implements AuthStore {
  private pendingLogins = 0;
  constructor(private readonly runtime: PostgresRuntime, private readonly now: () => number = Date.now) {}
  users(): Promise<Account[]> {
    return this.runtime.read(async (context) => (await context.all<StoredAccount>(`SELECT ${accountColumns} FROM users ORDER BY username COLLATE "C"`)).map(toAccount));
  }
  private async user(context: PostgresContext, id: string): Promise<Account | undefined> {
    const row = await context.get<StoredAccount>(`SELECT ${accountColumns} FROM users WHERE id = $1`, [id]);
    return row ? toAccount(row) : undefined;
  }
  private record(context: PostgresContext, actor: string, action: SecurityEvent['action'], target: string | null): Promise<void> {
    return context.run('INSERT INTO security_events (actor, action, target, created_at) VALUES ($1, $2, $3, $4)', [actor, action, target, new Date(this.now()).toISOString()]);
  }
  events(): Promise<SecurityEvent[]> { return this.runtime.read((context) => context.all('SELECT id, actor, action, target, created_at AS "createdAt" FROM security_events ORDER BY id DESC LIMIT 50')); }
  private async requireAdmin(context: PostgresContext, token: string, actor: string): Promise<SessionInfo> {
    const current = await sessionIn(context, token, this.now());
    if (!current || current.user.username !== actor || current.user.role !== 'admin') throw new AccountError(401, 'unauthorized', '会话或管理权限已失效，请重新登录。');
    return current;
  }
  async createUser(username: string, password: string, role: UserRole, actor: string, bootstrap = false, authorize?: () => void, sessionToken?: string): Promise<Account> {
    if (!validUsername(username) || !validPassword(password) || !isRole(role)) throw new AccountError(400, 'invalid_account', '用户名需为 3–40 位小写字母、数字或 ._-；密码需为 12–128 字。');
    const salt = randomBytes(32).toString('hex'); const hash = (await derive(password, salt)).toString('hex');
    return this.runtime.write(async (context) => {
      authorize?.();
      if (sessionToken !== undefined) await this.requireAdmin(context, sessionToken, actor);
      if (bootstrap && await context.get('SELECT 1 FROM users LIMIT 1')) throw new AccountError(409, 'already_initialized', '账号库已初始化，请由现有管理员创建账号。');
      if (await context.get('SELECT id FROM users WHERE username = $1', [username])) throw new AccountError(409, 'username_exists', '用户名已存在。');
      const id = randomUUID();
      await context.run('INSERT INTO users (id, username, password_hash, password_salt, role, active, revision, created_at) VALUES ($1, $2, $3, $4, $5, 1, 1, $6)', [id, username, hash, salt, role, new Date(this.now()).toISOString()]);
      await this.record(context, actor, 'account_created', username);
      return (await this.user(context, id))!;
    });
  }
  updateUser(id: string, role: UserRole, active: boolean, expectedRevision: number, actor: string, sessionToken?: string): Promise<Account> {
    return this.runtime.write(async (context) => {
      const caller = sessionToken !== undefined ? await this.requireAdmin(context, sessionToken, actor) : undefined;
      if (caller?.user.id === id && (role !== 'admin' || !active)) throw new AccountError(409, 'self_lockout', '不能禁用自己或取消自己的管理员权限。');
      const current = await this.user(context, id);
      if (!current) throw new AccountError(404, 'not_found', '账号不存在。');
      if (current.revision !== expectedRevision) throw new AccountError(409, 'revision_conflict', '账号已被修改，请刷新后重试。');
      if (current.active && current.role === 'admin' && (!active || role !== 'admin')) {
        const count = (await context.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE active = 1 AND role = 'admin'"))!.count;
        if (count <= 1) throw new AccountError(409, 'last_admin', '至少保留一个启用的管理员账号。');
      }
      await context.run('UPDATE users SET role = $1, active = $2, revision = revision + 1 WHERE id = $3', [role, active ? 1 : 0, id]);
      await context.run('DELETE FROM sessions WHERE user_id = $1', [id]);
      await this.record(context, actor, 'account_updated', current.username);
      return (await this.user(context, id))!;
    });
  }
  private attempt(key: string, limit: number): Promise<void> {
    return this.runtime.write(async (context) => {
      const now = this.now(); await context.run('DELETE FROM login_attempts WHERE reset_at <= $1', [now]);
      const entry = await context.get<{ attempts: number }>('SELECT attempts FROM login_attempts WHERE key = $1', [key]);
      if (entry && entry.attempts >= limit) throw new AccountError(429, 'rate_limited', '登录尝试过多，请稍后重试。');
      await context.run(`INSERT INTO login_attempts (key, attempts, reset_at) VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE SET attempts = login_attempts.attempts + 1`, [key, now + 15 * 60 * 1000]);
    });
  }
  async login(username: string, password: string, ip: string): Promise<{ token: string; info: SessionInfo }> {
    await this.attempt(`ip:${tokenHash(ip)}`, 50); await this.attempt(`user:${tokenHash(username)}`, 10);
    if (this.pendingLogins >= 4) throw new AccountError(429, 'busy', '登录请求繁忙，请稍后重试。');
    this.pendingLogins++;
    try {
      const row = await this.runtime.read((context) => context.get<StoredAccount & { password_hash: string; password_salt: string }>(`SELECT ${accountColumns}, password_hash, password_salt FROM users WHERE username = $1`, [username]));
      const actual = await derive(password, row?.password_salt || 'unregistered-account-timing-padding');
      const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
      const matches = expected.length === actual.length && timingSafeEqual(actual, expected);
      const result = await this.runtime.write(async (context) => {
        const current = row ? await this.user(context, row.id) : undefined;
        if (!matches || !row?.active || !current?.active || current.revision !== row.revision) {
          // Commit the failure event; throwing inside this transaction would lose it.
          await this.record(context, 'anonymous', 'login_failed', null);
          return { error: new AccountError(401, 'invalid_credentials', '用户名或密码不正确，或账号不可用。') };
        }
        const token = randomBytes(32).toString('hex'); const csrfToken = randomBytes(32).toString('hex'); const expiresAt = this.now() + SESSION_MS;
        await context.run('DELETE FROM sessions WHERE expires_at <= $1', [this.now()]);
        await context.run('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)', [tokenHash(token), row.id, csrfToken, expiresAt]);
        await this.record(context, current.username, 'login_succeeded', current.username);
        return { token, info: { user: current, csrfToken, expiresAt: new Date(expiresAt).toISOString() } };
      });
      if ('error' in result) throw result.error;
      return result;
    } finally { this.pendingLogins--; }
  }
  session(token: string): Promise<SessionInfo | undefined> { return this.runtime.read((context) => sessionIn(context, token, this.now())); }
  logout(token: string, actor: string): Promise<void> {
    return this.runtime.write(async (context) => {
      await context.run('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
      await this.record(context, actor, 'logout', actor);
    });
  }
}
