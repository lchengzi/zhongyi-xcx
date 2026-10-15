import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/contracts';
import { parseEditorialReferenceList, type EditorialReference } from '../shared/editorial-references';
import { useDecodedReadResult } from './useReadResult';
import { readPrivateJpeg } from './private-photo-api';

function ReferenceImage({ reference, session }: { reference: EditorialReference; session: SessionInfo }) {
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<{ reference: EditorialReference; session: SessionInfo; url: string; loading: boolean; decoded: boolean; error: string } | null>(null);
  const lifetime = useRef<{ controller: AbortController; url: string } | null>(null);
  function retire() { const old = lifetime.current; lifetime.current = null; old?.controller.abort(); if (old?.url) URL.revokeObjectURL(old.url); }
  useEffect(() => {
    const owner = { controller: new AbortController(), url: '' }; lifetime.current = owner;
    setView({ reference, session, url: '', loading: true, decoded: false, error: '' });
    const live = () => lifetime.current === owner && !owner.controller.signal.aborted && !document.hidden;
    void readPrivateJpeg(`/api/v1/editorial-references/${reference.id}/image`, reference, owner.controller.signal, '研究参考图').then(blob => {
      if (!live()) return;
      owner.url = URL.createObjectURL(blob); setView({ reference, session, url: owner.url, loading: false, decoded: false, error: '' });
    }).catch(error => { if (live()) setView({ reference, session, url: '', loading: false, decoded: false, error: error instanceof Error ? error.message : '研究参考读取失败。' }); });
    return () => { owner.controller.abort(); if (owner.url) URL.revokeObjectURL(owner.url); if (lifetime.current === owner) lifetime.current = null; };
  }, [reference, session, attempt]);
  const current = view?.reference === reference && view.session === session ? view : null;
  function failed(message: string) { retire(); setView({ reference, session, url: '', loading: false, decoded: false, error: message }); }
  return <figure className="draft-photo-preview" aria-label="研究参考图">
    {current?.loading && <p role="status">正在读取研究参考图…</p>}
    {current?.url && <img src={current.url} alt={`${reference.name}，私有研究参考`} hidden={!current.decoded} onLoad={event => {
      if (lifetime.current?.url !== current.url) return;
      if (event.currentTarget.naturalWidth !== reference.width || event.currentTarget.naturalHeight !== reference.height) failed('研究参考图尺寸不匹配，未显示图片。');
      else setView({ ...current, decoded: true });
    }} onError={() => { if (lifetime.current?.url === current.url) failed('研究参考图解码失败，请重新读取。'); }} />}
    {current?.error && <p role="alert" className="notice error">{current.error}</p>}
    {current?.loading ? <button className="secondary" onClick={() => failed('读取已取消，可手动重新读取。')}>取消研究图读取</button> : current?.error && <button className="secondary" onClick={() => setAttempt(value => value + 1)}>重新读取研究图</button>}
    <figcaption><strong>{reference.name}</strong><p>{reference.publisher} · {reference.author}</p>
      <p><a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">研究出处</a> · {reference.licenseUrl ? <a href={reference.licenseUrl} target="_blank" rel="noopener noreferrer">{reference.declaredLicense}声明</a> : '图片转载许可未取得'}</p>
      <p className="small muted">{reference.locator}</p><p>{reference.observation}</p>
      <p className="small muted">{reference.representation === 'repository-display' ? '仓储缩放展示版，作者原图未取得。' : reference.representation === 'source-page-image' ? '原页参考图，可能保留原始附加元数据。' : reference.representation === 'source-thumbnail' ? '来源站独立缩略图，不是已校验原件；原件问题另按待核对事项记录。' : '既有处理展示版，不替代原件。'} 研究参考不进入候选批准或发布流程。</p>
      <details><summary>研究图待核对事项</summary><ul>{reference.concerns.map(item => <li key={item}>{item}</li>)}</ul></details>
    </figcaption>
  </figure>;
}

export function DraftResearchReferences({ ingredientId, session, blocked = false }: { ingredientId: string; session: SessionInfo; blocked?: boolean }) {
  const [visible, setVisible] = useState(() => !document.hidden), [selected, setSelected] = useState('');
  useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  const read = useDecodedReadResult(visible && !blocked ? '/editorial-references' : null, session, parseEditorialReferenceList, 0, 0);
  if (read.data && !read.data.enabled) return null;
  const items = read.data?.items.filter(item => item.ingredientId === ingredientId) ?? [], reference = items.find(item => item.id === selected) ?? items[0];
  return <section className="draft-photos" aria-label="当前食材研究参考">
    <div className="workflow-toolbar"><h3>研究参考 <span className="small muted">{blocked || !visible ? '预览关闭' : read.loading ? '读取中' : read.error ? '暂不可用' : `${items.length} 张`}</span></h3><button className="secondary" disabled={read.loading || blocked || !visible} onClick={read.retry}>重新读取研究参考</button></div>
    <p className="small muted">食品身份、图片使用许可和专业匹配待逐项核对。</p>
    {blocked || !visible ? <p>研究预览已关闭，内容输入保留。</p> : read.loading ? <p role="status">正在读取研究参考…</p> : read.error ? <p role="alert" className="notice error">{read.error}</p> : !reference ? <p>此条目尚无研究参考图。</p> : <>
      <div className="draft-photo-choices" role="group" aria-label="切换研究参考">{items.map(item => <button className="secondary" key={item.id} aria-pressed={item.id === reference.id} onClick={() => setSelected(item.id)}>{item.name}</button>)}</div>
      <ReferenceImage key={`${ingredientId}:${reference.id}:${reference.sha256}`} reference={reference} session={session} />
    </>}
  </section>;
}
