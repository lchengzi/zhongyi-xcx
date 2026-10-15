import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Account, SecurityEvent, SessionInfo, UserRole } from '../shared/contracts.js';

const WINDOW_MS = 15 * 60 * 1000;
export const SESSION_MS = 8 * 60 * 60 * 1000;
const accountColumns = 'id, username, role, active, revision, created_at createdAt';
interface StoredAccount extends Omit<Account, 'active'> { active: number }
interface PasswordRow extends StoredAccount { password_hash: string; password_salt: string }
const account = (row: StoredAccount): Account => ({ ...row, active: row.active === 1 });
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const isRole = (value: unknown): value is UserRole => typeof value === 'string' && ['admin', 'editor', 'reviewer'].includes(value);
export const validUsername = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9._-]{2,39}$/.test(value);
export const validPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 128;
export class AccountError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

export class AuthRepository {
  private pendingLogins = 0;
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  users(): Account[] {
    return (this.db.prepare(`SELECT ${accountColumns} FROM users ORDER BY username`).all() as unknown as StoredAccount[]).map(account);
  }
  private user(id: string): Account | undefined {
    const row = this.db.prepare(`SELECT ${accountColumns} FROM users WHERE id = ?`).get(id) as unknown as StoredAccount | undefined;
    return row ? account(row) : undefined;
  }
  private record(actor: string, action: SecurityEvent['action'], target: string | null): void {
    this.db.prepare('INSERT INTO security_events (actor, action, target, created_at) VALUES (?, ?, ?, ?)')
      .run(actor, action, target, new Date(this.now()).toISOString());
  }
  events(): SecurityEvent[] {
    return this.db.prepare('SELECT id, actor, action, target, created_at createdAt FROM security_events ORDER BY id DESC LIMIT 50').all() as unknown as SecurityEvent[];
  }
  async createUser(username: string, password: string, role: UserRole, actor: string, bootstrap = false, authorize?: () => void, sessionToken?: string): Promise<Account> {
    if (!validUsername(username) || !validPassword(password) || !isRole(role)) throw new AccountError(400, 'invalid_account', '用户名需为 3–40 位小写字母、数字或 ._-；密码需为 12–128 字。');
    const salt = randomBytes(32).toString('hex');
    const hash = (await derive(password, salt)).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Password hashing awaits a worker; recheck the caller inside the write transaction.
      authorize?.();
      if (sessionToken !== undefined) this.requireAdmin(sessionToken, actor);
      if (bootstrap && this.users().length) throw new AccountError(409, 'already_initialized', '账号库已初始化，请由现有管理员创建账号。');
      if (this.db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new AccountError(409, 'username_exists', '用户名已存在。');
      const id = randomUUID();
      this.db.prepare('INSERT INTO users (id, username, password_hash, password_salt, role, active, revision, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)')
        .run(id, username, hash, salt, role, new Date(this.now()).toISOString());
      this.record(actor, 'account_created', username);
      this.db.exec('COMMIT');
      return this.user(id)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private requireAdmin(token: string, actor: string): void {
    const current = this.session(token);
    if (!current || current.user.username !== actor || current.user.role !== 'admin') throw new AccountError(401, 'unauthorized', '会话或管理权限已失效，请重新登录。');
  }
  updateUser(id: string, role: UserRole, active: boolean, expectedRevision: number, actor: string, sessionToken?: string): Account {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (sessionToken !== undefined) this.requireAdmin(sessionToken, actor);
      const current = this.user(id);
      if (!current) throw new AccountError(404, 'not_found', '账号不存在。');
      if (current.revision !== expectedRevision) throw new AccountError(409, 'revision_conflict', '账号已被修改，请刷新后重试。');
      if (current.active && current.role === 'admin' && (!active || role !== 'admin') && this.users().filter((user) => user.active && user.role === 'admin').length <= 1) {
        throw new AccountError(409, 'last_admin', '至少保留一个启用的管理员账号。');
      }
      this.db.prepare('UPDATE users SET role = ?, active = ?, revision = revision + 1 WHERE id = ?').run(role, active ? 1 : 0, id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      this.record(actor, 'account_updated', current.username);
      this.db.exec('COMMIT');
      return this.user(id)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private attempt(key: string, limit: number, now: number): void {
    const entry = this.db.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get(key) as { attempts: number } | undefined;
    if (entry && entry.attempts >= limit) throw new AccountError(429, 'rate_limited', '登录尝试过多，请稍后重试。');
    this.db.prepare(`INSERT INTO login_attempts (key, attempts, reset_at) VALUES (?, 1, ?)
      ON CONFLICT (key) DO UPDATE SET attempts = attempts + 1`).run(key, now + WINDOW_MS);
  }
  private chargeAttempts(username: string, ip: string): void {
    const now = this.now(); let denied: AccountError | undefined;
    // One durable commit for both counters. Never hold this lock over scrypt.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').run(now);
      try {
        this.attempt(`ip:${tokenHash(ip)}`, 50, now);
        this.attempt(`user:${tokenHash(username)}`, 10, now);
      } catch (error) {
        // Account throttling must still charge the IP, as before. Only storage
        // failures roll back the whole charge; they cannot create a session.
        if (error instanceof AccountError && error.code === 'rate_limited') denied = error;
        else throw error;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back a storage failure. */ }
      throw error;
    }
    if (denied) throw denied;
  }
  async login(username: string, password: string, ip: string): Promise<{ token: string; info: SessionInfo }> {
    this.chargeAttempts(username, ip);
    if (this.pendingLogins >= 4) throw new AccountError(429, 'busy', '登录请求繁忙，请稍后重试。');
    this.pendingLogins++;
    try {
      const row = this.db.prepare(`SELECT ${accountColumns}, password_hash, password_salt FROM users WHERE username = ?`).get(username) as unknown as PasswordRow | undefined;
      // Unknown users still incur the same password derivation work, without revealing existence.
      const actual = await derive(password, row?.password_salt || 'unregistered-account-timing-padding');
      const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
      if (!timingSafeEqual(actual, expected) || !row?.active || !this.user(row.id)?.active || this.user(row.id)?.revision !== row.revision) {
        this.record('anonymous', 'login_failed', null);
        throw new AccountError(401, 'invalid_credentials', '用户名或密码不正确，或账号不可用。');
      }
      const token = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(32).toString('hex');
      const expiresAt = this.now() + SESSION_MS;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
        this.db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), row.id, csrfToken, expiresAt);
        this.record(row.username, 'login_succeeded', row.username);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return { token, info: { user: this.user(row.id)!, csrfToken, expiresAt: new Date(expiresAt).toISOString() } };
    } finally { this.pendingLogins--; }
  }
  session(token: string): SessionInfo | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    const row = this.db.prepare('SELECT user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash(token), this.now()) as { user_id: string; csrf_token: string; expires_at: number } | undefined;
    if (!row) return;
    const user = this.user(row.user_id);
    if (!user?.active) return;
    return { user, csrfToken: row.csrf_token, expiresAt: new Date(row.expires_at).toISOString() };
  }
  logout(token: string, actor: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      this.record(actor, 'logout', actor);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
