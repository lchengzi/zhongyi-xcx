import { useEffect, useId, useRef, useState } from 'react';
import type { Account, SessionInfo } from '../shared/contracts';
import type { PrivatePhoto } from '../shared/private-photos';
import { matchesPhotoSubmissionAttempt, parsePhotoSubmissionInput, type PhotoSubmissionInput } from '../shared/photo-submissions';
import { readPhotoSubmissions, submitPhoto, type PhotoSubmissionWorkspace } from './photo-submission-api';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

interface Fields { caption: string; partDescription: string; processingDescription: string; evidenceReference: string }
const empty = (): Fields => ({ caption: '', partDescription: '', processingDescription: '', evidenceReference: '' });
type Phase = 'loading' | 'idle' | 'saving' | 'checking' | 'verify' | 'error';
interface Lifetime { photo: PrivatePhoto; session: SessionInfo; live: boolean }
interface Operation { owner: Lifetime; controller: AbortController; kind: 'read' | 'write' }

export function PhotoSubmissions({ photo, session, blocked, onActivity }: { photo: PrivatePhoto; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const fieldId = useId(), [owner, setOwner] = useState({ photo, session });
  const [workspace, setWorkspace] = useState<PhotoSubmissionWorkspace | null>(null), [fields, setFields] = useState<Fields>(empty);
  const [confirmed, setConfirmed] = useState(false), [phase, setPhase] = useState<Phase>('loading'), [feedback, setFeedback] = useState('');
  const [needsNewConfirmation, setNeedsNewConfirmation] = useState(false);
  const life = useRef<Lifetime | null>(null), operation = useRef<Operation | null>(null);
  const attempt = useRef<{ input: PhotoSubmissionInput; actor: Account } | null>(null);
  const owned = owner.photo === photo && owner.session === session;
  const busy = owned && (phase === 'saving' || phase === 'checking');
  const dirty = owned && (Object.values(fields).some(Boolean) || confirmed || phase === 'verify' || needsNewConfirmation);
  const readOnly = session.user.role === 'reviewer';
  useActivity(dirty, busy, onActivity);

  useEffect(() => {
    const lifetime: Lifetime = { photo, session, live: true }; life.current = lifetime;
    setOwner({ photo, session }); setWorkspace(null); setFields(empty()); setConfirmed(false); setPhase('loading'); setFeedback(''); setNeedsNewConfirmation(false); attempt.current = null;
    const current: Operation = { owner: lifetime, controller: new AbortController(), kind: 'read' }; operation.current = current;
    if (blocked || document.hidden) {
      current.controller.abort(); operation.current = null; setPhase('error'); setFeedback('请在会话有效、页面可见时重新读取送审资料。');
    } else {
      void readPhotoSubmissions(photo, session, current.controller.signal).then(value => {
        if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setWorkspace(value); setPhase('idle'); }
      }).catch(error => {
        if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setPhase('error'); setFeedback(problem(error)); }
      }).finally(() => { if (operation.current === current) operation.current = null; });
    }
    const hidden = () => {
      if (!document.hidden || !lifetime.live || life.current !== lifetime) return;
      const currentOperation = operation.current, uncertain = currentOperation?.kind === 'write' || attempt.current !== null;
      currentOperation?.controller.abort(); operation.current = null; setConfirmed(false); setPhase(uncertain ? 'verify' : 'error');
      setFeedback(uncertain ? '页面已隐藏，送审结果尚不能确认；输入已保留，请重新读取核对。' : '页面已隐藏，请重新读取送审资料后再操作。');
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      lifetime.live = false; document.removeEventListener('visibilitychange', hidden);
      if (operation.current?.owner === lifetime) { operation.current.controller.abort(); operation.current = null; }
    };
  }, [photo, session]);
  useEffect(() => {
    if (!blocked) return;
    const current = operation.current, uncertain = current?.kind === 'write' || attempt.current !== null;
    current?.controller.abort(); operation.current = null; setConfirmed(false); setPhase(uncertain ? 'verify' : 'error');
    setFeedback(uncertain ? '会话正在核对，送审结果尚不能确认；输入已保留。' : '会话正在核对，请稍后重新读取送审资料。');
  }, [blocked]);
  const available = () => owned && !blocked && !document.hidden && life.current?.live && life.current.photo === photo && life.current.session === session && !operation.current;
  const current = owned ? workspace : null, currentPhase = owned ? phase : 'loading';
  const ready = !!current && current.detail.noteVersion > 0 && current.detail.noteBindingDigest === current.detail.bindingDigest;
  const locked = !current || readOnly || blocked || currentPhase !== 'idle' || !ready;
  function change(name: keyof Fields, value: string) {
    if (!available() || locked) return;
    setFields(previous => ({ ...previous, [name]: value })); setConfirmed(false); setFeedback('');
  }
  async function submit() {
    if (!available() || locked || !workspace?.detail.noteDigest || !confirmed) return;
    let input: PhotoSubmissionInput;
    try { input = parsePhotoSubmissionInput({ ...fields, bindingDigest: workspace.detail.bindingDigest, expectedVersion: workspace.detail.version, expectedNoteVersion: workspace.detail.noteVersion, noteDigest: workspace.detail.noteDigest, submissionConfirmed: true }); }
    catch { setFeedback('请检查说明、部位、加工形态和依据，不能留空或包含控制字符。'); return; }
    if (needsNewConfirmation && !window.confirm('这是一次新的手动送审。先前请求可能仍在处理，重新读取不能撤销它；继续提交当前资料吗？')) return;
    if (!available() || !life.current) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'write' };
    operation.current = currentOperation; attempt.current = { input: { ...input }, actor: { ...session.user } }; setPhase('saving'); setFeedback('');
    try {
      const saved = await submitPhoto(photo, input, session, currentOperation.controller.signal);
      if (!currentOperation.owner.live || currentOperation.controller.signal.aborted || operation.current !== currentOperation) return;
      setWorkspace({ ...workspace, detail: { ...workspace.detail, version: saved.version, history: [saved, ...workspace.detail.history].slice(0, 50) } });
      setFields(empty()); setConfirmed(false); attempt.current = null; setNeedsNewConfirmation(false); setPhase('idle'); setFeedback('送审资料已提交，后续审核尚未完成。');
    } catch (error) {
      if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) { setPhase('verify'); setConfirmed(false); setFeedback(`${problem(error)} 输入已保留，请先重新读取送审资料。`); }
    } finally { if (operation.current === currentOperation) operation.current = null; }
  }
  async function reload() {
    if (!available() || !life.current) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'read' };
    operation.current = currentOperation; setPhase('checking'); setFeedback(''); setConfirmed(false);
    try {
      const value = await readPhotoSubmissions(photo, session, currentOperation.controller.signal, workspace ?? undefined);
      if (!currentOperation.owner.live || currentOperation.controller.signal.aborted || operation.current !== currentOperation) return;
      setWorkspace(value);
      const pending = attempt.current;
      if (pending && value.detail.history.some(item => matchesPhotoSubmissionAttempt(item, photo, pending.input, pending.actor))) {
        setFields(empty()); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('已核对到本次送审记录，后续审核尚未完成。');
      } else {
        setNeedsNewConfirmation(!!pending);
        setFeedback(pending ? '未找到本次送审的匹配记录，不能排除原请求稍后完成；输入已保留，再次提交前需单独确认。' : '送审资料已重新读取，输入保留；请核对当前意见后重新确认。');
      }
      setPhase('idle');
    } catch (error) { if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) { setPhase('error'); setFeedback(problem(error)); } }
    finally { if (operation.current === currentOperation) operation.current = null; }
  }
  function clear() {
    if (!available() || !dirty || currentPhase !== 'idle' || !window.confirm('清空输入不会撤销已提交的送审版本。继续吗？') || !available()) return;
    setFields(empty()); setConfirmed(false); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('输入已清空，已保存历史不变。');
  }
  const head = current?.notes.history[0];
  return <section className="photo-submissions" aria-label="图片送审资料" aria-busy={busy}>
    <div className="panel-heading"><h4>送审资料</h4><button className="secondary" onClick={() => { void reload(); }} disabled={blocked || busy || currentPhase === 'loading'}>重新读取送审资料</button></div>
    <p className="small muted">固定这一版说明、原图、来源及核对依据。送审不代表图片鉴定、权利批准或专业签审。</p>
    {currentPhase === 'loading' && <p role="status">正在读取送审资料…</p>}
    {owned && feedback && <p className={['verify', 'error'].includes(phase) ? 'notice error' : 'notice'} role={['verify', 'error'].includes(phase) ? 'alert' : 'status'} aria-label="图片送审反馈">{feedback}</p>}
    {current && !blocked && currentPhase === 'idle' && <>
      <p className="small muted">已读送审版本 {current.detail.version} · 核对修订 {current.detail.noteVersion}</p>
      {!head ? <p className="notice">请先在“核对记录”中补充这张图片的意见与依据，再提交送审资料。</p> : !ready ? <p className="notice">原图或来源已变化，请先登记当前版本的核对意见。</p> : <details className="photo-submission-basis" open><summary>本次关联的核对意见 · #{head.version}</summary><p className="small muted">{head.actorName} · {timestamp(head.createdAt)}</p><p className="preserve-lines">{head.text}</p><p className="preserve-lines">依据：{head.evidenceReference}</p><p className="publication-digest small">{head.digest}</p></details>}
    </>}
    {readOnly ? <p className="notice">当前账号可查阅送审历史，不能提交新版本。</p> : <>
      <fieldset disabled={locked} className="photo-note-fields photo-submission-fields"><legend>新送审版本</legend>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-caption`}>图片说明</label><input id={`${fieldId}-caption`} value={owned ? fields.caption : ''} maxLength={180} onChange={event => change('caption', event.target.value)} /></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-part`}>部位描述</label><input id={`${fieldId}-part`} value={owned ? fields.partDescription : ''} maxLength={120} onChange={event => change('partDescription', event.target.value)} /></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-processing`}>加工形态描述</label><input id={`${fieldId}-processing`} value={owned ? fields.processingDescription : ''} maxLength={120} onChange={event => change('processingDescription', event.target.value)} /></div>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-evidence`}>送审依据与定位</label><textarea id={`${fieldId}-evidence`} value={owned ? fields.evidenceReference : ''} maxLength={400} onChange={event => change('evidenceReference', event.target.value)} /></div>
        <label className="photo-submission-confirm submission-wide" htmlFor={`${fieldId}-confirmed`}><input id={`${fieldId}-confirmed`} type="checkbox" checked={owned && confirmed} onChange={event => { if (available() && !locked) setConfirmed(event.target.checked); }} />已核对以上说明与当前核对记录，确认提交这一版图片资料。</label>
      </fieldset>
      <div className="note-actions"><button className="primary" disabled={locked || !confirmed || Object.values(fields).some(value => !value.trim())} onClick={() => { void submit(); }}>{phase === 'saving' ? '提交中…' : '提交送审资料'}</button><button className="text-button" onClick={clear} disabled={blocked || busy || currentPhase !== 'idle' || !dirty}>清空送审输入</button></div>
    </>}
    {!blocked && current && currentPhase === 'idle' && <div className="photo-note-history" aria-label="图片送审历史">
      {!current.detail.history.length ? <p className="empty">尚无送审版本。</p> : current.detail.history.map(item => <article key={item.version}>
        <h5>送审 #{item.version} · {item.caption}</h5><p className="small muted">{item.actorName} · {timestamp(item.createdAt)} · 核对修订 {item.noteVersion}</p>
        <p className="preserve-lines">部位：{item.partDescription}</p><p className="preserve-lines">加工：{item.processingDescription}</p><p className="preserve-lines">依据：{item.evidenceReference}</p>
        <p className="small muted">{item.bindingDigest === current.detail.bindingDigest ? '当前原图与来源版本' : '历史原图或来源版本'} · {item.noteVersion === current.detail.noteVersion ? '对应已读核对修订' : '核对意见已有后续修订'}</p>
        <details><summary>版本与来源凭据</summary><p>{item.candidate.name} · 来源修订 {item.candidate.sourceRevision}</p><a href={`${item.candidate.sourcePage}?oldid=${item.candidate.sourceRevision}`} target="_blank" rel="noopener noreferrer">送审时的来源文件页 ↗</a><p>作者：{item.candidate.author} · <a href={item.candidate.licenseUrl} target="_blank" rel="noopener noreferrer">{item.candidate.declaredLicense} 声明许可 ↗</a></p><p className="publication-digest small">原图：{item.candidate.sha256}</p><p className="publication-digest small">核对：{item.noteDigest}</p><p className="publication-digest small">送审：{item.digest}</p></details>
      </article>)}
    </div>}
  </section>;
}
