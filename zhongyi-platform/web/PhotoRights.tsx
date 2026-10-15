import { useEffect, useId, useRef, useState } from 'react';
import type { Account, SessionInfo } from '../shared/contracts';
import type { PrivatePhoto } from '../shared/private-photos';
import { parsePhotoRightsInput, type PhotoRightsDetail, type PhotoRightsInput } from '../shared/photo-rights';
import { matchesPhotoRightsAttempt } from '../shared/photo-rights-response';
import { readPhotoRights, reviewPhotoRights, type PhotoRightsWorkspace } from './photo-rights-api';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

interface Fields {
  decision: PhotoRightsInput['decision'] | ''; evidenceKind: PhotoRightsInput['evidenceKind'] | '';
  evidenceReference: string; attributionPlan: string; alterationPlan: string; validUntil: string; comment: string;
}
const empty = (): Fields => ({ decision: '', evidenceKind: '', evidenceReference: '', attributionPlan: '', alterationPlan: '', validUntil: '', comment: '' });
const stateLabel: Record<PhotoRightsDetail['state'], string> = { pending: '待审核', changes_requested: '已退回', recorded: '工程演练记录', rights_verified: '权利核对已记录', revoked: '已撤销', stale: '审核依据已失效，需重新核对' };
const decisionLabel: Record<PhotoRightsInput['decision'], string> = { approve: '批准', return: '退回', revoke: '撤销批准' };
type Phase = 'loading' | 'idle' | 'saving' | 'checking' | 'verify' | 'error';
interface Lifetime { photo: PrivatePhoto; session: SessionInfo; live: boolean }
interface Operation { owner: Lifetime; controller: AbortController; kind: 'read' | 'write' }

export function PhotoRights({ photo, session, blocked, onActivity }: { photo: PrivatePhoto; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const fieldId = useId(), [owner, setOwner] = useState({ photo, session });
  const [workspace, setWorkspace] = useState<PhotoRightsWorkspace | null>(null), [fields, setFields] = useState<Fields>(empty);
  const [confirmed, setConfirmed] = useState(false), [phase, setPhase] = useState<Phase>('loading'), [feedback, setFeedback] = useState('');
  const [needsNewConfirmation, setNeedsNewConfirmation] = useState(false);
  const life = useRef<Lifetime | null>(null), operation = useRef<Operation | null>(null);
  const attempt = useRef<{ input: PhotoRightsInput; actor: Account } | null>(null);
  const owned = owner.photo === photo && owner.session === session;
  const busy = owned && (phase === 'saving' || phase === 'checking');
  const dirty = owned && (Object.values(fields).some(Boolean) || confirmed || phase === 'verify' || needsNewConfirmation);
  const readOnly = session.user.role !== 'admin' && session.user.role !== 'reviewer';
  useActivity(dirty, busy, onActivity);

  useEffect(() => {
    const lifetime: Lifetime = { photo, session, live: true }; life.current = lifetime;
    setOwner({ photo, session }); setWorkspace(null); setFields(empty()); setConfirmed(false); setPhase('loading'); setFeedback(''); setNeedsNewConfirmation(false); attempt.current = null;
    const current: Operation = { owner: lifetime, controller: new AbortController(), kind: 'read' }; operation.current = current;
    if (blocked || document.hidden) {
      current.controller.abort(); operation.current = null; setPhase('error'); setFeedback('请在会话有效、页面可见时重新读取审核资料。');
    } else {
      void readPhotoRights(photo, session, current.controller.signal).then(value => {
        if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setWorkspace(value); setPhase('idle'); }
      }).catch(error => {
        if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setPhase('error'); setFeedback(problem(error)); }
      }).finally(() => { if (operation.current === current) operation.current = null; });
    }
    const hidden = () => {
      if (!document.hidden || !lifetime.live || life.current !== lifetime) return;
      const currentOperation = operation.current, uncertain = currentOperation?.kind === 'write' || attempt.current !== null;
      currentOperation?.controller.abort(); operation.current = null; setConfirmed(false); setPhase(uncertain ? 'verify' : 'error');
      setFeedback(uncertain ? '页面已隐藏，审核结果尚不能确认；输入已保留，请重新读取核对。' : '页面已隐藏，请重新读取审核资料后再操作。');
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
    setFeedback(uncertain ? '会话正在核对，审核结果尚不能确认；输入已保留。' : '会话正在核对，请稍后重新读取审核资料。');
  }, [blocked]);
  const available = () => owned && !blocked && !document.hidden && life.current?.live && life.current.photo === photo && life.current.session === session && !operation.current;
  const current = owned ? workspace : null, currentPhase = owned ? phase : 'loading';
  const submission = current?.submissions.detail.history[0], note = current?.submissions.notes.history[0], latest = current?.detail.history[0];
  const ready = !!current && !!submission && !!note && submission.bindingDigest === current.detail.bindingDigest && note.bindingDigest === current.detail.bindingDigest && submission.noteVersion === note.version && submission.noteDigest === note.digest;
  // The visible window is only a UI hint. The server checks ALL past contributors.
  const contributed = !!current && (current.submissions.detail.history.some(item => item.actorId === session.user.id) || current.submissions.notes.history.some(item => item.actorId === session.user.id));
  const canRevoke = !!latest && !!submission && latest.decision === 'approve' && latest.submissionVersion === submission.version && latest.submissionDigest === submission.digest && (session.user.role === 'admin' || latest.actorId === session.user.id);
  const locked = !current || readOnly || blocked || currentPhase !== 'idle' || !ready;
  const decisionAllowed = fields.decision === 'revoke' ? canRevoke : !contributed;
  function change<K extends keyof Fields>(name: K, value: Fields[K]) {
    if (!available() || locked) return;
    setFields(previous => ({ ...previous, [name]: value })); setConfirmed(false); setFeedback('');
  }
  async function submit() {
    if (!available() || locked || !decisionAllowed || !workspace?.detail.submissionDigest || !workspace.detail.noteDigest || !confirmed) return;
    let input: PhotoRightsInput;
    try {
      input = parsePhotoRightsInput({ ...fields, validUntil: new Date(fields.validUntil).toISOString(), bindingDigest: workspace.detail.bindingDigest,
        expectedVersion: workspace.detail.version, expectedSubmissionVersion: workspace.detail.submissionVersion, submissionDigest: workspace.detail.submissionDigest,
        expectedNoteVersion: workspace.detail.noteVersion, noteDigest: workspace.detail.noteDigest, verificationConfirmed: true });
      if (input.decision === 'approve' && (Date.parse(input.validUntil) <= Date.now() || Date.parse(input.validUntil) > Date.now() + 366 * 86400000)) throw new Error('expiry');
    } catch { setFeedback('请完整填写审核决定、依据、署名与修改方案、意见和时间。批准有效期须晚于当前时间且不超过366天。'); return; }
    if (needsNewConfirmation && !window.confirm('这是一次新的手动审核。先前请求可能仍在处理，重新读取不能撤销它；继续提交当前决定吗？')) return;
    if (!available() || !life.current) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'write' };
    operation.current = currentOperation; attempt.current = { input: { ...input }, actor: { ...session.user } }; setPhase('saving'); setFeedback('');
    try {
      const saved = await reviewPhotoRights(photo, input, session, currentOperation.controller.signal);
      if (!currentOperation.owner.live || currentOperation.controller.signal.aborted || operation.current !== currentOperation) return;
      const state: PhotoRightsDetail['state'] = saved.decision === 'return' ? 'changes_requested' : saved.decision === 'revoke' ? 'revoked' : saved.evidenceKind === 'test-fixture' ? 'recorded' : 'rights_verified';
      setWorkspace({ ...workspace, detail: { ...workspace.detail, version: saved.version, history: [saved, ...workspace.detail.history].slice(0, 50), state } });
      setFields(empty()); setConfirmed(false); attempt.current = null; setNeedsNewConfirmation(false); setPhase('idle'); setFeedback('审核记录已保存，图片仍未公开。');
    } catch (error) {
      if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) { setPhase('verify'); setConfirmed(false); setFeedback(`${problem(error)} 输入已保留，请先重新读取审核资料。`); }
    } finally { if (operation.current === currentOperation) operation.current = null; }
  }
  async function reload() {
    if (!available() || !life.current) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'read' };
    operation.current = currentOperation; setPhase('checking'); setFeedback(''); setConfirmed(false);
    try {
      const value = await readPhotoRights(photo, session, currentOperation.controller.signal, workspace ?? undefined);
      if (!currentOperation.owner.live || currentOperation.controller.signal.aborted || operation.current !== currentOperation) return;
      setWorkspace(value);
      const pending = attempt.current;
      if (pending && value.detail.history.some(item => matchesPhotoRightsAttempt(item, photo, pending.input, pending.actor))) {
        setFields(empty()); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('已核对到本次审核记录，图片仍未公开。');
      } else {
        setNeedsNewConfirmation(!!pending);
        setFeedback(pending ? '未找到本次审核的匹配记录，不能排除原请求稍后完成；输入已保留，再次提交前需单独确认。' : '审核资料已重新读取，输入保留；请核对当前依据后重新确认。');
      }
      setPhase('idle');
    } catch (error) { if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) { setPhase('error'); setFeedback(problem(error)); } }
    finally { if (operation.current === currentOperation) operation.current = null; }
  }
  function clear() {
    if (!available() || !dirty || currentPhase !== 'idle' || !window.confirm('清空输入不会撤销已保存记录，也不能取消尚在处理的请求。继续吗？') || !available()) return;
    setFields(empty()); setConfirmed(false); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('输入已清空，审核历史不变。');
  }
  return <section className="photo-rights" aria-label="图片权利审核" aria-busy={busy}>
    <div className="panel-heading"><h4>权利审核</h4><button className="secondary" onClick={() => { void reload(); }} disabled={blocked || busy || currentPhase === 'loading'}>重新读取审核资料</button></div>
    <p className="small muted">核对当前送审版本的使用依据、署名与修改方案。专业审校和公开衍生图另行审核。</p>
    {currentPhase === 'loading' && <p role="status">正在读取审核资料…</p>}
    {owned && feedback && <p className={['verify', 'error'].includes(phase) ? 'notice error' : 'notice'} role={['verify', 'error'].includes(phase) ? 'alert' : 'status'} aria-label="图片权利反馈">{feedback}</p>}
    {!blocked && current && currentPhase === 'idle' && <>
      <p className="small muted" aria-label="图片权利状态">{stateLabel[current.detail.state]} · 审核版本 {current.detail.version} · 送审版本 {current.detail.submissionVersion} · 核对修订 {current.detail.noteVersion} · 未公开</p>
      {!ready ? <p className="notice">请先补充当前原图与来源版本的核对意见及送审资料。</p> : <details className="photo-submission-basis" open><summary>本次审核依据 · 送审 #{submission.version}</summary>
        <p className="small muted">{submission.actorName} · {timestamp(submission.createdAt)}</p><p className="preserve-lines">{submission.caption}</p>
        <p className="preserve-lines">部位：{submission.partDescription} · 加工：{submission.processingDescription}</p><p className="preserve-lines">送审依据：{submission.evidenceReference}</p>
        <p className="preserve-lines">核对意见 #{note.version} · {note.actorName}：{note.text}</p><p className="preserve-lines">核对依据：{note.evidenceReference}</p>
        <p className="publication-digest small">送审：{submission.digest}</p><p className="publication-digest small">原图：{photo.sha256}</p>
      </details>}
    </>}
    {readOnly ? <p className="notice">当前账号可查阅审核资料，审核决定由独立审核人或管理员登记。</p> : <>
      {contributed && <p className="notice">当前账号参与过该图片的核对或送审，不能批准或退回。服务器还会核验完整历史；符合权限时可撤销已有批准。</p>}
      <fieldset disabled={locked} className="photo-note-fields photo-submission-fields"><legend>新审核记录</legend>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-decision`}>审核决定</label><select id={`${fieldId}-decision`} value={owned ? fields.decision : ''} onChange={event => { const value = event.target.value; if (value === '' || value === 'approve' || value === 'return' || value === 'revoke') change('decision', value); }}>
          <option value="">选择决定</option><option value="approve" disabled={contributed}>批准</option><option value="return" disabled={contributed}>退回</option><option value="revoke" disabled={!canRevoke}>撤销批准</option>
        </select></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-kind`}>依据类别</label><select id={`${fieldId}-kind`} value={owned ? fields.evidenceKind : ''} onChange={event => { const value = event.target.value; if (value === '' || value === 'manual-verification' || value === 'test-fixture') change('evidenceKind', value); }}>
          <option value="">选择依据类别</option><option value="manual-verification">实际人工核验</option><option value="test-fixture">工程演练（不构成真实批准）</option>
        </select></div>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-evidence`}>权利依据与定位</label><textarea id={`${fieldId}-evidence`} value={owned ? fields.evidenceReference : ''} maxLength={400} onChange={event => change('evidenceReference', event.target.value)} /></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-attribution`}>署名方案</label><textarea id={`${fieldId}-attribution`} value={owned ? fields.attributionPlan : ''} maxLength={500} onChange={event => change('attributionPlan', event.target.value)} /></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-alteration`}>修改与脱敏方案</label><textarea id={`${fieldId}-alteration`} value={owned ? fields.alterationPlan : ''} maxLength={500} onChange={event => change('alterationPlan', event.target.value)} /></div>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-expiry`}>依据有效期或复核时间（本机时区）</label><input id={`${fieldId}-expiry`} type="datetime-local" value={owned ? fields.validUntil : ''} onChange={event => change('validUntil', event.target.value)} /><p className="small muted">批准须填写未来366天内的有效期；退回与撤销填写本次记录的复核时间。</p></div>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-comment`}>审核意见</label><textarea id={`${fieldId}-comment`} value={owned ? fields.comment : ''} maxLength={1200} onChange={event => change('comment', event.target.value)} /></div>
        <label className="photo-submission-confirm submission-wide" htmlFor={`${fieldId}-confirmed`}><input id={`${fieldId}-confirmed`} type="checkbox" checked={owned && confirmed} onChange={event => { if (available() && !locked) setConfirmed(event.target.checked); }} />已核对当前送审版本、权利依据、署名与修改方案，确认登记上述决定。</label>
      </fieldset>
      <div className="note-actions"><button className="primary" disabled={locked || !decisionAllowed || !confirmed || Object.values(fields).some(value => !value.trim())} onClick={() => { void submit(); }}>{phase === 'saving' ? '保存中…' : '保存审核记录'}</button><button className="text-button" onClick={clear} disabled={blocked || busy || currentPhase !== 'idle' || !dirty}>清空审核输入</button></div>
    </>}
    {!blocked && current && currentPhase === 'idle' && <div className="photo-note-history" aria-label="图片权利历史">
      {!current.detail.history.length ? <p className="empty">尚无审核记录。</p> : current.detail.history.map(item => <article key={item.version}>
        <h5>审核 #{item.version} · {decisionLabel[item.decision]}</h5><p className="small muted">{item.actorName} · {timestamp(item.createdAt)} · 送审 #{item.submissionVersion}</p>
        <p className="small muted">{item.evidenceKind === 'test-fixture' ? '工程演练，不构成真实权利批准' : '人工核验记录'} · 有效期/复核时间：{timestamp(item.validUntil)}</p>
        <p className="preserve-lines">依据：{item.evidenceReference}</p><p className="preserve-lines">署名：{item.attributionPlan}</p><p className="preserve-lines">修改与脱敏：{item.alterationPlan}</p><p className="preserve-lines">意见：{item.comment}</p>
        <p className="small muted">{item.bindingDigest === current.detail.bindingDigest && item.submissionDigest === current.detail.submissionDigest ? '对应已读原图与送审版本' : '历史原图、来源或送审版本'}</p>
        <details><summary>版本凭据</summary><p className="publication-digest small">原图与来源绑定：{item.bindingDigest}</p><p className="publication-digest small">送审：{item.submissionDigest}</p><p className="publication-digest small">审核：{item.digest}</p></details>
      </article>)}
    </div>}
  </section>;
}
