import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ManagedSource, SessionInfo, SourceInput, SourcePage } from '../shared/contracts';
import { requestDecoded } from './api';
import { parseManagedSource, parseSourcePage } from '../shared/workflow-response';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

export function SourcePicker({ session, picked, disabled }: { session: SessionInfo; picked: (source: ManagedSource) => void; disabled: boolean }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<SourcePage | null>(null); const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    const timer = setTimeout(() => {
      requestDecoded(`/editorial/sources?q=${encodeURIComponent(query.trim())}&page=${page}&pageSize=5`, session, value => parseSourcePage(value, { page, pageSize: 5 }), { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setData(value); }).catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, session, retry]);
  return <section className="source-picker"><h3>添加已登记来源</h3><input aria-label="搜索可引用来源" placeholder="按标题、机构或网址搜索" maxLength={80} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
    {error && <p role="alert" className="notice error">{error}<button disabled={loading} onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
    {loading ? <p role="status" aria-label="来源加载状态">正在读取来源…</p> : error ? <p className="muted">来源列表暂不可用，请重试；不能引用上次查询的结果。</p> : data?.items.map((source) => <article className="source-choice" key={source.id}><div><strong>{source.title}</strong><small>{source.publisher} · 版本 {source.revision} · 待核验</small></div><button className="secondary" disabled={disabled} onClick={() => picked(source)}>引用此来源</button></article>)}
    {!loading && !error && data && !data.items.length && <p className="muted">没有匹配来源。可到“来源登记”创建记录；登记不代表已核验。</p>}
    <div className="pagination"><span>{loading ? '正在读取来源数量…' : error ? '来源数量暂不可用' : `共 ${data?.total || 0} 个来源`}</span><div><button className="secondary" disabled={loading || !!error || page === 1} onClick={() => setPage(page - 1)}>上一批来源</button><button className="secondary" disabled={loading || !!error || page * 5 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>下一批来源</button></div></div>
  </section>;
}
const empty: SourceInput = { title: '', publisher: '', url: '' };
export function Sources({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [data, setData] = useState<SourcePage | null>(null);
  const [selected, setSelected] = useState<ManagedSource | null>(null); const [input, setInput] = useState<SourceInput>(empty);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const mutation = useRef(false);
  const dirty = JSON.stringify(input) !== JSON.stringify(selected ? { title: selected.title, publisher: selected.publisher, url: selected.url } : empty);
  const readOnly = session.user.role === 'reviewer'; useActivity(dirty, busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    const timer = setTimeout(() => {
      requestDecoded(`/editorial/sources?q=${encodeURIComponent(query.trim())}&page=${page}`, session, value => parseSourcePage(value, { page, pageSize: 12 }), { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setData(value); }).catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, retry, session]);
  function choose(source: ManagedSource | null) {
    if (mutation.current || busy || (dirty && !window.confirm('来源输入尚未保存，切换会放弃修改。继续吗？'))) return;
    setSelected(source); setInput(source ? { title: source.title, publisher: source.publisher, url: source.url } : empty); setFeedback('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (readOnly || mutation.current || busy || !dirty) return;
    mutation.current = true; setBusy(true); setFeedback('');
    try {
      const value = await requestDecoded(selected ? `/editorial/sources/${selected.id}` : '/editorial/sources', session, result => {
        const source = parseManagedSource(result, selected ? { id: selected.id, revision: selected.revision + 1 } : undefined);
        if ((!selected && source.revision !== 1) || source.title !== input.title.trim() || source.publisher !== input.publisher.trim() ||
          source.url !== new URL(input.url.trim()).href) throw new Error('Unexpected saved source'); return source;
      }, {
        method: selected ? 'PUT' : 'POST', body: JSON.stringify(selected ? { source: input, expectedRevision: selected.revision } : input)
      });
      setSelected(value); setInput({ title: value.title, publisher: value.publisher, url: value.url }); setFeedback('来源已保存为私有待核验记录，既有引用版本不变。'); setRetry((value) => value + 1);
    } catch (reason) { setFeedback(problem(reason)); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function reload() {
    if (!selected || mutation.current || busy || (dirty && !window.confirm('重新加载会放弃当前来源输入。继续吗？'))) return;
    mutation.current = true; setBusy(true); setFeedback('');
    try { const value = await requestDecoded(`/editorial/sources/${selected.id}`, session, result => parseManagedSource(result, { id: selected.id })); setSelected(value); setInput({ title: value.title, publisher: value.publisher, url: value.url }); setFeedback('已读取最新来源版本。'); }
    catch (reason) { setFeedback(problem(reason)); }
    finally { mutation.current = false; setBusy(false); }
  }
  return <div className="workflow-split"><section className="panel workflow-panel"><div className="workflow-toolbar"><h2>私有来源库</h2><button className="secondary" onClick={() => choose(null)} disabled={readOnly || busy}>新增来源</button></div><input aria-label="搜索来源库" placeholder="搜索标题、机构或网址" value={query} maxLength={80} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
    {error && <p role="alert" className="notice error">{error} <button disabled={loading} onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
    {loading ? <p role="status">正在读取来源库…</p> : error ? <p className="muted">来源列表暂不可用，请重试；已打开的来源输入仍保留。</p> : data?.items.map((source) => <button className={`workflow-item ${selected?.id === source.id ? 'selected' : ''}`} key={source.id} onClick={() => choose(source)} disabled={busy}><strong>{source.title}</strong><span>{source.publisher} · 版本 {source.revision} · 待核验</span></button>)}
    {!loading && !error && data && !data.items.length && <p className="muted">还没有匹配来源。来源录入不会自动核验网页内容。</p>}
    <div className="pagination"><span>{loading ? '正在读取来源数量…' : error ? '来源数量暂不可用' : `共 ${data?.total || 0} 条`}</span><div><button className="secondary" disabled={loading || !!error || page === 1} onClick={() => setPage(page - 1)}>上一页来源</button><button className="secondary" disabled={loading || !!error || page * 12 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>下一页来源</button></div></div></section>
    <section className="panel workflow-panel"><h2>{selected ? `来源修订 · 版本 ${selected.revision}` : '登记资料来源'}</h2><p className="notice">来源记录仅供内部编辑。保存不代表网址内容已核验、获得授权或完成专业审校。</p>
      <form className="workflow-form" onSubmit={save}><label>来源标题<input aria-label="来源标题" value={input.title} maxLength={200} onChange={(event) => setInput({ ...input, title: event.target.value })} readOnly={readOnly} disabled={busy} required /></label>
        <label>发布机构<input aria-label="来源发布机构" value={input.publisher} maxLength={120} onChange={(event) => setInput({ ...input, publisher: event.target.value })} readOnly={readOnly} disabled={busy} required /></label>
        <label>原始网址<input aria-label="来源原始网址" type="url" value={input.url} maxLength={1000} onChange={(event) => setInput({ ...input, url: event.target.value })} readOnly={readOnly} disabled={busy} required /></label>
        <div className="workflow-actions"><button className="primary" disabled={readOnly || busy || !dirty}>{busy ? '保存中…' : '保存来源'}</button>{selected && <button type="button" className="secondary" onClick={reload} disabled={busy}>重新加载来源</button>}</div></form>
      {feedback && <p role="status" aria-label="来源保存结果" className="notice">{feedback}</p>}{selected && <p className="small muted">录入者：{selected.recordedBy} · {timestamp(selected.recordedAt)}<br />每次修改新增版本，不改写已被草稿引用的旧版本。<a href={selected.url} target="_blank" rel="noopener noreferrer">打开登记出处 ↗</a></p>}
    </section></div>;
}
