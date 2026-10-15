import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/contracts';
import { parsePrivatePhotoList, type PrivatePhoto } from '../shared/private-photos';
import type { PhotoDerivative } from '../shared/photo-derivatives';
import { readPrivateDerivative, readPrivateJpeg } from './private-photo-api';
import { useDecodedReadResult } from './useReadResult';

interface Preview { photo: PrivatePhoto; session: SessionInfo; url: string; derivative: PhotoDerivative | null; loading: boolean; decoded: boolean; error: string }
function DraftPhotoImage({ photo, session }: { photo: PrivatePhoto; session: SessionInfo }) {
  const [attempt, setAttempt] = useState(0), [view, setView] = useState<Preview | null>(null);
  const lifetime = useRef<{ controller: AbortController; url: string } | null>(null);
  function retire() { const old = lifetime.current; lifetime.current = null; old?.controller.abort(); if (old?.url) URL.revokeObjectURL(old.url); }
  useEffect(() => {
    const owner = { controller: new AbortController(), url: '' }; lifetime.current = owner;
    setView({ photo, session, url: '', derivative: null, loading: true, decoded: false, error: '' });
    const live = () => !owner.controller.signal.aborted && lifetime.current === owner && !document.hidden;
    void (async () => {
      try {
        const derivative = await readPrivateDerivative(photo, session, owner.controller.signal);
        const blob = await readPrivateJpeg(`/api/v1/private-photo-derivatives/${photo.id}/image`, derivative, owner.controller.signal, '展示图');
        if (!live()) return;
        owner.url = URL.createObjectURL(blob);
        setView({ photo, session, url: owner.url, derivative, loading: false, decoded: false, error: '' });
      } catch (error) { if (live()) setView({ photo, session, url: '', derivative: null, loading: false, decoded: false, error: error instanceof Error ? error.message : '展示图读取失败。' }); }
    })();
    return () => { owner.controller.abort(); if (owner.url) URL.revokeObjectURL(owner.url); if (lifetime.current === owner) lifetime.current = null; };
  }, [photo, session, attempt]);
  const current = view?.photo === photo && view.session === session ? view : null;
  function failed() { retire(); setView({ photo, session, url: '', derivative: null, loading: false, decoded: false, error: '展示图解码或尺寸不匹配，请重新读取。' }); }
  return <figure className="draft-photo-preview" aria-label="草稿关联照片">
    {current?.loading && <p role="status">正在读取待审展示图…</p>}
    {current?.url && current.derivative && <img src={current.url} alt={`${photo.name}，私有待审展示图`} hidden={!current.decoded} onLoad={event => {
      if (lifetime.current?.url !== current.url) return;
      if (event.currentTarget.naturalWidth !== current.derivative?.width || event.currentTarget.naturalHeight !== current.derivative.height) failed();
      else setView({ ...current, decoded: true });
    }} onError={() => { if (lifetime.current?.url === current.url) failed(); }} />}
    {current?.error && <p role="alert" className="notice error">{current.error}</p>}
    {current?.loading ? <button className="secondary" onClick={() => { retire(); setView({ photo, session, url: '', derivative: null, loading: false, decoded: false, error: '读取已取消，可手动重新读取。' }); }}>取消展示图读取</button> : current?.error && <button className="secondary" onClick={() => setAttempt(value => value + 1)}>重新读取展示图</button>}
    <figcaption><strong>{photo.name}</strong><p>作者：{photo.author} · <a href={`${photo.sourcePage}?oldid=${photo.sourceRevision}`} target="_blank" rel="noopener noreferrer">固定来源</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.declaredLicense}</a></p>
      <p className="small muted">{current?.derivative?.transformationNotice ?? '仅读取已有展示图，不自动回退到原件。'}</p>
      <details><summary>匹配观察与待核对事项</summary><p>{photo.observation}</p><ul>{photo.concerns.map(value => <li key={value}>{value}</li>)}</ul></details>
    </figcaption>
  </figure>;
}

/** Read-only context. Photo selection never changes or saves the text draft. */
export function DraftPhotoCandidates({ ingredientId, session, blocked = false }: { ingredientId: string; session: SessionInfo; blocked?: boolean }) {
  const [visible, setVisible] = useState(() => !document.hidden), [selected, setSelected] = useState('');
  useEffect(() => { const changed = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed); }, []);
  const read = useDecodedReadResult(visible && !blocked ? '/private-photos' : null, session, parsePrivatePhotoList, 0, 0);
  const photos = read.data?.items.filter(photo => photo.ingredientId === ingredientId) ?? [];
  const photo = photos.find(value => value.id === selected) ?? photos[0];
  return <section className="draft-photos" aria-label="当前食材待审图片">
    <div className="workflow-toolbar"><h3>对应照片 <span className="small muted">{blocked || !visible ? '预览关闭' : read.loading ? '读取中' : read.error ? '暂不可用' : read.data?.enabled ? `${photos.length} 张候选` : '未配置'}</span></h3><button className="secondary" disabled={read.loading || blocked || !visible} onClick={read.retry}>重新读取照片</button></div>
    <p className="small muted">图片仅供内部核对，不代表与条目身份、部位或加工形态已经匹配。</p>
    {blocked || !visible ? <p className="muted">预览已关闭，内容输入保留。</p> : read.loading ? <p role="status">正在读取对应照片…</p> : read.error ? <p role="alert" className="notice error">{read.error}</p> : read.data && !read.data.enabled ? <p className="muted">当前演示未配置待审图片。</p> : !photos.length ? <p className="muted">此条目尚无对应候选。</p> : <>
      <div className="draft-photo-choices" role="group" aria-label="切换当前食材照片">{photos.map(value => <button key={value.id} className={`secondary${value.id === photo?.id ? ' selected' : ''}`} aria-pressed={value.id === photo?.id} onClick={() => setSelected(value.id)}>{value.name}</button>)}</div>
      {photo && <DraftPhotoImage key={`${ingredientId}:${photo.id}:${photo.sha256}`} photo={photo} session={session} />}
    </>}
  </section>;
}
