import { useEffect, useId, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/contracts';
import type { PrivatePhoto } from '../shared/private-photos';
import { parsePhotoPublicationInput, type PhotoPublicationHistory, type PhotoPublicationInput, type PhotoPublicationSelection } from '../shared/photo-publications';
import { photoPublicationMatches, readPhotoPublication, readPhotoPublicationHistory, writePhotoPublication, type PhotoPublicationDesk } from './photo-publication-api';
import { readPrivateJpeg } from './private-photo-api';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

type Phase = 'loading' | 'reading' | 'idle' | 'writing' | 'verify' | 'error';
interface Lifetime { photo: PrivatePhoto; session: SessionInfo; live: boolean }
interface Operation { owner: Lifetime; controller: AbortController; write: boolean }

export function PhotoPublication({ photo, session, blocked, onActivity }: { photo: PrivatePhoto; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const field = useId(), [owner, setOwner] = useState({ photo, session });
  const [desk, setDesk] = useState<PhotoPublicationDesk | null>(null), [history, setHistory] = useState<PhotoPublicationHistory | null>(null);
  const [historyReady, setHistoryReady] = useState(false), [preview, setPreview] = useState(''), [phase, setPhase] = useState<Phase>('loading');
  const [decoded, setDecoded] = useState(false);
  const [reason, setReason] = useState(''), [displayConfirmed, setDisplayConfirmed] = useState(false), [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [replace, setReplace] = useState(false), [feedback, setFeedback] = useState(''), [checkedAttempt, setCheckedAttempt] = useState(false);
  const lifetime = useRef<Lifetime | null>(null), operation = useRef<Operation | null>(null), attempt = useRef<PhotoPublicationInput | null>(null), blobUrl = useRef('');
  const owned = owner.photo === photo && owner.session === session, busy = owned && ['loading', 'reading', 'writing'].includes(phase);
  useActivity(owned && (!!reason || displayConfirmed || privacyConfirmed || replace || !!attempt.current), busy, onActivity);
  function closePreview() { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''; setPreview(''); setDecoded(false); }
  function live(current: Operation) { return current.owner.live && operation.current === current && !current.controller.signal.aborted && !document.hidden; }
  const available = () => owned && !blocked && !document.hidden && lifetime.current?.live && lifetime.current.photo === photo && lifetime.current.session === session && !operation.current;
  async function load(current: Operation, previous?: PhotoPublicationDesk, previousHistory?: PhotoPublicationHistory) {
    closePreview(); setDisplayConfirmed(false); setPrivacyConfirmed(false); setHistoryReady(false); setCheckedAttempt(false);
    try {
      const value = await readPhotoPublicationHistory(current.owner.photo.ingredientId, current.owner.session, current.controller.signal, previousHistory);
      if (!live(current)) return;
      setHistory(value); setHistoryReady(true);
      const pending = attempt.current;
      if (pending) {
        if (value.items.some(item => photoPublicationMatches(item, pending, current.owner.session))) {
          attempt.current = null; setReason(''); setReplace(false); setFeedback('已核对到本次操作记录。');
        } else { setCheckedAttempt(true); setFeedback('未查到本次操作的匹配记录；原请求可能仍在处理，输入已保留。'); }
      }
      const next = await readPhotoPublication(current.owner.photo, value, current.owner.session, current.controller.signal, previous);
      const bytes = await readPrivateJpeg(`/api/v1/private-photo-derivatives/${current.owner.photo.id}/image`, next.derivative, current.controller.signal, '展示图');
      if (!live(current)) return;
      blobUrl.current = URL.createObjectURL(bytes); setPreview(blobUrl.current); setDesk(next); setPhase(attempt.current ? 'verify' : 'idle');
    } catch (error) { if (live(current)) { setPhase(attempt.current ? 'verify' : 'error'); setFeedback(`${problem(error)} 输入已保留；读取到发布记录时仍可撤回。`); } }
    finally { if (operation.current === current) operation.current = null; }
  }
  useEffect(() => {
    const owner: Lifetime = { photo, session, live: true }; lifetime.current = owner;
    setOwner({ photo, session }); setDesk(null); setHistory(null); setHistoryReady(false); setReason(''); setReplace(false); setFeedback(''); setPhase('loading'); setCheckedAttempt(false); attempt.current = null;
    const current: Operation = { owner, controller: new AbortController(), write: false }; operation.current = current;
    if (!blocked && !document.hidden) void load(current);
    else { operation.current = null; setPhase('error'); setFeedback('请在会话有效、页面可见时重新读取。'); }
    const hidden = () => {
      if (!document.hidden || !owner.live) return;
      operation.current?.controller.abort(); operation.current = null; closePreview(); setHistoryReady(false); setDisplayConfirmed(false); setPrivacyConfirmed(false);
      setPhase(attempt.current ? 'verify' : 'error'); setFeedback('页面已隐藏，请重新读取；输入已保留。');
    };
    document.addEventListener('visibilitychange', hidden);
    return () => { owner.live = false; document.removeEventListener('visibilitychange', hidden); if (operation.current?.owner === owner) { operation.current.controller.abort(); operation.current = null; } if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''; };
  }, [photo, session]);
  useEffect(() => {
    if (!blocked) return;
    operation.current?.controller.abort(); operation.current = null; closePreview(); setHistoryReady(false); setDisplayConfirmed(false); setPrivacyConfirmed(false);
    setPhase(attempt.current ? 'verify' : 'error'); setFeedback('会话正在核对，输入已保留。');
  }, [blocked]);
  const current = owned ? desk : null, records = owned ? history : null, head = records?.items[0];
  const professional = current?.professional.detail, submission = current?.professional.rights.submissions.detail.history[0];
  const ready = !!current && !!preview && decoded && phase === 'idle' && historyReady && records?.enabled && !records.recoveryRequired && records.control?.action === 'resume' &&
    professional?.state === 'eligible_for_derivative_review' && current.professional.rights.detail.state === 'rights_verified';
  const administrator = session.user.role === 'admin', writable = owned && administrator && !blocked && historyReady && !busy && !attempt.current;
  const selected: PhotoPublicationSelection | null = current && professional && submission ? { candidateId: photo.id, derivativeDigest: current.derivative.digest,
    professionalVersion: professional.version, rightsVersion: current.professional.rights.detail.version, submissionVersion: submission.version } : null;
  const existing = head?.action === 'publish' ? head.entries : [];
  const selections = selected ? replace ? [selected] : [
    ...existing.map(({ photo: _photo, ...item }) => item.candidateId === photo.id ? selected : item),
    ...(existing.some(item => item.candidateId === photo.id) ? [] : [selected])
  ] : [];
  async function reload() {
    if (!available() || !lifetime.current) return;
    const current: Operation = { owner: lifetime.current, controller: new AbortController(), write: false }; operation.current = current;
    setPhase('reading'); setFeedback(''); await load(current, desk ?? undefined, history ?? undefined);
  }
  async function submit(action: PhotoPublicationInput['action']) {
    if (!available() || !writable || !records || !lifetime.current || !reason.trim() ||
      (action === 'publish' && (!ready || !displayConfirmed || !privacyConfirmed || !selections.length || selections.length > 8))) return;
    if (action === 'withdraw' && !window.confirm(`撤回“${records.name}”的整个图片图集？离线设备可能暂时保留已加载内容。`)) return;
    let input: PhotoPublicationInput;
    try { input = parsePhotoPublicationInput({ expectedVersion: head?.version ?? 0, action, selections: action === 'publish' ? selections : [], displayReviewConfirmed: true, visualPrivacyConfirmed: true, reason: reason.trim() }); }
    catch { setFeedback('请填写操作说明并核对图片选择。'); return; }
    const current: Operation = { owner: lifetime.current, controller: new AbortController(), write: true }; operation.current = current;
    attempt.current = input; setPhase('writing'); setFeedback(''); setCheckedAttempt(false); setDisplayConfirmed(false); setPrivacyConfirmed(false);
    try {
      await writePhotoPublication(records, input, session, current.controller.signal);
      if (!live(current)) return;
      setPhase('reading'); await load(current, desk ?? undefined, records);
    } catch (error) { if (live(current)) { setPhase('verify'); setFeedback(`${problem(error)} 请重新读取核对，勿重复提交。`); } }
    finally { if (operation.current === current) operation.current = null; }
  }
  function newOperation() {
    if (!available() || !checkedAttempt || !historyReady || !window.confirm('原请求可能稍后完成。确认基于已重新读取的版本发起新的手动操作？') || !available()) return;
    attempt.current = null; setCheckedAttempt(false); setDisplayConfirmed(false); setPrivacyConfirmed(false); setPhase(preview ? 'idle' : 'error'); setFeedback('请重新核对并确认本次操作。');
  }
  return <section className="photo-publication" aria-label="图片展示与发布" aria-busy={busy}>
    <div className="panel-heading"><h4>展示与发布</h4><button className="secondary" disabled={blocked || busy} onClick={() => { void reload(); }}>重新读取发布资料</button></div>
    {feedback && <p role="status" className="notice" aria-label="图片发布反馈">{feedback}</p>}
    {busy && <p role="status">{phase === 'writing' ? '正在提交…' : '正在读取展示图与审核资料…'}</p>}
    {!blocked && preview && current && <figure className="photo-publication-preview">
      <img src={preview} alt="待确认的展示图" onLoad={event => {
        if (blobUrl.current !== preview) return;
        if (event.currentTarget.naturalWidth === current.derivative.width && event.currentTarget.naturalHeight === current.derivative.height) setDecoded(true);
        else { closePreview(); setPhase('error'); setFeedback('展示图尺寸不匹配，请重新读取。'); }
      }} onError={() => { if (blobUrl.current !== preview) return; closePreview(); setDisplayConfirmed(false); setPrivacyConfirmed(false); setPhase('error'); setFeedback('展示图解码失败，请重新读取。'); }} />
      <figcaption><strong>{submission?.caption ?? photo.name}</strong><p>部位：{submission?.partDescription ?? '送审说明待填写'} · 加工：{submission?.processingDescription ?? '送审说明待填写'}</p>
        <p>{current.derivative.width} × {current.derivative.height} · {Math.ceil(current.derivative.bytes / 1024)} KB</p>
        <p>作者：{photo.author} · <a href={`${photo.sourcePage}?oldid=${photo.sourceRevision}`} target="_blank" rel="noopener noreferrer">来源</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.declaredLicense}</a></p>
        <p className="small muted">{current.derivative.transformationNotice}</p></figcaption>
    </figure>}
    {records && <p className="notice" aria-label="图片发布状态">{!records.enabled ? '图片发布未启用' : records.control?.action !== 'resume' ? '发布处于冻结状态' : '发布服务已启用'} · {head ? `最近操作：${head.action === 'publish' ? '发布' : '撤回'} #${head.version}` : '尚无发布记录'} · 当前记录图集 {existing.length} 张</p>}
    {records?.recoveryRequired && <p className="notice">图片资源已从备份恢复。请核对数据和撤回记录，再重新冻结、恢复发布；旧图集保持停用，撤回仍可操作。</p>}
    {!ready && <p className="small muted">发布需有当前有效的权利核验、双专业意见及展示图确认。最终权限由服务端核对；工程演练不能批准真实候选。</p>}
    {administrator ? <>
      <label htmlFor={`${field}-reason`}>发布或撤回说明</label><input id={`${field}-reason`} value={owned ? reason : ''} maxLength={1000} disabled={blocked || busy || !!attempt.current} onChange={event => { setReason(event.target.value); setDisplayConfirmed(false); setPrivacyConfirmed(false); }} />
      <fieldset disabled={!writable || !ready} className="photo-publication-confirm"><legend>展示确认</legend>
        <label><input type="checkbox" checked={owned && replace} onChange={event => { setReplace(event.target.checked); setDisplayConfirmed(false); setPrivacyConfirmed(false); }} />仅保留此图，替换当前食材图集</label>
        <p className="small muted">{replace ? '发布后只展示当前图片。' : `保留其余已发布图片，加入或更新当前图片；本次共 ${selections.length} 张，最多 8 张。`}</p>
        <label><input type="checkbox" checked={owned && displayConfirmed} onChange={event => setDisplayConfirmed(event.target.checked)} />已核对展示图的方向、颜色、细节及说明</label>
        <label><input type="checkbox" checked={owned && privacyConfirmed} onChange={event => setPrivacyConfirmed(event.target.checked)} />已完成画面隐私检查，确认允许公开</label>
      </fieldset>
      <div className="note-actions"><button className="primary" disabled={!writable || !ready || !displayConfirmed || !privacyConfirmed || !reason.trim() || selections.length > 8} onClick={() => { void submit('publish'); }}>发布图片图集</button>
        <button className="secondary" disabled={!writable || !head || head.action === 'withdraw' || !reason.trim()} onClick={() => { void submit('withdraw'); }}>撤回图片图集</button></div>
      {phase === 'verify' && <button className="secondary" disabled={blocked || busy || !checkedAttempt || !historyReady} onClick={newOperation}>确认发起新的操作</button>}
    </> : <p className="notice">当前账号可查阅展示图，发布和撤回由管理员操作。</p>}
    {!blocked && records && <div className="photo-note-history" aria-label="图片发布历史">{records.items.map(item => <article key={item.version}>
      <h5>#{item.version} · {item.action === 'publish' ? '发布' : '撤回'} · {item.entries.length} 张</h5><p className="small muted">{item.actorName} · {timestamp(item.createdAt)}</p><p>{item.reason}</p>
      {item.entries.map(entry => <p className="small muted" key={entry.candidateId}>{entry.photo.caption} · 部位：{entry.photo.part} · 加工：{entry.photo.processing}</p>)}
    </article>)}</div>}
  </section>;
}
