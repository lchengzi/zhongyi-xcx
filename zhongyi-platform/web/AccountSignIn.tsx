import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionInfo } from '../shared/contracts';
import { ApiError, requestDecoded, requiresWriteVerification } from './api';
import { parseLoginSession, parseSession } from '../shared/auth-response';

export function AccountSignIn({ onConnect }: { onConnect: (session: SessionInfo) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'unknown' | 'checked'>('idle');
  const phaseRef = useRef<'idle' | 'unknown' | 'checked'>('idle');
  const changePhase = (value: 'idle' | 'unknown' | 'checked') => { phaseRef.current = value; setPhase(value); };
  const gate = useRef(false), intent = useRef('');
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || gate.current || phaseRef.current === 'unknown') return;
    gate.current = true;
    if (phaseRef.current === 'checked' && !window.confirm('这是新的登录请求。先前请求可能仍在处理，当前检查不能撤销它。确认使用当前输入再次登录吗？')) { gate.current = false; return; }
    const previousPhase = phaseRef.current; intent.current = username.trim().toLowerCase(); setBusy(true); setError('');
    try {
      const info = await requestDecoded('/auth/login', null, value => parseLoginSession(value, intent.current),
        { method: 'POST', body: JSON.stringify({ username: intent.current, password }), signal: controller.signal });
      if (!controller.signal.aborted) { setPassword(''); onConnect(info); }
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '登录失败，请重试。'); changePhase(requiresWriteVerification(reason) || (reason instanceof ApiError && reason.status >= 500) || previousPhase !== 'idle' ? 'unknown' : 'idle'); }
    } finally { if (!controller.signal.aborted) { gate.current = false; setBusy(false); } }
  }
  async function verify() {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || gate.current || phaseRef.current === 'idle') return;
    gate.current = true; setBusy(true);
    try {
      const info = await requestDecoded('/auth/me', null, parseSession, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (info.user.username !== intent.current) {
        changePhase('checked'); setError('当前有效会话与本次登录账号不同，未进入工作台。需要再次登录时，请核对输入并单独确认。');
      } else { setPassword(''); onConnect(info); }
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof ApiError && reason.status === 401) { changePhase('checked'); setError('当前未查到有效会话，不代表先前请求永远不会完成。再次登录需单独确认。'); }
        else { changePhase('unknown'); setError(reason instanceof Error ? reason.message : '无法核对登录状态。'); }
      }
    } finally { if (!controller.signal.aborted) { gate.current = false; setBusy(false); } }
  }
  return <main className="signin"><section className="signin-story"><div className="brand">食养 · 内容工作台</div>
    <div><p className="eyebrow">CONTENT WORKSPACE</p><h1>让资料有来源，<br />让协作有记录。</h1><p className="story-copy">按角色管理资料与编辑事项。<br />专业审校、发布批准仍是独立流程。</p></div><p className="story-footer">非医疗食养教育 · 内容编辑与资料整理</p></section>
    <section className="signin-form"><div className="signin-inner"><span className="pill">账号工作台</span><h2>登录内容工作台</h2><p className="muted">使用管理员为你创建的账号。会话最长 8 小时，密码与会话凭据不写入浏览器本地存储。</p>
      <form onSubmit={submit}><label htmlFor="username">用户名</label><input id="username" autoComplete="username" maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} required disabled={busy || phase === 'unknown'} />
        <label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy || phase === 'unknown'} />
        {error && <p role="alert" className="notice error">{error}</p>}<button className="primary connect" disabled={busy || phase === 'unknown' || !username.trim() || !password}>{busy ? '正在处理…' : '登录工作台 →'}</button>
        {phase !== 'idle' && <><p className="small muted">先核对本次提交账号的会话；核对只读取状态，不会再次提交密码。</p><button type="button" className="secondary" disabled={busy} onClick={verify}>核对登录状态</button></>}
      </form><p className="small muted">没有公开注册和默认密码。首次使用需在服务端初始化管理员；审阅角色不代表专业资质。</p></div></section></main>;
}
