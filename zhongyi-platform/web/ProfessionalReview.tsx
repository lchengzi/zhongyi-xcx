import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Account, ProfessionalDecisionInput, ProfessionalDetail, ProfessionalKind, ProfessionalQualification, QualificationInput, SessionInfo } from '../shared/contracts';
import { parseAccountList } from '../shared/account-response';
import { parseIngredientPage } from '../shared/workflow-response';
import { parseProfessionalDecision, parseProfessionalDetail, parseQualificationHistory, parseSavedQualification } from '../shared/professional-response';
import { requestDecoded, requiresWriteVerification } from './api';
import { useDecodedReadResult } from './useReadResult';
import { FixedSourceReferences } from './FixedSourceReferences';
import { hasFixedSourceReferences } from './fixed-source-references';
import { confirmLeave, problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

const professionLabel = (value: ProfessionalKind) => value === 'tcm_physician' ? '中医师' : '药师';
const blankQualification: QualificationInput = { profession: 'tcm_physician', status: 'verified', evidenceKind: 'manual-verification', evidenceReference: '', validUntil: '', comment: '', verificationConfirmed: false };
const ingredientPicker = (value: unknown) => parseIngredientPage(value, { page: 1, pageSize: 5 });
function QualificationManager({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const admin = session.user.role === 'admin';
  const [users, setUsers] = useState<Account[]>(admin ? [] : [session.user]); const [target, setTarget] = useState(admin ? '' : session.user.id);
  const [history, setHistory] = useState<ProfessionalQualification[]>([]); const [input, setInput] = useState<QualificationInput>(blankQualification); const [baseline, setBaseline] = useState<QualificationInput>(blankQualification);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const accounts = useDecodedReadResult(admin ? '/users' : null, session, parseAccountList, retry, 0);
  const writeGuard = useRef<'idle' | 'writing' | 'verify'>('idle'); const [verificationRequired, setVerificationRequired] = useState(false);
  const writeController = useRef<AbortController | null>(null);
  const [readOwner, setReadOwner] = useState<{ target: string; session: SessionInfo; accounts: typeof accounts.data; retry: number } | null>(null);
  const qualificationRetry = admin ? 0 : retry;
  const readCurrent = readOwner?.target === target && readOwner.session === session && readOwner.accounts === accounts.data && readOwner.retry === qualificationRetry;
  const pending = busy || loading || accounts.loading;
  const unavailable = error || accounts.error;
  const dirty = JSON.stringify(input) !== JSON.stringify(baseline) || verificationRequired; useActivity(dirty, pending, onActivity);
  useEffect(() => { setBusy(false); return () => writeController.current?.abort(); }, [session]);
  function chooseTarget(id: string) {
    setTarget(id); setReadOwner(null); setHistory([]); setInput(blankQualification); setBaseline(blankQualification); setFeedback('');
  }
  useEffect(() => {
    if (!admin) { setUsers([session.user]); if (target !== session.user.id) chooseTarget(session.user.id); return; }
    if (!accounts.data) return;
    const candidates = accounts.data.items.filter((item) => item.id !== session.user.id && ['admin', 'reviewer'].includes(item.role));
    setUsers(candidates); const next = candidates.some(item => item.id === target) ? target : candidates[0]?.id || '';
    if (next !== target) chooseTarget(next);
  }, [admin, accounts.data, session, target]);
  useEffect(() => {
    if (admin && (accounts.loading || accounts.error || !accounts.data)) { setLoading(false); setError(''); return; }
    if (!target) { setLoading(false); setHistory([]); return; } const controller = new AbortController(); setLoading(true); setError(''); setHistory([]);
    requestDecoded(`/editorial/qualifications/${target}`, session, value => parseQualificationHistory(value, target), { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      const current = value.items[0]; const starting: QualificationInput = current ? { profession: current.profession, status: 'verified', evidenceKind: current.evidenceKind, evidenceReference: current.evidenceReference, validUntil: current.validUntil, comment: '', verificationConfirmed: false } : blankQualification;
      setHistory(value.items); setInput(starting); setBaseline(starting);
      setReadOwner({ target, session, accounts: accounts.data, retry: qualificationRetry }); writeGuard.current = 'idle'; setVerificationRequired(false);
    }).catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target, session, qualificationRetry, admin, accounts.data, accounts.error, accounts.loading]);
  function reload() { if (confirmLeave({ dirty, busy: pending })) { setFeedback(''); setRetry((value) => value + 1); } }
  async function save(event: FormEvent) {
    event.preventDefault(); const person = users.find(item => item.id === target);
    if (!admin || !person || pending || unavailable || !readCurrent || writeGuard.current !== 'idle') return;
    writeGuard.current = 'writing'; const controller = new AbortController(); writeController.current = controller; setBusy(true); setFeedback('');
    try {
      const previousRevision = history[0]?.revision || 0;
      const item = await requestDecoded(`/editorial/qualifications/${target}`, session, value => parseSavedQualification(value, person, previousRevision, input, session), { method: 'POST', signal: controller.signal, body: JSON.stringify({ qualification: input, expectedRevision: previousRevision }) });
      if (controller.signal.aborted) return;
      const cleared = { ...input, comment: '', verificationConfirmed: false };
      setHistory([item, ...history].slice(0, 20)); setInput(cleared); setBaseline(cleared); setFeedback(item.evidenceKind === 'test-fixture' ? '已保存工程测试资格；不能用于真实专业审校或发布。' : '已记录人工核验意见；平台没有自动核验执业证，也没有发布内容。');
    } catch (reason) { if (!controller.signal.aborted) { if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); } setFeedback(problem(reason)); } }
    finally { if (!controller.signal.aborted) { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); } }
  }
  return <section className="panel workflow-panel professional-panel"><div className="workflow-toolbar"><h2>{admin ? '专业资格核验记录' : '我的资格记录'}</h2><button className="secondary" onClick={reload} disabled={pending}>刷新资格记录</button></div>
    <p className="notice">后台角色不等于专业资格。管理员须在线下核验身份、执业范围及证据后登记；只填内部依据编号，不输入身份证、证件原图或个人健康资料。每个账号当前使用一类资格，两类审校须由不同人员完成。</p>
    {admin && accounts.data && <label>资格所属账号<select aria-label="资格所属账号" value={target} disabled={pending} onChange={(event) => { if (event.target.value !== target && confirmLeave({ dirty, busy: pending })) chooseTarget(event.target.value); }}>{users.map((item) => <option key={item.id} value={item.id}>{item.username}{item.active ? '' : '（已停用）'}</option>)}</select></label>}
    {admin && accounts.data && !target && !pending && !unavailable && <p className="muted">尚无其他审阅或管理员账号，请先到账号权限创建。</p>}
    {unavailable && <p className="notice error" role="alert">资格或账号资料暂不可用，不能确认当前资格；不代表没有记录。{unavailable}</p>}{(loading || accounts.loading) && <p role="status">正在读取资格记录…</p>}
    {admin && target && (!readOwner || readOwner.session.user.id === session.user.id) && <form className="workflow-form" onSubmit={save}><fieldset disabled={pending || !!unavailable || !readCurrent || verificationRequired} className="workflow-fields professional-fields">
      <label>专业类别<select aria-label="专业类别" value={input.profession} onChange={(e) => setInput({ ...input, profession: e.target.value as ProfessionalKind })}><option value="tcm_physician">中医师</option><option value="pharmacist">药师</option></select></label>
      <label>资格状态<select aria-label="资格状态" value={input.status} onChange={(e) => setInput({ ...input, status: e.target.value as QualificationInput['status'] })}><option value="verified">记录已人工核验</option><option value="revoked">撤销资格记录</option></select></label>
      <label>依据类型<select aria-label="资格依据类型" value={input.evidenceKind} onChange={(e) => setInput({ ...input, evidenceKind: e.target.value as QualificationInput['evidenceKind'] })}><option value="manual-verification">人工核验（需真实外部依据）</option><option value="test-fixture">工程测试（不能用于发布）</option></select></label>
      <label>内部核验依据编号<input aria-label="内部核验依据编号" value={input.evidenceReference} maxLength={200} required onChange={(e) => setInput({ ...input, evidenceReference: e.target.value })} /></label>
      <label>核验有效截止时间（UTC）<input aria-label="核验有效截止时间UTC" type="datetime-local" required value={input.validUntil.slice(0, 16)} onChange={(e) => setInput({ ...input, validUntil: e.target.value ? `${e.target.value}:00.000Z` : '' })} /></label>
      <label>核验或撤销说明<textarea aria-label="资格核验说明" value={input.comment} maxLength={1000} required onChange={(e) => setInput({ ...input, comment: e.target.value })} /></label>
      <label className="assistant-check"><input aria-label="确认已核对资格依据" type="checkbox" checked={input.verificationConfirmed} onChange={(e) => setInput({ ...input, verificationConfirmed: e.target.checked })} />我确认已核对对应依据；选择工程测试不构成真实资格确认。</label>
      <button className="primary" disabled={!dirty || (input.status === 'verified' && !input.verificationConfirmed)}>保存资格记录</button></fieldset></form>}
    {feedback && <p className="notice" role="status" aria-label="资格保存结果">{feedback}</p>}
    {target && readCurrent && !pending && !unavailable && !verificationRequired && <div className="workflow-history"><h3>最近资格版本</h3>{history.map((item) => <article key={item.revision}><strong>修订 {item.revision} · {professionLabel(item.profession)} · {item.status === 'verified' ? '已记录核验' : '已撤销'}</strong><p>{item.evidenceKind === 'test-fixture' ? '工程测试 · 非真实资格' : '人工核验记录（非系统认证）'} · {item.evidenceReference}</p><p>{item.comment}</p><small>{item.recordedBy} · {timestamp(item.recordedAt)} · 截止 {timestamp(item.validUntil)}</small></article>)}{!history.length && <p className="muted">尚无核验记录，不能作专业通过决定。</p>}</div>}
  </section>;
}

function ProfessionalDesk({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(''); const [selectedName, setSelectedName] = useState(''); const [detail, setDetail] = useState<ProfessionalDetail | null>(null);
  const [qualification, setQualification] = useState<ProfessionalQualification | undefined>(); const [profession, setProfession] = useState<ProfessionalKind>('tcm_physician'); const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [detailRetry, setDetailRetry] = useState(0);
  const writeGuard = useRef<'idle' | 'writing' | 'verify'>('idle'); const [verificationRequired, setVerificationRequired] = useState(false);
  const writeController = useRef<AbortController | null>(null);
  const [readOwner, setReadOwner] = useState<{ selected: string; session: SessionInfo; retry: number } | null>(null);
  const readCurrent = readOwner?.selected === selected && readOwner.session === session && readOwner.retry === detailRetry;
  // The fixed-record refresh and the searchable picker have separate lifetimes.
  // A failed detail read must not disturb an already loaded list or its error.
  const items = useDecodedReadResult(`/ingredients?q=${encodeURIComponent(query.trim())}&pageSize=5`, session, ingredientPicker);
  useActivity(!!comment.trim() || verificationRequired, busy || loading, onActivity);
  useEffect(() => { setBusy(false); return () => writeController.current?.abort(); }, [session]);
  useEffect(() => {
    if (!selected) return; const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([requestDecoded(`/editorial/professional/${selected}`, session, value => parseProfessionalDetail(value, selected), { signal: controller.signal }), requestDecoded(`/editorial/qualifications/${session.user.id}`, session, value => parseQualificationHistory(value, session.user.id), { signal: controller.signal })])
      .then(([value, credentials]) => { if (!controller.signal.aborted) { setDetail(value); setQualification(credentials.items[0]); setProfession(credentials.items[0]?.profession || 'tcm_physician'); setComment('');
        setReadOwner({ selected, session, retry: detailRetry }); writeGuard.current = 'idle'; setVerificationRequired(false); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, session, detailRetry]);
  function reload() { if (confirmLeave({ dirty: !!comment.trim() || verificationRequired, busy: busy || loading })) { setFeedback(''); setDetailRetry((value) => value + 1); } }
  async function decide(decision: 'approve' | 'return' | 'revoke') {
    if (!detail?.draft || !readCurrent || busy || loading || error || !comment.trim() || writeGuard.current !== 'idle') return;
    if (decision === 'approve' && !hasFixedSourceReferences(detail.draft)) return;
    const prior = detail.latestReviews.find((item) => item.profession === profession);
    const revision = decision === 'revoke' ? prior?.contentRevision : detail.draft.revision;
    const digest = decision === 'revoke' ? prior?.contentDigest : detail.draft.digest;
    const credentialRevision = decision === 'revoke' ? prior?.qualificationRevision : qualification?.revision;
    if (!revision || !digest || !credentialRevision) return;
    const input: ProfessionalDecisionInput = { profession, decision, contentRevision: revision, contentDigest: digest,
      expectedLockVersion: detail.draft.lockVersion, expectedReviewVersion: detail.reviewVersion, expectedQualificationRevision: credentialRevision, comment };
    writeGuard.current = 'writing'; const controller = new AbortController(); writeController.current = controller; setBusy(true); setFeedback('');
    try {
      const result = await requestDecoded(`/editorial/professional/${selected}`, session, value => parseProfessionalDecision(value, selected, detail, input, session), { method: 'POST', signal: controller.signal, body: JSON.stringify(input) });
      if (controller.signal.aborted) return;
      setDetail(result); setComment(''); setFeedback('审校意见已记录为私有固定版本；未发布任何内容。');
    } catch (reason) { if (!controller.signal.aborted) { if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); } setFeedback(problem(reason)); } }
    finally { if (!controller.signal.aborted) { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); } }
  }
  const canReview = session.user.role !== 'editor' && qualification?.status === 'verified' && qualification.profession === profession && qualification.accountRevision === session.user.revision && Date.parse(qualification.validUntil) > Date.now();
  const stateLabel = { pending: '尚待专业审校', changes_requested: '专业审校退回，需新修订', recorded: '已有内部意见，条件仍未齐备', eligible_for_publication_approval: '两类有效意见齐备，仍待发布批准' };
  const current = !!detail && readCurrent && !loading && !busy && !error && !verificationRequired;
  return <section className="panel workflow-panel professional-panel"><div className="workflow-toolbar"><h2>固定版本专业审校</h2><button className="secondary" onClick={reload} disabled={busy || loading}>刷新专业审校</button></div>
    <p className="notice">仅适用于单个食材教育草稿，不批准整方、照片、诊疗或用药建议。两类独立有效意见和发布批准分别管理；工程测试意见永远不能满足真人审校门槛。</p>
    <label>搜索待专业审校食材<input aria-label="搜索待专业审校食材" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} /></label>
    {items.loading && <p role="status">正在读取待审校食材…</p>}{items.error && <p role="alert" className="notice error">食材查询暂不可用。{items.error}<button className="text-button" onClick={items.retry}>重试专业审校食材</button></p>}
    <div className="source-choices">{!items.loading && !items.error && items.data?.items.map((item) => <button className="secondary" key={item.id} disabled={busy || loading} onClick={() => { if (item.id !== selected && confirmLeave({ dirty: !!comment.trim() || verificationRequired, busy: busy || loading })) { setSelected(item.id); setSelectedName(item.name); setDetail(null); setComment(''); setFeedback(''); } }}>查看{item.name}专业审校</button>)}</div>
    {!items.loading && !items.error && items.data && !items.data.items.length && <p className="muted">没有匹配的待审校食材。</p>}
    {selectedName && <p aria-label="专业审校当前食材">当前选中食材：{selectedName}；搜索不改变已选择的审校对象。</p>}
    {error && <p className="notice error" role="alert">专业审校状态暂不可用，不能确认当前意见与资格。{error}</p>}{loading && <p role="status">正在读取固定版本与资格…</p>}
    {detail && readOwner?.session.user.id === session.user.id && <div>{current && <><p className="notice" aria-label="专业审校状态">{stateLabel[detail.state]} · 私有审校记录，不自动发布</p>{detail.reasons.some((reason) => reason.includes('test_fixture')) && <p className="notice">包含工程测试意见，不能作为真实专业批准。</p>}</>}
      {detail.draft ? <article>{current && <><h3>内容修订 {detail.draft.revision} · 审校协作版本 {detail.reviewVersion}</h3><p className="small muted">{detail.draft.digest}</p><dl className="facts"><div><dt>食用部位</dt><dd>{detail.draft.content.ediblePart || '未填'}</dd></div><div><dt>身份</dt><dd>{detail.draft.content.latinName || '未填'}</dd></div></dl><h3>教育说明</h3><p className="preserve-lines">{detail.draft.content.educationText}</p><h3>安全边界</h3><p className="preserve-lines">{detail.draft.content.safetyText}</p>
        <FixedSourceReferences snapshot={detail.draft} title="固定来源与定位" />
        </>}<fieldset className="workflow-fields professional-fields" disabled={!current}><label>审校专业<select aria-label="审校专业" value={profession} onChange={(e) => setProfession(e.target.value as ProfessionalKind)}><option value="tcm_physician">中医师</option><option value="pharmacist">药师</option></select></label><label>专业审校意见<textarea aria-label="专业审校意见" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="note-actions"><button className="primary" disabled={busy || !!error || !comment.trim() || !canReview || !hasFixedSourceReferences(detail.draft) || detail.draft.state !== 'editorial_accepted'} onClick={() => decide('approve')}>记录专业通过（不发布）</button><button className="secondary" disabled={busy || !!error || !comment.trim() || !canReview || detail.draft.state !== 'editorial_accepted'} onClick={() => decide('return')}>退回专业审校</button><button className="text-button" disabled={busy || !!error || !comment.trim() || session.user.role === 'editor' || !detail.latestReviews.some((item) => item.profession === profession && item.decision === 'approve')} onClick={() => decide('revoke')}>撤销该专业意见</button></div></fieldset>
      </article> : current && <p className="muted">尚无内容草稿，请先保存并完成独立编辑审阅。</p>}
      {current && <><h3>最近固定审校记录</h3>{detail.reviews.map((item) => <article className="source" key={item.version}><strong>{professionLabel(item.profession)} · {item.decision === 'approve' ? '记录通过' : item.decision === 'return' ? '退回' : '撤销'} · 内容修订 {item.contentRevision}</strong><p>{item.comment}</p><small>{item.actor} · 审校版本 {item.version} · {timestamp(item.recordedAt)}</small></article>)}</>}
    </div>}{feedback && <p className="notice" role="status" aria-label="专业审校结果">{feedback}</p>}
  </section>;
}
export function ProfessionalReviewPanel({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [credentialActivity, setCredentialActivity] = useState({ dirty: false, busy: false }); const [reviewActivity, setReviewActivity] = useState({ dirty: false, busy: false });
  useActivity(credentialActivity.dirty || reviewActivity.dirty, credentialActivity.busy || reviewActivity.busy, onActivity);
  return <div><QualificationManager session={session} onActivity={setCredentialActivity} /><ProfessionalDesk session={session} onActivity={setReviewActivity} /></div>;
}
