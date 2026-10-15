import { useEffect, useId, useRef, useState } from 'react';
import type { Account, SessionInfo } from '../shared/contracts';
import type { PrivatePhoto } from '../shared/private-photos';
import { PHOTO_NOTE_CATEGORIES, matchesPhotoNoteAttempt, type PhotoNoteCategory, type PhotoNoteDetail, type PhotoNoteInput } from '../shared/photo-notes';
import { readPhotoNotes, savePhotoNote } from './photo-note-api';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

const categoryNames: Record<PhotoNoteCategory, string> = { identity: '身份与部位', processing: '加工形态', rights: '来源与权利', general: '其他事项' };
interface Fields { category: PhotoNoteCategory; text: string; evidenceReference: string }
const empty = (): Fields => ({ category: 'identity', text: '', evidenceReference: '' });
type Phase = 'loading' | 'idle' | 'saving' | 'checking' | 'verify' | 'error';

export function PhotoNotes({ photo, session, blocked, onActivity }: { photo: PrivatePhoto; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const fieldId = useId();
  const [owner, setOwner] = useState({ photo, session });
  const [detail, setDetail] = useState<PhotoNoteDetail | null>(null), [fields, setFields] = useState<Fields>(empty);
  const [phase, setPhase] = useState<Phase>('loading'), [feedback, setFeedback] = useState('');
  const [needsNewConfirmation, setNeedsNewConfirmation] = useState(false);
  const life = useRef<{ photo: PrivatePhoto; session: SessionInfo; live: boolean } | null>(null);
  const operation = useRef<{ controller: AbortController; kind: 'read' | 'write' } | null>(null);
  const attempt = useRef<{ input: PhotoNoteInput; actor: Account } | null>(null);
  const owned = owner.photo === photo && owner.session === session;
  const busy = owned && (phase === 'saving' || phase === 'checking');
  const dirty = owned && (!!fields.text || !!fields.evidenceReference || fields.category !== 'identity' || phase === 'verify' || needsNewConfirmation);
  const readOnly = session.user.role === 'reviewer';
  useActivity(dirty, busy, onActivity);

  useEffect(() => {
    const lifetime = { photo, session, live: true }; life.current = lifetime;
    const current = { controller: new AbortController(), kind: 'read' as const }; operation.current = current;
    setOwner({ photo, session }); setDetail(null); setFields(empty()); setPhase('loading'); setFeedback(''); setNeedsNewConfirmation(false); attempt.current = null;
    if (blocked) { current.controller.abort(); operation.current = null; setPhase('error'); setFeedback('会话正在核对，请稍后重新读取记录。'); return () => { lifetime.live = false; }; }
    void readPhotoNotes(photo, session, current.controller.signal).then(value => {
      if (lifetime.live && !current.controller.signal.aborted) { setDetail(value); setPhase('idle'); }
    }).catch(error => { if (lifetime.live && !current.controller.signal.aborted) { setFeedback(problem(error)); setPhase('error'); } })
      .finally(() => { if (operation.current === current) operation.current = null; });
    return () => { lifetime.live = false; operation.current?.controller.abort(); operation.current = null; };
  }, [photo, session]);
  useEffect(() => {
    if (!blocked || !operation.current) return;
    const current = operation.current; current.controller.abort(); operation.current = null;
    setPhase(current.kind === 'write' ? 'verify' : 'error'); setFeedback(current.kind === 'write' ? '会话正在核对，提交结果尚不能确认；输入已保留。' : '会话正在核对，请稍后重新读取记录。');
  }, [blocked]);
  const available = () => owned && !blocked && life.current?.live && life.current.photo === photo && life.current.session === session && !operation.current;
  async function save() {
    if (!available() || readOnly || !detail || phase !== 'idle' || !fields.text.trim() || !fields.evidenceReference.trim()) return;
    if (needsNewConfirmation && !window.confirm('这是一次新的手动提交。先前请求可能仍在处理，重新读取不能撤销它；继续保存当前意见吗？')) return;
    const lifetime = life.current!, current = { controller: new AbortController(), kind: 'write' as const };
    const input: PhotoNoteInput = { ...fields, bindingDigest: detail.bindingDigest, expectedVersion: detail.version };
    attempt.current = { input: { ...input }, actor: { ...session.user } }; operation.current = current; setPhase('saving'); setFeedback('');
    try {
      const saved = await savePhotoNote(photo, input, session, current.controller.signal);
      if (!lifetime.live || current.controller.signal.aborted || operation.current !== current) return;
      setDetail({ ...detail, version: saved.version, history: [saved, ...detail.history].slice(0, 50) }); setFields(empty()); attempt.current = null;
      setNeedsNewConfirmation(false); setPhase('idle'); setFeedback('核对意见已保存。');
    } catch (error) {
      if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setPhase('verify'); setFeedback(`${problem(error)} 输入已保留，请先重新读取核对记录。`); }
    } finally { if (operation.current === current) operation.current = null; }
  }
  async function reload() {
    if (!available()) return;
    const lifetime = life.current!, current = { controller: new AbortController(), kind: 'read' as const };
    operation.current = current; setPhase('checking'); setFeedback('');
    try {
      const value = await readPhotoNotes(photo, session, current.controller.signal, detail ?? undefined);
      if (!lifetime.live || current.controller.signal.aborted || operation.current !== current) return;
      setDetail(value);
      const pending = attempt.current;
      if (pending && value.history.some(note => matchesPhotoNoteAttempt(note, photo, pending.input, pending.actor))) {
        setFields(empty()); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('已核对到本次保存记录。');
      } else {
        setNeedsNewConfirmation(!!pending);
        setFeedback(pending ? '未找到本次提交的匹配记录，不能排除原请求稍后完成；输入已保留。再次保存前需单独确认。' : '核对记录已重新读取，当前输入保留。');
      }
      setPhase('idle');
    } catch (error) { if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setPhase('error'); setFeedback(problem(error)); } }
    finally { if (operation.current === current) operation.current = null; }
  }
  function clear() {
    if (!available() || !dirty || phase !== 'idle' || !window.confirm('清空当前输入不会撤销已经提交的请求。继续吗？')) return;
    setFields(empty()); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('输入已清空，已保存历史不变。');
  }
  const current = owned ? detail : null, currentPhase = owned ? phase : 'loading';
  const locked = !current || readOnly || blocked || currentPhase !== 'idle';
  return <section className="photo-notes" aria-label="图片核对记录" aria-busy={busy}>
    <div className="panel-heading"><h4>核对记录</h4><button className="secondary" onClick={() => { void reload(); }} disabled={blocked || busy || currentPhase === 'loading'}>重新读取核对记录</button></div>
    <p className="small muted">记录具体疑点与依据，不代表图片鉴定、权利批准或专业签审。历史保留，不覆盖旧意见。</p>
    {currentPhase === 'loading' && <p role="status">正在读取核对记录…</p>}
    {owned && feedback && <p className={['verify', 'error'].includes(phase) ? 'notice error' : 'notice'} role={['verify', 'error'].includes(phase) ? 'alert' : 'status'} aria-label="图片核对反馈">{feedback}</p>}
    {current && <p className="small muted">已读修订 {current.version} · 最近 {current.history.length} 条记录（最多50条）</p>}
    {readOnly ? <p className="notice">当前账号可查阅核对历史，不能新增意见。</p> : <>
      <fieldset disabled={locked} className="photo-note-fields"><legend>新增核对意见</legend>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-category`}>核对类别</label><select id={`${fieldId}-category`} value={owned ? fields.category : 'identity'} onChange={event => { const value = PHOTO_NOTE_CATEGORIES.find(item => item === event.target.value); if (value) setFields(previous => ({ ...previous, category: value })); }}>{Object.entries(categoryNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-text`}>核对意见</label><textarea id={`${fieldId}-text`} value={owned ? fields.text : ''} maxLength={1200} onChange={event => { const value = event.target.value; setFields(previous => ({ ...previous, text: value })); }} /></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-evidence`}>依据与定位</label><input id={`${fieldId}-evidence`} value={owned ? fields.evidenceReference : ''} maxLength={400} onChange={event => { const value = event.target.value; setFields(previous => ({ ...previous, evidenceReference: value })); }} /></div>
      </fieldset>
      <div className="note-actions"><button className="primary" disabled={locked || !fields.text.trim() || !fields.evidenceReference.trim()} onClick={() => { void save(); }}>{phase === 'saving' ? '保存中…' : '保存核对意见'}</button><button className="text-button" onClick={clear} disabled={locked || !dirty}>清空输入</button></div>
    </>}
    {!blocked && current && !['error', 'loading'].includes(currentPhase) && <div className="photo-note-history" aria-label="图片核对历史">
      {!current.history.length ? <p className="empty">尚无核对意见。</p> : current.history.map(note => <article key={note.version}>
        <h5>#{note.version} · {categoryNames[note.category]}</h5><p className="small muted">{note.actorName} · {timestamp(note.createdAt)}</p>
        <p className="preserve-lines">{note.text}</p><p className="preserve-lines">依据：{note.evidenceReference}</p>
        <p className={note.bindingDigest === current.bindingDigest ? 'small muted' : 'notice'}>{note.bindingDigest === current.bindingDigest ? '当前原图与来源版本' : '历史原图或来源版本，不作为当前核对结论'} · 来源修订 {note.candidate.sourceRevision}</p>
        <p className="publication-digest small">原图：{note.candidate.sha256}</p>
        <details><summary>当时的候选与来源</summary><p>{note.candidate.name} · {note.candidate.width} × {note.candidate.height}</p>
          <a href={`${note.candidate.sourcePage}?oldid=${note.candidate.sourceRevision}`} target="_blank" rel="noopener noreferrer">当时的来源文件页 ↗</a>
          <p>作者：{note.candidate.author} · <a href={note.candidate.licenseUrl} target="_blank" rel="noopener noreferrer">{note.candidate.declaredLicense} 声明许可 ↗</a></p>
          <p className="small muted">保留当时声明，不表示已取得项目使用批准；旧原图不保证仍可预览。</p>
        </details>
      </article>)}
    </div>}
  </section>;
}
