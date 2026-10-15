import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Account, AccountCreationIntent, AccountUpdateInput, SecurityEvent, SessionInfo, UserRole } from '../shared/contracts';
import { parseAccountRole, parseCreatedAccount, parseRefreshedAccountList, parseReloadedAccount, parseSecurityEventList, parseUpdatedAccount } from '../shared/account-response';
import { requestDecoded } from './api';
import { useDecodedReadResult } from './useReadResult';
import { problem, useActivity, type Activity, type ActivityHandler } from './workflow-shared';

export const roleLabel = (role: UserRole) => ({ admin: '管理员', editor: '编辑', reviewer: '编辑审阅' })[role];
const actionLabel = (action: SecurityEvent['action']) => ({ account_created: '创建账号', account_updated: '调整账号（撤销会话）', login_succeeded: '登录成功', login_failed: '登录失败', logout: '退出登录' })[action];
interface Operations { acquire: () => symbol | null; release: (owner: symbol) => void }
function UserRow({ user, session, updated, activityChanged, disabled, operations }: { user: Account; session: SessionInfo; updated: () => void; activityChanged: (id: string, value: Activity) => void; disabled: boolean; operations: Operations }) {
  const [baseline, setBaseline] = useState(user);
  const [role, setRole] = useState(user.role), [active, setActive] = useState(user.active);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [verificationRequired, setVerificationRequired] = useState(false);
  const guard = useRef<'idle' | 'working' | 'verify'>('idle'), operationController = useRef<AbortController | null>(null);
  const dirty = role !== baseline.role || active !== baseline.active || verificationRequired;
  const report = useCallback((value: Activity) => activityChanged(user.id, value), [user.id, activityChanged]);
  useActivity(dirty, busy, report);
  useEffect(() => {
    if (operationController.current?.signal.aborted && guard.current === 'working') {
      guard.current = 'verify'; setBusy(false); setVerificationRequired(true); setError('会话已变化，上一操作的结果不能确认，请重新加载权限。');
    }
    return () => operationController.current?.abort();
  }, [session]);
  useEffect(() => {
    // Another row's refresh is not permission to discard this input, rebase a
    // stale optimistic lock or resolve an uncertain write.
    if (!dirty && !busy && user.revision > baseline.revision) { setBaseline(user); setRole(user.role); setActive(user.active); }
  }, [user, dirty, busy, baseline.revision]);
  const self = user.id === session.user.id;
  async function save() {
    if (guard.current !== 'idle' || disabled || self || !dirty) return;
    if (!window.confirm('调整权限会撤销该账号的所有会话，需重新登录。继续吗？')) return;
    const owner = operations.acquire(); if (!owner) return;
    const controller = new AbortController(); operationController.current = controller; guard.current = 'working'; setBusy(true); setError('');
    const input: AccountUpdateInput = { role, active, expectedRevision: baseline.revision };
    try {
      const saved = await requestDecoded(`/users/${user.id}`, session, value => parseUpdatedAccount(value, baseline, input), { method: 'PUT', signal: controller.signal, body: JSON.stringify(input) });
      if (controller.signal.aborted) return;
      setBaseline(saved); setRole(saved.role); setActive(saved.active); setVerificationRequired(false); guard.current = 'idle'; updated();
    } catch (reason) {
      if (controller.signal.aborted) return;
      guard.current = 'verify'; setVerificationRequired(true); setError(`${problem(reason)} 本行结果待核对，输入已保留；请重新加载权限，不要重复提交。`);
    } finally { operations.release(owner); if (!controller.signal.aborted) setBusy(false); }
  }
  async function reload() {
    if (guard.current === 'working' || disabled || self || (dirty && !window.confirm('重新读取权限会放弃本行尚未保存的修改。继续吗？'))) return;
    const owner = operations.acquire(); if (!owner) return;
    const controller = new AbortController(); operationController.current = controller; guard.current = 'working'; setBusy(true); setError('');
    try {
      const current = await requestDecoded('/users', session, value => parseReloadedAccount(value, baseline), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBaseline(current); setRole(current.role); setActive(current.active); setVerificationRequired(false); guard.current = 'idle'; updated();
    } catch (reason) {
      if (controller.signal.aborted) return;
      guard.current = 'verify'; setVerificationRequired(true); setError(`${problem(reason)} 仍未核对当前权限，输入继续保留。`);
    } finally { operations.release(owner); if (!controller.signal.aborted) setBusy(false); }
  }
  return <tr><td>{user.username}{self && <small>（当前账号）</small>}<span className="account-revision">修订 {baseline.revision}</span>{user.revision > baseline.revision && <p className="notice">服务端已有新修订；本行输入仍基于修订 {baseline.revision}，请核对后重新加载权限。</p>}{verificationRequired && <p className="notice" aria-label={`${user.username}权限待核对`}>当前权限不能确认，下方保留的是本行输入，不是已保存状态。</p>}{error && <p className="notice error" role="alert">{error}</p>}</td>
    <td><select aria-label={`${user.username}的角色`} value={role} onChange={event => setRole(parseAccountRole(event.target.value))} disabled={busy || disabled || self}><option value="admin">管理员</option><option value="editor">编辑</option><option value="reviewer">编辑审阅</option></select></td>
    <td><label className="checkbox-label"><input aria-label={`${user.username}启用状态`} type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={busy || disabled || self} />启用</label></td>
    <td><button className="secondary" disabled={busy || disabled || self || !dirty || verificationRequired} onClick={save}>{busy ? '处理中…' : '更新权限'}</button>{!self && <button className="text-button" disabled={busy || disabled} onClick={reload}>重新加载权限</button>}</td></tr>;
}
export function Accounts(props: { session: SessionInfo; onActivity: ActivityHandler }) {
  // An explicitly different signed-in account never inherits private forms.
  return <AccountWorkspace key={props.session.user.id} {...props} />;
}
function AccountWorkspace({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [revision, setRevision] = useState(0);
  const lastAccounts = useRef<{ session: SessionInfo; items: Account[] } | null>(null);
  const decodeAccounts = useCallback((value: unknown) => parseRefreshedAccountList(value, lastAccounts.current?.session === session ? lastAccounts.current.items : [session.user]), [session]);
  const accounts = useDecodedReadResult('/users', session, decodeAccounts, revision, 0);
  const audit = useDecodedReadResult('/security-events', session, parseSecurityEventList, revision, 0);
  const [heldAccounts, setHeldAccounts] = useState<{ session: SessionInfo; items: Account[] } | null>(null);
  const users = accounts.data?.items || (heldAccounts?.session === session ? heldAccounts.items : []);
  const current = !!accounts.data && !accounts.loading && !accounts.error;
  useEffect(() => { if (accounts.data) { const value = { session, items: accounts.data.items }; lastAccounts.current = value; setHeldAccounts(value); } }, [accounts.data, session]);
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<UserRole>('editor');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [unconfirmedCreation, setUnconfirmedCreation] = useState<AccountCreationIntent | null>(null), [absenceNeedsConfirm, setAbsenceNeedsConfirm] = useState(false);
  const [rows, setRows] = useState<Record<string, Activity>>({});
  const guard = useRef<'idle' | 'working' | 'verify'>('idle'), operationController = useRef<AbortController | null>(null), operationOwner = useRef<symbol | null>(null);
  const pendingCreation = useRef<AccountCreationIntent | null>(null);
  const operations = useRef<Operations>({ acquire: () => { if (operationOwner.current !== null) return null; const owner = Symbol(); operationOwner.current = owner; return owner; }, release: owner => { if (operationOwner.current === owner) operationOwner.current = null; } }).current;
  useEffect(() => {
    if (operationController.current?.signal.aborted && guard.current === 'working') {
      guard.current = 'verify'; setBusy(false); setUnconfirmedCreation(pendingCreation.current); setError('会话已变化，上一创建结果不能确认，请按原用户名重新核对。');
    }
    return () => operationController.current?.abort();
  }, [session]);
  const rowActivity = useCallback((id: string, value: Activity) => setRows(current => {
    if ((current[id]?.dirty ?? false) === value.dirty && (current[id]?.busy ?? false) === value.busy) return current;
    return { ...current, [id]: value };
  }), []);
  const rowBusy = Object.values(rows).some(value => value.busy), blocked = busy || rowBusy;
  const creationDisabled = blocked || !!unconfirmedCreation || !current;
  useActivity(!!username || !!password || role !== 'editor' || !!unconfirmedCreation || Object.values(rows).some(value => value.dirty), blocked, onActivity);
  const updated = () => setRevision(value => value + 1);
  async function create(event: FormEvent) {
    event.preventDefault(); const previous = accounts.data; if (guard.current !== 'idle' || rowBusy || !current || !previous) return;
    if (absenceNeedsConfirm && !window.confirm('上次核对未找到账号，但不能排除原请求稍后完成。现在是一次新的手动创建；服务端仍会检查用户名唯一性。继续吗？')) return;
    const owner = operations.acquire(); if (!owner) return;
    const controller = new AbortController(); operationController.current = controller; guard.current = 'working'; setBusy(true); setError(''); setNotice('');
    const input: AccountCreationIntent = { username: username.trim().toLowerCase(), role };
    pendingCreation.current = input;
    try {
      await requestDecoded('/users', session, value => parseCreatedAccount(value, input, previous.items), { method: 'POST', signal: controller.signal, body: JSON.stringify({ ...input, password }) });
      if (controller.signal.aborted) return;
      setPassword(''); setUsername(''); setRole('editor'); setAbsenceNeedsConfirm(false); pendingCreation.current = null; guard.current = 'idle';
      setNotice('账号已创建。请通过安全渠道交付密码，不要放入截图或仓库。'); updated();
    } catch (reason) {
      if (controller.signal.aborted) return;
      guard.current = 'verify'; setUnconfirmedCreation(input); setError(`${problem(reason)} 创建结果待核对，输入已保留；请按本次用户名核对账号列表，不要重复创建。`);
    } finally { operations.release(owner); if (!controller.signal.aborted) setBusy(false); }
  }
  async function verifyCreation() {
    if (guard.current !== 'verify' || !unconfirmedCreation || blocked) return;
    if (!window.confirm('将按本次提交的用户名重新核对账号列表，不会再次创建。若已存在，会清空创建表单中的初始密码。继续吗？')) return;
    const owner = operations.acquire(); if (!owner) return;
    const controller = new AbortController(); operationController.current = controller; guard.current = 'working'; setBusy(true); setError('');
    try {
      const value = await requestDecoded('/users', session, decodeAccounts, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const found = value.items.find(user => user.username === unconfirmedCreation.username);
      setHeldAccounts({ session, items: value.items }); setUnconfirmedCreation(null); pendingCreation.current = null; guard.current = 'idle';
      if (found) {
        setPassword(''); setUsername(''); setRole('editor'); setAbsenceNeedsConfirm(false);
        setNotice(`核对结果：账号列表中已有 ${found.username}，修订 ${found.revision}，${roleLabel(found.role)}，${found.active ? '启用' : '停用'}。这不证明本次创建归属或初始密码可用，请勿重复创建。`);
      } else { setAbsenceNeedsConfirm(true); setNotice('本次读取未找到该用户名，不代表原请求一定没有或不会稍后提交。输入仍保留；继续创建须另行确认，服务端会检查用户名唯一性。'); }
      updated();
    } catch (reason) { if (!controller.signal.aborted) { guard.current = 'verify'; setError(`${problem(reason)} 创建结果仍不能确认，输入继续保留。`); } }
    finally { operations.release(owner); if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="accounts-panel"><div className="panel account-create"><h2>创建协作账号</h2><p className="muted">管理员管理账号，编辑修改资料，审阅者查阅资料并处理独立编辑审阅任务（不能改写备注或草稿）。以上权限不代表专业签审与发布批准。</p>
    <form className="account-form" onSubmit={create}><label>用户名<input aria-label="新账号用户名" value={username} maxLength={40} pattern="[a-z][a-z0-9._-]{2,39}" onChange={event => setUsername(event.target.value)} required disabled={creationDisabled} /></label>
      <label>初始密码<input aria-label="新账号初始密码" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={creationDisabled} /></label>
      <label>工作台角色<select aria-label="新账号角色" value={role} onChange={event => setRole(parseAccountRole(event.target.value))} disabled={creationDisabled}><option value="editor">编辑</option><option value="reviewer">编辑审阅</option><option value="admin">管理员</option></select></label>
      <button className="primary" disabled={creationDisabled}>{busy ? '处理中…' : '创建账号'}</button></form>{notice && <p role="status" aria-label="账号创建结果" className="notice">{notice}</p>}
    {error && <p role="alert" aria-label="账号创建错误" className="notice error">{error}</p>}{unconfirmedCreation && <div className="notice" aria-label="账号创建待核对"><p>本次用户名：{unconfirmedCreation.username}。尚不能确认提交结果；刷新其他列表不会解锁此表单。</p><button className="secondary" disabled={blocked} onClick={verifyCreation}>核对账号创建结果</button></div>}</div>
    <div className="panel account-list"><div className="workflow-toolbar"><h2>账号与权限</h2><button className="secondary" disabled={accounts.loading || blocked} onClick={accounts.retry}>刷新账号列表</button></div>
      {accounts.loading && <p role="status">正在读取账号…</p>}{accounts.error && <p className="notice error" role="alert" aria-label="账号列表错误">{accounts.error} 当前权限不能确认。<button disabled={blocked} onClick={accounts.retry}>重新读取账号</button></p>}
      {!current && users.length > 0 && <p className="notice" aria-label="账号权限读取状态">仅保留上次账号及本行输入，不代表当前权限；完整读取成功前不能修改。</p>}
      <p className="muted" aria-label="账号结果数量">{current ? `已读取 ${users.length} 个账号` : '账号数量暂不可用'}</p>
      <div className="table-scroll"><table aria-label="账号列表"><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map(user => <UserRow key={`${session.user.id}:${user.id}`} user={user} session={session} updated={updated} activityChanged={rowActivity} disabled={!current || blocked} operations={operations} />)}</tbody></table></div></div>
    <div className="panel account-list"><div className="workflow-toolbar"><h2>最近安全记录</h2><button className="secondary" disabled={audit.loading || blocked} onClick={audit.retry}>重新读取安全记录</button></div><p className="small muted">仅记录操作类型、账号和时间，不记录密码、会话令牌或备注正文。</p>
      {audit.loading && <p role="status">正在读取安全记录…</p>}{audit.error && <p className="notice error" role="alert" aria-label="安全记录读取错误">{audit.error} 当前记录无法确认，上次记录已隐藏。</p>}
      {!audit.loading && !audit.error && audit.data && <div className="table-scroll"><table aria-label="安全记录列表"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>目标</th></tr></thead><tbody>{audit.data.items.map(event => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString('zh-CN')}</td><td>{event.actor}</td><td>{actionLabel(event.action)}</td><td>{event.target || '—'}</td></tr>)}</tbody></table>{!audit.data.items.length && <p className="muted">暂无安全记录。</p>}</div>}</div></section>;
}
