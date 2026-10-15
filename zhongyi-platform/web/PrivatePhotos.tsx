import { useEffect, useId, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhotoList, type PrivatePhoto } from '../shared/private-photos';
import { useDecodedReadResult } from './useReadResult';
import { readPrivatePhoto } from './private-photo-api';
import { PhotoNotes } from './PhotoNotes';
import { PhotoSubmissions } from './PhotoSubmissions';
import { PhotoRights } from './PhotoRights';
import { PhotoProfessional } from './PhotoProfessional';
import { PhotoPublication } from './PhotoPublication';
import { confirmLeave, useActivity, type ActivityHandler } from './workflow-shared';

function Original({ photo, session }: { photo: PrivatePhoto; session: SessionInfo }) {
  const [view, setView] = useState<{ owner: SessionInfo; photo: PrivatePhoto; url: string; busy: boolean; error: string } | null>(null);
  const lifetime = useRef<{ controller: AbortController; url: string } | null>(null);
  function retire() {
    const previous = lifetime.current; lifetime.current = null;
    previous?.controller.abort();
    if (previous?.url) URL.revokeObjectURL(previous.url);
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) { retire(); setView(null); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); retire(); };
  }, [photo, session]);
  async function open() {
    if (document.hidden || lifetime.current) return;
    const owner = { controller: new AbortController(), url: '' }; lifetime.current = owner;
    setView({ owner: session, photo, url: '', busy: true, error: '' });
    try {
      const blob = await readPrivatePhoto(photo, owner.controller.signal);
      if (owner.controller.signal.aborted || lifetime.current !== owner || document.hidden) return;
      owner.url = URL.createObjectURL(blob);
      setView({ owner: session, photo, url: owner.url, busy: false, error: '' });
    } catch (error) {
      if (!owner.controller.signal.aborted && lifetime.current === owner) setView({ owner: session, photo, url: '', busy: false, error: error instanceof Error ? error.message : '原图读取失败。' });
    } finally {
      if (lifetime.current === owner && !owner.url) lifetime.current = null;
    }
  }
  const current = view?.owner === session && view.photo === photo ? view : null;
  return <div className="private-photo-original">
    {current?.url ? <><img src={current.url} alt={`${photo.name}，待核对原图`} /><button className="secondary" onClick={() => { retire(); setView(null); }}>收起原图</button></> : <button className="primary" disabled={current?.busy} onClick={() => { void open(); }}>{current?.busy ? '正在校验原图…' : '查看原图'}</button>}
    {current?.busy && <button className="secondary" onClick={() => { retire(); setView(null); }}>取消读取</button>}
    {current?.error && <p role="alert" className="notice error">{current.error}</p>}
  </div>;
}

export function PrivatePhotos({ session, blocked = false, onActivity }: { session: SessionInfo; blocked?: boolean; onActivity: ActivityHandler }) {
  const read = useDecodedReadResult('/private-photos', session, parsePrivatePhotoList, 0, 0);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'notes' | 'submission' | 'rights' | 'professional' | 'publication'>('notes');
  const searchId = useId();
  const tabsId = useId();
  const [activity, setActivity] = useState({ dirty: false, busy: false });
  useActivity(activity.dirty, activity.busy, onActivity);
  function choose(id: string) { if (!blocked && id !== selected && confirmLeave(activity)) { setSelected(id); setMode('notes'); } }
  function reload() { if (!blocked && confirmLeave(activity)) { setSelected(''); setMode('notes'); read.retry(); } }
  function changeMode(next: 'notes' | 'submission' | 'rights' | 'professional' | 'publication') { if (!blocked && next !== mode && confirmLeave(activity)) setMode(next); }
  const photo = read.data?.items.find(item => item.id === selected);
  const candidates = read.data?.items ?? [], term = query.trim().toLowerCase();
  const visible = candidates.filter(item => `${item.name} ${item.ingredientId}`.toLowerCase().includes(term));
  return <section className="panel private-photos" aria-label="图片审阅">
    <div className="panel-heading"><h2>真实照片候选</h2><button className="secondary" disabled={read.loading || blocked || activity.busy} onClick={reload}>重新读取候选</button></div>
    {blocked && <p className="notice">正在核对会话，原图预览已关闭；当前输入保留。</p>}
    <p className="notice">核对原图、送审说明与使用权限后，再确认展示效果。只有管理员明确发布的有效图集才会提供给用户端。</p>
    {read.loading ? <p role="status">正在读取图片资料…</p> : read.error ? <p className="notice error" role="alert">{read.error}</p> : read.data && !read.data.enabled ? <p className="empty">尚未配置私有图片库。</p> : read.data && !read.data.items.length ? <p className="empty">当前图片库没有候选记录。</p> : <>
    <div className="private-photo-tools" hidden={blocked}>
      <label htmlFor={searchId}>搜索照片候选</label><input id={searchId} type="search" value={query} disabled={blocked} onChange={event => setQuery(event.target.value)} placeholder="食材名称" />
      {query && <button className="secondary" disabled={blocked} onClick={() => setQuery('')}>清除照片搜索</button>}
      <p className="small muted" aria-live="polite">{candidates.length} 张候选 · {new Set(candidates.map(item => item.ingredientId)).size} 种食材{term ? ` · 匹配 ${visible.length} 张` : ''}</p>
      {photo && !visible.some(item => item.id === photo.id) && <p className="small muted">当前核对：{photo.name}</p>}
    </div>
    <div className="private-photo-layout" hidden={blocked}>
      <div className="private-photo-list" aria-label="照片候选列表">{visible.map(item => <button className={selected === item.id ? 'secondary selected' : 'secondary'} aria-pressed={selected === item.id} key={item.id} disabled={blocked || activity.busy} onClick={() => choose(item.id)}>{item.name}<small>{item.width} × {item.height} · 待审阅</small></button>)}{!visible.length && <p className="empty">没有匹配的照片候选。</p>}</div>
      {photo ? <article className="private-photo-detail" key={photo.id}><h3>{photo.name}</h3>
        {!blocked && <Original photo={photo} session={session} />}
        <p className="small muted">原图保留元数据，可能含位置信息；关闭、切换或页面隐藏后释放本页预览。浏览器网络缓存策略为不存储，不承诺操作系统或浏览器进程的即时内存清零。</p>
        <dl className="facts"><div><dt>身份核对</dt><dd>见核对记录</dd></div><div><dt>部位与加工</dt><dd>见专业结论</dd></div><div><dt>项目权利审核</dt><dd>见权利审核页签</dd></div><div><dt>专业审校</dt><dd>见专业审校页签</dd></div></dl>
        <p>{photo.observation}</p><h4>核对事项</h4><ul>{photo.concerns.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>来源与声明许可</h4><a href={`${photo.sourcePage}?oldid=${photo.sourceRevision}`} target="_blank" rel="noopener noreferrer">查看来源文件页 ↗</a><p>作者：{photo.author} · 文件页修订：{photo.sourceRevision}</p><a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.declaredLicense} 声明许可 ↗</a>
        <p className="small muted">以上是来源许可声明，不代表项目已批准使用。原图字节未修改；后续公开衍生图需另行脱敏、核对许可并绑定审校版本。</p><p className="publication-digest small">{photo.sha256}</p>
        <div className="photo-workspace-tabs" role="tablist" aria-label="图片资料流程">
          <button id={`${tabsId}-notes`} className="secondary" role="tab" aria-selected={mode === 'notes'} aria-controls={`${tabsId}-panel`} disabled={blocked || activity.busy} onClick={() => changeMode('notes')}>核对记录</button>
          <button id={`${tabsId}-submission`} className="secondary" role="tab" aria-selected={mode === 'submission'} aria-controls={`${tabsId}-panel`} disabled={blocked || activity.busy} onClick={() => changeMode('submission')}>送审资料</button>
          <button id={`${tabsId}-rights`} className="secondary" role="tab" aria-selected={mode === 'rights'} aria-controls={`${tabsId}-panel`} disabled={blocked || activity.busy} onClick={() => changeMode('rights')}>权利审核</button>
          <button id={`${tabsId}-professional`} className="secondary" role="tab" aria-selected={mode === 'professional'} aria-controls={`${tabsId}-panel`} disabled={blocked || activity.busy} onClick={() => changeMode('professional')}>专业审校</button>
          <button id={`${tabsId}-publication`} className="secondary" role="tab" aria-selected={mode === 'publication'} aria-controls={`${tabsId}-panel`} disabled={blocked || activity.busy} onClick={() => changeMode('publication')}>展示与发布</button>
        </div>
        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${mode}`}>
          {mode === 'notes' ? <PhotoNotes photo={photo} session={session} blocked={blocked} onActivity={setActivity} /> : mode === 'submission' ? <PhotoSubmissions photo={photo} session={session} blocked={blocked} onActivity={setActivity} /> : mode === 'rights' ? <PhotoRights photo={photo} session={session} blocked={blocked} onActivity={setActivity} /> : mode === 'professional' ? <PhotoProfessional photo={photo} session={session} blocked={blocked} onActivity={setActivity} /> : <PhotoPublication photo={photo} session={session} blocked={blocked} onActivity={setActivity} />}
        </div>
      </article> : <p className="empty">选择一张候选，核对原图及来源。</p>}
    </div></>}
  </section>;
}
