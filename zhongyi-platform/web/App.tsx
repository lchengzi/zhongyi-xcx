import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthConfig, IngredientDetail } from '../shared/contracts';
import { ApiError, requestDecoded, requiresWriteVerification, type Credential } from './api';
import { parseAuthConfig, parseLogoutReceipt, parseRetainedSession, parseSession } from '../shared/auth-response';
import { parsePlatformSummary } from '../shared/workbench-response';
import { useWorkbenchOverview } from './useWorkbenchOverview';
import { useEditorialNote } from './useEditorialNote';
import { AccountSignIn } from './AccountSignIn';
import { Accounts, roleLabel } from './Accounts';
import { Workflow } from './Workflow';
import { PrivatePhotos } from './PrivatePhotos';

function Mark() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M25 5C13 4 6 10 7 19c8 3 17-2 18-14Z" fill="currentColor" opacity=".8" /><path d="M6 27 21 11M11 22l-1-8M16 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无编辑记录';
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const label = (state: string) => ({ pending: '待专业审校', reviewed: '已专业审校', rejected: '已退回' })[state] || '状态待确认';

function SignIn({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const gate = useRef(false), lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); const controller = lifetime.current;
    if (!controller || controller.signal.aborted || gate.current) return;
    gate.current = true; setError(''); setBusy(true);
    try { await requestDecoded('/summary', value.trim(), parsePlatformSummary, { signal: controller.signal }); if (!controller.signal.aborted) onConnect(value.trim()); }
    catch (reason) { if (!controller.signal.aborted) setError(message(reason)); }
    finally { if (!controller.signal.aborted) { gate.current = false; setBusy(false); } }
  }
  return <main className="signin">
    <section className="signin-story"><div className="brand"><Mark /><span>食养 · 内容工作台</span></div>
      <div><p className="eyebrow">CONTENT WORKSPACE</p><h1>把每一条资料，<br />整理得有据可循。</h1><p className="story-copy">在同一个工作台查阅食材身份、核对资料来源，<br />记录下一步需要补充的内容。</p></div>
      <p className="story-footer">非医疗食养教育 · 内容编辑与资料整理</p>
    </section>
    <section className="signin-form"><div className="signin-inner"><span className="pill">本地工作台</span><h2>连接你的内容库</h2>
      <p className="muted">输入后端启动时显示的编辑密钥。密钥只保存在当前页面内存中。</p>
      <form onSubmit={submit}><label htmlFor="editor-key">本地编辑密钥</label><input id="editor-key" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="粘贴启动终端中的密钥" required disabled={busy} />
        {error && <p role="alert" className="notice error">{error}</p>}<button className="primary connect" disabled={busy || !value.trim()}>{busy ? '正在连接…' : '进入工作台 →'}</button>
      </form><p className="small muted">当前入口用于本机工程演示。编辑操作不会改变专业审校状态。</p>
    </div></section>
  </main>;
}

function Detail({ value, draft, setDraft, saving, save, clear, reload, feedback, readOnly, verify }: {
  value: IngredientDetail; draft: string; setDraft: (value: string) => void; saving: boolean;
  save: () => void; clear: () => void; reload: () => void; feedback: string;
  readOnly: boolean; verify: boolean;
}) {
  const { ingredient: item, note } = value;
  return <aside className="detail" aria-label="食材详情">
    <div className="detail-top"><div className="ingredient-initial" aria-hidden="true">{item.name.slice(0, 1)}</div><span className="status">{label(item.professionalReviewState)}</span></div>
    <h2>{item.name}</h2><p className="latin">{item.latinName || '植物身份待核对'}</p>
    <dl className="facts"><div><dt>目录批次</dt><dd>{item.batch}</dd></div><div><dt>资料所列部位</dt><dd>{item.ediblePart || '待核对'}</dd></div><div><dt>部位核对状态</dt><dd>{item.identityState === 'source_checked' ? '来源已核对' : item.identityState === 'reviewed' ? '已审校' : '待核对'}</dd></div></dl>
    <p className="notice boundary">{item.restriction || '用途与安全边界待核对。'}</p>
    <section className="sources"><h3>资料来源 <span>{item.sources.length}</span></h3>
      {item.sources.map((source) => <article className="source" key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a><p>{source.publisher}</p><span className="small muted">核对：{source.checkedAt || '未记录'} · {source.status === 'published' ? '来源已发布' : '来源状态待确认'}</span></article>)}
      {!item.sources.length && <p className="muted">暂未登记来源。</p>}
    </section>
    <section className="note-editor"><h3>编辑备注 <span>修订 {note.revision}</span></h3>
      <p className="small muted">记录资料缺口、来源核对与编辑事项。请勿输入个人健康资料。</p>
      {readOnly && <p className="notice">当前为只读审阅账号，不能修改备注。</p>}
      {verify && <p className="notice error" role="alert">提交结果尚未核对，以下保留本页输入和旧修订。请重新加载核对后再保存；读取失败或刷新列表不会解除暂停。</p>}
      <label className="sr-only" htmlFor="editor-note">编辑备注</label><textarea id="editor-note" maxLength={1200} value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={readOnly} disabled={saving} placeholder="例如：需要核对食用部位与原始公告是否一致…" />
      <div className="note-meta"><span>{draft.length} / 1200</span><span>{date(note.updatedAt)}</span></div>
      <div className="note-actions"><button className="primary" onClick={save} disabled={readOnly || saving || verify || draft.trim() === note.text}>{saving ? '保存中…' : '保存备注'}</button><button className="secondary" onClick={clear} disabled={readOnly || saving || verify || (!draft && !note.text)}>清空备注</button><button className="text-button" onClick={reload} disabled={saving}>重新加载</button></div>
      {feedback && <p className="notice" role="status" aria-label="备注保存结果">{feedback}</p>}
      <p className="small muted note-boundary">备注用于编辑协作；专业审校与内容发布另行处理。</p>
    </section>
  </aside>;
}

function Workbench({ token, disconnect, verifyDisconnect }: { token: Exclude<Credential, null>; disconnect: () => Promise<void>; verifyDisconnect: () => Promise<boolean> }) {
  const session = typeof token === 'string' ? null : token;
  const readOnly = session?.user.role === 'reviewer';
  const [section, setSection] = useState<'catalog' | 'events' | 'accounts' | 'workflow' | 'photos'>('catalog');
  const [workflowActivity, setWorkflowActivity] = useState({ dirty: false, busy: false });
  const [accountActivity, setAccountActivity] = useState({ dirty: false, busy: false });
  const [photoActivity, setPhotoActivity] = useState({ dirty: false, busy: false });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [disconnecting, setDisconnecting] = useState(false);
  const logoutPending = useRef(false);
  const logoutPhaseRef = useRef<'idle' | 'unknown' | 'checked'>('idle');
  const [logoutPhase, setLogoutPhase] = useState<'idle' | 'unknown' | 'checked'>('idle');
  const changeLogoutPhase = (value: 'idle' | 'unknown' | 'checked') => { logoutPhaseRef.current = value; setLogoutPhase(value); };
  const [actionError, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const noteSaved = useCallback(() => setRetry(value => value + 1), []);
  const note = useEditorialNote(token, noteSaved);
  const { detail, draft, selected, feedback } = note;
  const detailLoading = note.loading, detailError = note.error, saving = note.busy || disconnecting;
  const overview = useWorkbenchOverview(token, search, page, retry);
  const { result, summary, events, loading } = overview;
  const error = overview.error;
  const displayError = error || actionError;

  useEffect(() => {
    if (!note.dirty && !workflowActivity.dirty && !accountActivity.dirty && !saving && !workflowActivity.busy && !accountActivity.busy && !photoActivity.dirty && !photoActivity.busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [note.dirty, workflowActivity.dirty, workflowActivity.busy, accountActivity.dirty, accountActivity.busy, photoActivity.dirty, photoActivity.busy, saving]);

  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  function choose(id: string) {
    if (!saving && !logoutPending.current) note.choose(id);
  }
  async function logout() {
    if (saving || note.busyNow() || logoutPending.current || logoutPhaseRef.current === 'unknown' || workflowActivity.busy || accountActivity.busy || photoActivity.busy) return;
    logoutPending.current = true;
    if ((logoutPhaseRef.current === 'checked' || note.dirty || workflowActivity.dirty || accountActivity.dirty || photoActivity.dirty) && !window.confirm('退出会放弃本页未保存输入，但不会撤销已提交操作。若先前退出结果不确定，这是另一次退出请求。继续吗？')) { logoutPending.current = false; return; }
    setDisconnecting(true);
    try { await disconnect(); }
    catch (reason) {
      setError(message(reason));
      if (requiresWriteVerification(reason) || (reason instanceof ApiError && reason.status >= 500)) changeLogoutPhase('unknown');
    }
    finally { logoutPending.current = false; setDisconnecting(false); }
  }
  async function checkLogout() {
    if (logoutPending.current || note.busyNow() || workflowActivity.busy || accountActivity.busy || photoActivity.busy || logoutPhaseRef.current === 'idle') return;
    logoutPending.current = true;
    if (!window.confirm('核对退出状态；如果会话已经结束，将离开工作台并放弃本页未保存输入。继续吗？')) { logoutPending.current = false; return; }
    setDisconnecting(true);
    try {
      if (!await verifyDisconnect()) { changeLogoutPhase('checked'); setError('当前会话仍有效，尚未退出。若要再次退出，请单独确认；本页输入仍保留。'); }
    } catch (reason) { changeLogoutPhase('unknown'); setError(message(reason)); }
    finally { logoutPending.current = false; setDisconnecting(false); }
  }
  function navigate(value: typeof section) {
    if (value === section || saving || note.busyNow() || logoutPending.current || workflowActivity.busy || accountActivity.busy || photoActivity.busy) return;
    if (accountActivity.dirty && !window.confirm('账号权限输入尚未保存，切换页面会放弃修改。继续吗？')) return;
    if (photoActivity.dirty && !window.confirm('图片核对输入或提交结果尚待确认，切换页面会放弃当前输入。继续吗？')) return;
    if (workflowActivity.dirty && !window.confirm('内容协作输入尚未保存，切换页面会放弃修改。继续吗？')) return;
    setSection(value);
  }
  function refresh() {
    if (loading || saving || note.busyNow() || logoutPending.current || workflowActivity.busy || accountActivity.busy || photoActivity.busy) return;
    if (accountActivity.dirty && !window.confirm('账号权限输入尚未保存，刷新内容会放弃修改。继续吗？')) return;
    setError(''); setRetry((value) => value + 1);
  }
  const sectionLabel = { catalog: '食材资料', events: '编辑记录', accounts: '账号权限', workflow: '内容协作', photos: '图片审阅' }[section];
  const heading = { catalog: '让资料清楚，让来源可查。', events: '每一次编辑，都有记录。', accounts: '明确权限，安心协作。', workflow: '让修订与审阅，有据可循。', photos: '从原图核对每一处细节。' }[section];
  const description = { catalog: '检索食材资料，核对原始来源，记录下一步需要完善的内容。', events: '查看最近 20 次备注修订；备注正文保存在对应食材详情中。', accounts: '管理协作账号与安全记录；后台角色不等于专业资质。', workflow: '登记来源、提交固定版本草稿，由独立账号完成编辑质量审阅。', photos: '查看真实照片、来源许可及部位和加工疑点，候选与公开图片分开管理。' }[section];

  const stats: [string, ReactNode, string][] = [['目录条目', summary?.ingredientCount ?? '—', '已导入的历史目录快照'], ['编辑备注', summary?.noteCount ?? '—', '当前有内容的备注'], ['操作记录', summary?.eventCount ?? '—', '每次修订可追溯'], ['发布规则', '独立批准', '当前公开状态须逐项核对']];
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><Mark /><span>食养<span className="brand-sub">内容工作台</span></span></div><p className="nav-caption">工作空间</p>
      <nav aria-label="工作台导航"><button className={section === 'catalog' ? 'nav active' : 'nav'} onClick={() => navigate('catalog')}><span aria-hidden="true">▤</span> 食材资料 <span className="nav-count">{summary?.ingredientCount ?? '—'}</span></button><button className={section === 'events' ? 'nav active' : 'nav'} onClick={() => navigate('events')}><span aria-hidden="true">◷</span> 编辑记录</button>{session && <button className={section === 'workflow' ? 'nav active' : 'nav'} onClick={() => navigate('workflow')}><span aria-hidden="true">⇄</span> 内容协作</button>}{session?.user.role === 'admin' && <button className={section === 'accounts' ? 'nav active' : 'nav'} onClick={() => navigate('accounts')}><span aria-hidden="true">♧</span> 账号权限</button>}</nav>
      {session && <button className={section === 'photos' ? 'nav active' : 'nav'} onClick={() => navigate('photos')}>图片审阅</button>}
      <div className="sidebar-footer"><span className="connection"><i /> 本地内容库已连接</span><p>{session ? `${session.user.username} · ${roleLabel(session.user.role)}` : '本地密钥 · 工程演示'}<br />专业审校与发布权限独立</p><button className="text-button" onClick={logout} disabled={saving || logoutPhase === 'unknown' || workflowActivity.busy || accountActivity.busy || photoActivity.busy}>退出工作台 ↗</button></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>工作空间 <span className="breadcrumb">/ {sectionLabel}</span></span><div className="topbar-actions"><span className="local-tag">{session ? `${session.user.username} · ${roleLabel(session.user.role)}` : '本地演示环境'}</span><button className="text-button mobile-logout" onClick={logout} disabled={saving || logoutPhase === 'unknown' || workflowActivity.busy || accountActivity.busy || photoActivity.busy}>退出</button></div></header>
      <main className="content"><div className="page-heading"><div><p className="eyebrow">EDITORIAL WORKSPACE</p><h1>{heading}</h1><p className="muted">{description}</p></div><button className="secondary" onClick={refresh} disabled={loading || saving || workflowActivity.busy || accountActivity.busy || photoActivity.busy}>刷新内容 ↻</button></div>
        <div className="stats">{stats.map(([title, value, hint]) => <div className="stat" key={title}><p>{title}</p><strong>{value}</strong><span>{hint}</span></div>)}</div>
        {summary && <div className="snapshot"><span className="snapshot-dot" />来源快照核对于 {summary.sourceAsOf}<span className="snapshot-version">{summary.contentVersion}</span><span>不代表今日目录更新</span></div>}
        {displayError && <p className="notice error" role="alert">{displayError} {error && <button className="secondary" onClick={refresh} disabled={loading || saving || workflowActivity.busy || accountActivity.busy || photoActivity.busy}>重试</button>}</p>}
        {logoutPhase !== 'idle' && <p className="notice">退出结果需单独核对；刷新内容不会重发退出请求。核对后如已退出，将离开本页。<button className="secondary" onClick={checkLogout} disabled={saving || workflowActivity.busy || accountActivity.busy || photoActivity.busy}>核对退出状态</button></p>}
        {section === 'photos' && session ? <PrivatePhotos session={session} blocked={disconnecting || logoutPhase === 'unknown'} onActivity={setPhotoActivity} /> : section === 'workflow' && session ? <Workflow session={session} blocked={disconnecting || logoutPhase === 'unknown'} onActivity={setWorkflowActivity} /> : section === 'accounts' && session ? <Accounts session={session} onActivity={setAccountActivity} key={retry} /> : section === 'events' ? <section className="panel events-panel"><h2>最近编辑记录</h2>
          {loading ? <div className="empty" role="status">正在读取编辑记录…</div> : error ? <div className="empty"><h3>编辑记录暂不可用</h3><p>请重试读取；当前无法判断是否有编辑记录。</p></div> : !events.length ? <div className="empty"><h3>还没有编辑记录</h3><p>保存第一条备注后，会在这里留下修订时间和条目记录。</p></div> : <table aria-label="编辑修订记录"><thead><tr><th>时间</th><th>食材编号</th><th>操作</th><th>修订</th><th>操作者</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{date(event.createdAt)}</td><td><button className="text-button" onClick={() => { choose(event.ingredientId); navigate('catalog'); }}>{event.ingredientId}</button></td><td>{event.action === 'note_saved' ? '保存备注' : '清空备注'}</td><td>{event.revision}</td><td>{event.actor}</td></tr>)}</tbody></table>}
        </section> : <div className="catalog-layout">
          <section className="panel catalog"><div className="panel-heading"><h2>食材资料库 <span>CATALOG</span></h2><label className="search"><span aria-hidden="true">⌕</span><input aria-label="搜索食材" maxLength={80} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、拼音或别名" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}>×</button>}</label></div>
            <div className="table-scroll"><table aria-label="食材目录"><thead><tr><th>食材名称</th><th>部位资料</th><th>审校状态</th><th aria-label="打开详情" /></tr></thead><tbody>{!loading && !error && result?.items.map((item) => <tr key={item.id} className={selected === item.id ? 'selected' : ''}><td><button className="ingredient-button" onClick={() => choose(item.id)} disabled={saving}><span className="table-initial" aria-hidden="true">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.pinyin}</small></span></button></td><td className="part-cell">{item.ediblePart || '待核对'}</td><td><span className="status">{label(item.professionalReviewState)}</span></td><td><button className="open-button" aria-label={`查看${item.name}`} onClick={() => choose(item.id)} disabled={saving}>↗</button></td></tr>)}</tbody></table></div>
            {loading ? <div className="empty" role="status">正在读取内容库…</div> : error ? <div className="empty"><h3>目录读取失败</h3><p>请重试读取；当前无法判断是否有匹配结果。</p></div> : result && !result.items.length && <div className="empty"><h3>没有找到相关食材</h3><p>试试其他名称、拼音或别名。</p></div>}
            <div className="pagination"><span>{loading ? '正在读取结果…' : error ? '结果数量暂不可用' : `共 ${result?.total ?? 0} 条${search ? '匹配结果' : '资料'}`}</span><div><button className="secondary" disabled={loading || !!error || page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>{result && !error ? `${page} / ${Math.max(1, Math.ceil(result.total / 12))}` : '—'}</span><button className="secondary" disabled={loading || !!error || page * 12 >= (result?.total || 0)} onClick={() => setPage(page + 1)}>下一页</button></div></div>
          </section>
          {detailLoading ? <aside className="detail empty" role="status">正在读取食材详情…</aside> : detailError ? <aside className="detail"><p role="alert">{detailError}</p><div className="note-actions"><button className="primary" onClick={note.retry}>重试读取详情</button><button className="secondary" onClick={() => choose('')}>返回目录</button></div></aside> : detail ? <Detail value={detail} draft={draft} setDraft={note.setDraft} saving={saving} save={() => note.save(draft)} clear={() => note.save('')} reload={note.reload} feedback={feedback} readOnly={readOnly} verify={note.verify} /> : <aside className="detail detail-empty"><Mark /><h2>从一条资料开始</h2><p>选择左侧食材，查看身份、来源和编辑备注。</p><div className="detail-empty-note">来源已核对与专业审校完成是不同状态，请按原始资料记录。</div></aside>}
        </div>}
      </main><footer className="workspace-footer">食养内容工作台 <span>资料整理与工程演示 · 编辑记录保存在本地数据库</span></footer>
    </div>
  </div>;
}

export function App() {
  const [token, setToken] = useState<Credential>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    (async () => {
      const value = await requestDecoded('/auth/config', null, parseAuthConfig, { signal: controller.signal });
      if (value.mode === 'accounts') {
        try { const session = await requestDecoded('/auth/me', null, parseSession, { signal: controller.signal }); if (!controller.signal.aborted) setToken(session); }
        catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; if (!controller.signal.aborted) setToken(null); }
      }
      if (!controller.signal.aborted) setConfig(value);
    })().catch((reason) => { if (!controller.signal.aborted) setError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  async function disconnect() {
    if (token && typeof token !== 'string') {
      try { await requestDecoded('/auth/logout', token, parseLogoutReceipt, { method: 'POST' }); }
      catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; }
    }
    setToken(null);
  }
  async function verifyDisconnect(): Promise<boolean> {
    if (!token || typeof token === 'string') return false;
    try { await requestDecoded('/auth/me', token, value => parseRetainedSession(value, token)); return false; }
    catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; setToken(null); return true; }
  }
  if (loading) return <main className="empty" role="status">正在检查工作台会话…</main>;
  if (error || !config) return <main className="empty"><p role="alert">{error || '无法读取登录配置。'}</p><button className="secondary" onClick={() => setRetry((value) => value + 1)}>重试</button></main>;
  return token ? <Workbench key={typeof token === 'string' ? 'local-key' : token.user.id} token={token} disconnect={disconnect} verifyDisconnect={verifyDisconnect} /> : config.mode === 'local-key' ? <SignIn onConnect={setToken} /> : <AccountSignIn onConnect={setToken} />;
}
