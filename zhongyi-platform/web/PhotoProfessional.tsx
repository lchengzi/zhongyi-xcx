import { useEffect, useId, useRef, useState } from 'react';
import type { Account, SessionInfo } from '../shared/contracts';
import type { PrivatePhoto } from '../shared/private-photos';
import { parsePhotoProfessionalInput, type PhotoProfessionalDetail, type PhotoProfessionalInput } from '../shared/photo-professional';
import { matchesPhotoProfessionalAttempt, type PhotoProfessionalCredential } from '../shared/photo-professional-response';
import { reviewPhotoProfessional } from './photo-professional-api';
import { photoCredentialOf, readPhotoProfessionalDesk, type PhotoProfessionalDesk } from './photo-professional-desk';
import { problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

interface Fields {
  profession: PhotoProfessionalInput['profession'] | ''; decision: PhotoProfessionalInput['decision'] | '';
  identity: PhotoProfessionalInput['identity'] | ''; part: PhotoProfessionalInput['part'] | ''; processing: PhotoProfessionalInput['processing'] | '';
  evidenceReference: string; comment: string;
}
const empty = (): Fields => ({ profession: '', decision: '', identity: '', part: '', processing: '', evidenceReference: '', comment: '' });
const professionLabel = (value: PhotoProfessionalInput['profession']) => value === 'tcm_physician' ? '中医师' : '药师';
const decisionLabel = { approve: '通过', return: '退回', revoke: '撤销通过' };
const matchLabel = { matches: '匹配', uncertain: '尚不能确认', mismatch: '不匹配' };
const stateLabel: Record<PhotoProfessionalDetail['state'], string> = { pending: '待专业审校', recorded: '已记录意见，尚未满足真实双专业审校', changes_requested: '已退回',
  eligible_for_derivative_review: '可进入衍生图审核，尚未公开', revoked: '专业通过已撤销', stale: '依据或资格已失效，需重新审校' };
type Phase = 'loading' | 'idle' | 'saving' | 'checking' | 'verify' | 'error';
interface Lifetime { photo: PrivatePhoto; session: SessionInfo; live: boolean }
interface Operation { owner: Lifetime; controller: AbortController; kind: 'read' | 'write' }
interface Attempt { input: PhotoProfessionalInput; actor: Account; credential: PhotoProfessionalCredential; acknowledged: boolean }

export function PhotoProfessional({ photo, session, blocked, onActivity }: { photo: PrivatePhoto; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const fieldId = useId(), [owner, setOwner] = useState({ photo, session });
  const [desk, setDesk] = useState<PhotoProfessionalDesk | null>(null), [fields, setFields] = useState<Fields>(empty);
  const [confirmed, setConfirmed] = useState(false), [phase, setPhase] = useState<Phase>('loading'), [feedback, setFeedback] = useState('');
  const [needsNewConfirmation, setNeedsNewConfirmation] = useState(false);
  const life = useRef<Lifetime | null>(null), operation = useRef<Operation | null>(null), attempt = useRef<Attempt | null>(null);
  const owned = owner.photo === photo && owner.session === session, readOnly = session.user.role === 'editor';
  const busy = owned && (phase === 'saving' || phase === 'checking');
  const dirty = owned && (Object.values(fields).some(Boolean) || confirmed || phase === 'verify' || needsNewConfirmation);
  useActivity(dirty, busy, onActivity);
  useEffect(() => {
    const lifetime: Lifetime = { photo, session, live: true }; life.current = lifetime;
    setOwner({ photo, session }); setDesk(null); setFields(empty()); setConfirmed(false); setPhase('loading'); setFeedback(''); setNeedsNewConfirmation(false); attempt.current = null;
    const current: Operation = { owner: lifetime, controller: new AbortController(), kind: 'read' }; operation.current = current;
    if (blocked || document.hidden) { current.controller.abort(); operation.current = null; setPhase('error'); setFeedback('请在会话有效、页面可见时重新读取专业审校资料。'); }
    else void readPhotoProfessionalDesk(photo, session, current.controller.signal).then(value => {
      if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setDesk(value); setPhase('idle'); }
    }).catch(error => {
      if (lifetime.live && !current.controller.signal.aborted && operation.current === current) { setPhase('error'); setFeedback(problem(error)); }
    }).finally(() => { if (operation.current === current) operation.current = null; });
    const hidden = () => {
      if (!document.hidden || !lifetime.live || life.current !== lifetime) return;
      const currentOperation = operation.current, uncertain = currentOperation?.kind === 'write' || attempt.current !== null;
      currentOperation?.controller.abort(); operation.current = null; setConfirmed(false); setPhase(uncertain ? 'verify' : 'error');
      setFeedback(uncertain ? '页面已隐藏，结果尚未完成核对；输入已保留，请重新读取。' : '页面已隐藏，请重新读取专业审校资料。');
    };
    document.addEventListener('visibilitychange', hidden);
    return () => { lifetime.live = false; document.removeEventListener('visibilitychange', hidden); if (operation.current?.owner === lifetime) { operation.current.controller.abort(); operation.current = null; } };
  }, [photo, session]);
  useEffect(() => {
    if (!blocked) return;
    const current = operation.current, uncertain = current?.kind === 'write' || attempt.current !== null;
    current?.controller.abort(); operation.current = null; setConfirmed(false); setPhase(uncertain ? 'verify' : 'error'); setFeedback('会话正在核对，输入已保留；恢复后请重新读取。');
  }, [blocked]);
  const available = () => owned && !blocked && !document.hidden && life.current?.live && life.current.photo === photo && life.current.session === session && !operation.current;
  const current = owned ? desk : null, currentPhase = owned ? phase : 'loading', image = current?.image, detail = image?.detail;
  const submission = image?.rights.submissions.detail.history[0], note = image?.rights.submissions.notes.history[0], rights = image?.rights.detail.history[0], qualification = current?.qualifications[0];
  const ready = !!image && !!detail && !!submission && !!note && !!rights && ['recorded', 'rights_verified'].includes(image.rights.detail.state) && rights.decision === 'approve' && Date.parse(rights.validUntil) > Date.now()
    && submission.bindingDigest === detail.bindingDigest && note.bindingDigest === detail.bindingDigest && submission.noteVersion === note.version && submission.noteDigest === note.digest;
  // Visible history is a hint only. Server transactions enforce complete history.
  const contributed = !!image && [...image.rights.submissions.notes.history, ...image.rights.submissions.detail.history, ...image.rights.detail.history].some(item => item.actorId === session.user.id);
  const qualified = !!qualification && qualification.userId === session.user.id && qualification.status === 'verified' && qualification.verificationConfirmed && qualification.accountRevision === session.user.revision
    && Date.parse(qualification.validUntil) > Date.now() && qualification.profession === fields.profession;
  const prior = detail?.latestReviews.find(item => item.profession === fields.profession);
  const canRevoke = !!prior && !!detail && prior.decision === 'approve' && prior.bindingDigest === detail.bindingDigest && prior.submissionVersion === detail.submissionVersion && prior.submissionDigest === detail.submissionDigest
    && prior.noteVersion === detail.noteVersion && prior.noteDigest === detail.noteDigest && prior.rightsVersion === detail.rightsVersion && prior.rightsDigest === detail.rightsDigest && (session.user.role === 'admin' || prior.actorId === session.user.id);
  const locked = !current || readOnly || blocked || currentPhase !== 'idle' || !ready;
  const decisionAllowed = fields.decision === 'revoke' ? canRevoke : qualified && !contributed && (fields.decision !== 'approve' || [fields.identity, fields.part, fields.processing].every(value => value === 'matches'));
  function change<K extends keyof Fields>(name: K, value: Fields[K]) {
    if (!available() || locked) return; setFields(previous => ({ ...previous, [name]: value })); setConfirmed(false); setFeedback('');
  }
  function acceptRead(value: PhotoProfessionalDesk, normalSave = false) {
    setDesk(value); const pending = attempt.current;
    if (pending && [...value.image.detail.history, ...value.image.detail.latestReviews].some(item => matchesPhotoProfessionalAttempt(item, photo, pending.input, pending.actor, pending.credential))) {
      setFields(empty()); attempt.current = null; setNeedsNewConfirmation(false); setFeedback(normalSave ? '专业意见已保存，图片仍未公开。' : '已核对到本次专业意见，图片仍未公开。');
    } else {
      setNeedsNewConfirmation(!!pending);
      setFeedback(pending ? pending.acknowledged ? '已收到保存回执，但当前可见历史没有匹配项；输入已保留，请联系管理员核对，勿重复提交。'
        : '未找到本次意见的匹配记录，不能排除原请求稍后完成；输入保留，再次提交需单独确认。' : '专业审校资料已重新读取；输入保留，请核对后重新确认。');
    }
    setPhase('idle');
  }
  async function submit() {
    if (!available() || locked || !decisionAllowed || !detail?.submissionDigest || !detail.noteDigest || !detail.rightsDigest || !confirmed || !life.current) return;
    const credential = fields.decision === 'revoke' && prior ? { userId: prior.qualificationUserId, revision: prior.qualificationRevision, digest: prior.qualificationDigest, profession: prior.profession, evidenceKind: prior.evidenceKind }
      : qualification ? photoCredentialOf(qualification) : undefined;
    if (!credential) return;
    let input: PhotoProfessionalInput;
    try { input = parsePhotoProfessionalInput({ ...fields, bindingDigest: detail.bindingDigest, expectedVersion: detail.version, expectedSubmissionVersion: detail.submissionVersion, submissionDigest: detail.submissionDigest,
      expectedNoteVersion: detail.noteVersion, noteDigest: detail.noteDigest, expectedRightsVersion: detail.rightsVersion, rightsDigest: detail.rightsDigest,
      expectedQualificationRevision: credential.revision, qualificationDigest: credential.digest, verificationConfirmed: true }); }
    catch { setFeedback('请选择专业、决定及三项结论，完整填写依据和意见。'); return; }
    if (needsNewConfirmation && !window.confirm('这是一次新的手动审校。原请求可能仍在处理，重新读取不能撤销它；确定继续提交当前决定吗？')) return;
    if (!available()) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'write' };
    operation.current = currentOperation; attempt.current = { input: { ...input }, actor: { ...session.user }, credential: { ...credential }, acknowledged: false };
    setPhase('saving'); setFeedback('');
    try {
      await reviewPhotoProfessional(photo, input, credential, session, currentOperation.controller.signal);
      if (!currentOperation.owner.live || currentOperation.controller.signal.aborted || operation.current !== currentOperation) return;
      if (attempt.current) attempt.current.acknowledged = true;
      currentOperation.kind = 'read'; setConfirmed(false); setPhase('checking');
      const value = await readPhotoProfessionalDesk(photo, session, currentOperation.controller.signal, desk ?? undefined);
      if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) acceptRead(value, true);
    } catch (error) {
      if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) {
        setPhase('verify'); setConfirmed(false); setFeedback(`${attempt.current?.acknowledged ? '专业意见已保存，但当前资料暂未刷新。' : problem(error)} 输入已保留，请先重新读取核对。`);
      }
    } finally { if (operation.current === currentOperation) operation.current = null; }
  }
  async function reload() {
    if (!available() || !life.current) return;
    const currentOperation: Operation = { owner: life.current, controller: new AbortController(), kind: 'read' }; operation.current = currentOperation; setPhase('checking'); setConfirmed(false); setFeedback('');
    try {
      const value = await readPhotoProfessionalDesk(photo, session, currentOperation.controller.signal, desk ?? undefined);
      if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) acceptRead(value);
    } catch (error) { if (currentOperation.owner.live && !currentOperation.controller.signal.aborted && operation.current === currentOperation) { setPhase('error'); setFeedback(problem(error)); } }
    finally { if (operation.current === currentOperation) operation.current = null; }
  }
  function clear() {
    if (!available() || !dirty || currentPhase !== 'idle' || !window.confirm('清空输入不会撤销已保存记录，也不能取消尚在处理的请求。继续吗？') || !available()) return;
    setFields(empty()); setConfirmed(false); attempt.current = null; setNeedsNewConfirmation(false); setFeedback('输入已清空，专业审校历史不变。');
  }
  return <section className="photo-professional" aria-label="图片专业审校" aria-busy={busy}>
    <div className="panel-heading"><h4>专业审校</h4><button className="secondary" onClick={() => { void reload(); }} disabled={blocked || busy || currentPhase === 'loading'}>重新读取专业资料</button></div>
    <p className="small muted">中医师和药师分别核对身份、部位与加工形态。资格由其他管理员登记，工程演练不能替代真人审校；专业通过后仍须另审公开衍生图。</p>
    {currentPhase === 'loading' && <p role="status">正在读取专业审校资料…</p>}
    {owned && feedback && <p className={['verify', 'error'].includes(phase) ? 'notice error' : 'notice'} role={['verify', 'error'].includes(phase) ? 'alert' : 'status'} aria-label="图片专业反馈">{feedback}</p>}
    {!blocked && current && currentPhase === 'idle' && <>
      <p className="small muted" aria-label="图片专业状态">{stateLabel[current.image.detail.state]} · 专业版本 {current.image.detail.version} · 送审 #{current.image.detail.submissionVersion} · 权利 #{current.image.detail.rightsVersion} · 未公开</p>
      {!ready ? <p className="notice">请先完成当前原图的核对、送审及有效权利审核，再进行专业审校。</p> : <details className="photo-submission-basis"><summary>固定审校依据 · 送审 #{submission.version}</summary>
        <p className="preserve-lines">{submission.caption}</p><p className="preserve-lines">部位：{submission.partDescription} · 加工：{submission.processingDescription}</p>
        <p className="preserve-lines">送审依据：{submission.evidenceReference}</p><p className="preserve-lines">核对意见 #{note.version} · {note.actorName}：{note.text}</p>
        <p className="preserve-lines">权利依据 #{rights.version} · {rights.actorName}：{rights.evidenceReference}</p>
        <p className="publication-digest small">原图：{photo.sha256}</p><p className="publication-digest small">送审：{submission.digest}</p><p className="publication-digest small">权利：{rights.digest}</p>
      </details>}
      {!readOnly && <p className="notice" aria-label="本账号专业资格">{qualification ? `${professionLabel(qualification.profession)} · 资格修订 ${qualification.revision} · ${qualification.status === 'verified' && qualification.accountRevision === session.user.revision && Date.parse(qualification.validUntil) > Date.now() ? '当前记录有效' : '已撤销、过期或账号版本已变化'} · ${qualification.evidenceKind === 'test-fixture' ? '工程演练' : '人工核验记录'}` : '本账号尚无资格核验记录，不能通过或退回；管理员符合条件时仍可撤销已有通过。'}</p>}
      <div className="photo-professional-latest" aria-label="各专业最近意见">{current.image.detail.latestReviews.map(item => <p key={item.profession} className="small muted">{professionLabel(item.profession)} · #{item.version} · {item.actorName} · {decisionLabel[item.decision]}{item.evidenceKind === 'test-fixture' ? ' · 工程演练' : ''}</p>)}</div>
    </>}
    {readOnly ? <p className="notice">当前账号仅查阅专业意见，不能登记专业结论。</p> : <>
      {contributed && <p className="notice">当前账号参与过核对、送审或权利审核，不能通过或退回。服务器会检查完整贡献历史；原审校人或管理员可按条件撤销。</p>}
      <fieldset disabled={locked} className="photo-note-fields photo-submission-fields"><legend>新专业意见</legend>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-profession`}>审校专业</label><select id={`${fieldId}-profession`} value={owned ? fields.profession : ''} onChange={event => { const v = event.target.value; if (v === '' || v === 'tcm_physician' || v === 'pharmacist') change('profession', v); }}><option value="">选择专业</option><option value="tcm_physician">中医师</option><option value="pharmacist">药师</option></select></div>
        <div className="photo-note-field"><label htmlFor={`${fieldId}-decision`}>专业决定</label><select id={`${fieldId}-decision`} value={owned ? fields.decision : ''} onChange={event => { const v = event.target.value; if (v === '' || v === 'approve' || v === 'return' || v === 'revoke') change('decision', v); }}><option value="">选择决定</option><option value="approve" disabled={!qualified || contributed}>通过</option><option value="return" disabled={!qualified || contributed}>退回</option><option value="revoke" disabled={!canRevoke}>撤销通过</option></select></div>
        {(['identity', 'part', 'processing'] as const).map((name, index) => <div className="photo-note-field" key={name}><label htmlFor={`${fieldId}-${name}`}>{['身份结论', '部位结论', '加工结论'][index]}</label><select id={`${fieldId}-${name}`} value={owned ? fields[name] : ''} onChange={event => { const v = event.target.value; if (v === '' || v === 'matches' || v === 'uncertain' || v === 'mismatch') change(name, v); }}><option value="">逐项选择结论</option><option value="matches">匹配</option><option value="uncertain">尚不能确认</option><option value="mismatch">不匹配</option></select></div>)}
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-evidence`}>专业依据与定位</label><textarea id={`${fieldId}-evidence`} value={owned ? fields.evidenceReference : ''} maxLength={500} onChange={event => change('evidenceReference', event.target.value)} /></div>
        <div className="photo-note-field submission-wide"><label htmlFor={`${fieldId}-comment`}>专业意见</label><textarea id={`${fieldId}-comment`} value={owned ? fields.comment : ''} maxLength={1200} onChange={event => change('comment', event.target.value)} /></div>
        <label className="photo-submission-confirm submission-wide" htmlFor={`${fieldId}-confirmed`}><input id={`${fieldId}-confirmed`} type="checkbox" checked={owned && confirmed} onChange={event => { if (available() && !locked) setConfirmed(event.target.checked); }} />已逐项核对当前原图、固定送审与权利版本，确认以本人资格登记上述专业意见。</label>
      </fieldset>
      <div className="note-actions"><button className="primary" disabled={locked || !decisionAllowed || !confirmed || Object.values(fields).some(value => !value.trim())} onClick={() => { void submit(); }}>{phase === 'saving' ? '保存中…' : '保存专业意见'}</button><button className="text-button" disabled={blocked || busy || currentPhase !== 'idle' || !dirty} onClick={clear}>清空专业输入</button></div>
    </>}
    {!blocked && current && currentPhase === 'idle' && <div className="photo-note-history" aria-label="图片专业历史">
      {!current.image.detail.history.length ? <p className="empty">尚无专业意见。</p> : current.image.detail.history.map(item => <article key={item.version}>
        <h5>专业 #{item.version} · {professionLabel(item.profession)} · {decisionLabel[item.decision]}</h5><p className="small muted">{item.actorName} · {timestamp(item.createdAt)} · 送审 #{item.submissionVersion} · 权利 #{item.rightsVersion} · 资格修订 {item.qualificationRevision}</p>
        <p className="small muted">{item.evidenceKind === 'test-fixture' ? '工程演练，不构成真实专业批准' : '人工核验意见'} · 身份：{matchLabel[item.identity]} · 部位：{matchLabel[item.part]} · 加工：{matchLabel[item.processing]}</p>
        <p className="preserve-lines">依据：{item.evidenceReference}</p><p className="preserve-lines">意见：{item.comment}</p>
        <details><summary>专业版本凭据</summary><p className="publication-digest small">原图与来源：{item.bindingDigest}</p><p className="publication-digest small">送审：{item.submissionDigest}</p><p className="publication-digest small">权利：{item.rightsDigest}</p><p className="publication-digest small">资格：{item.qualificationDigest}</p><p className="publication-digest small">专业意见：{item.digest}</p></details>
      </article>)}
    </div>}
  </section>;
}
