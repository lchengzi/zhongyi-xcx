import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ingredient, PublicationActionInput, PublicationApprovalInput, PublicationControlInput, PublicationSnapshotInput, PublicationSnapshotView, PublicationWorkspaceView, SessionInfo } from '../shared/contracts';
import { parseIngredientPage } from '../shared/workflow-response';
import { parsePublicationWorkspace, parseSavedPublicationApproval, parseSavedPublicationControl, parseSavedPublicationEvent, parseSavedPublicationSnapshot } from '../shared/publication-response';
import { requestDecoded } from './api';
import { useDecodedReadResult } from './useReadResult';
import { confirmLeave, problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

type Operation = 'snapshot' | 'approve' | 'revoke' | 'publish' | 'withdraw' | 'rollback' | 'freeze' | 'resume';
const labels: Record<Operation, string> = { snapshot: '生成固定快照', approve: '批准此快照', revoke: '撤销此批准', publish: '发布此快照', withdraw: '撤回当前发布', rollback: '回滚到此快照', freeze: '冻结全部教育发布', resume: '恢复发布操作' };
const reasonLabel = (code: string) => ({ publication_disabled: '服务端公开能力关闭', publication_missing: '尚无发布记录', publication_withdrawn: '当前已撤回', publication_frozen: '发布冻结或尚未初始化', publication_approval_required: '缺少当前有效独立批准', published_approval_changed: '已发布时的批准版本不再有效', publication_recovery_epoch_changed: '冻结批次已变化，须重新批准', withdrawn_snapshot_requires_new_approval: '撤回后的快照须重新批准', professional_opinion_changed: '固定专业意见已变化', qualification_changed: '固定资格依据已变化', source_check_changed: '固定来源核验已变化', editorial_authority_changed: '编辑审阅权限已变化' })[code] || code;

function SnapshotPreview({ item }: { item: PublicationSnapshotView }) {
  const draft = item.basis.draft;
  return <section className="workflow-history" aria-label="固定快照内容"><h3>快照 {item.version} · 正文修订 {draft.revision}</h3>
    <p>{draft.content.ediblePart} · {draft.content.latinName || '未列拉丁名'}</p><p className="publication-text">{draft.content.educationText}</p><p className="publication-text">安全边界：{draft.content.safetyText}</p>
    <p className="small muted publication-digest">完整记录摘要：{item.digest}</p>
    <details><summary>固定来源与审校依据摘要</summary>{draft.sources.map((source) => <article key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{source.publisher} · 来源修订 {source.revision}</p><p>{draft.content.sourceRefs.find((ref) => ref.id === source.id)?.locator}</p></article>)}
      {item.basis.qualifications.map((q) => <p key={q.userId}>{q.profession === 'tcm_physician' ? '中医师' : '药师'}资格记录修订 {q.revision} · {q.evidenceKind === 'test-fixture' ? '工程测试' : '人工核验记录（非系统认证）'} · 截止 {timestamp(q.validUntil)}</p>)}
      <p className="muted">资格显示类别、版本和有效期，核验依据保留在私有记录中。软件记录和摘要不代表真实专业签审。</p>
    </details></section>;
}

function PublicationDetail({ item, session, onActivity }: { item: Ingredient; session: SessionInfo; onActivity: ActivityHandler }) {
  const admin = session.user.role === 'admin'; const editor = session.user.role !== 'reviewer';
  const [data, setData] = useState<PublicationWorkspaceView | null>(null); const [selectedId, setSelectedId] = useState('');
  const [comment, setComment] = useState(''); const [confirmed, setConfirmed] = useState(false); const [evidence, setEvidence] = useState(''); const [olderVersion, setOlderVersion] = useState('');
  const [loading, setLoading] = useState(true); const [writing, setWriting] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const focus = useRef<number | undefined>(undefined); const busy = loading || writing;
  const guard = useRef<'idle' | 'reading' | 'writing' | 'verify'>('reading'); const [verificationRequired, setVerificationRequired] = useState(false);
  const operationController = useRef<AbortController | null>(null);
  const [readOwner, setReadOwner] = useState<{ session: SessionInfo; retry: number } | null>(null);
  const readCurrent = readOwner?.session === session && readOwner.retry === retry;
  const dirty = !!comment || confirmed || !!evidence || !!olderVersion || verificationRequired; useActivity(dirty, busy, onActivity);
  const selected = data?.snapshots.find((snapshot) => snapshot.id === selectedId);
  const approval = data?.approvals.find((record) => record.snapshotId === selectedId);
  const head = data?.events[0];
  const path = `/editorial/publications/${item.id}`;
  const read = (version?: number, signal?: AbortSignal) => requestDecoded(version === undefined ? path : `${path}/versions/${version}`, session, value => parsePublicationWorkspace(value, item.id, version), { signal });
  function apply(value: PublicationWorkspaceView, version?: number) {
    const chosen = (version === undefined ? undefined : value.snapshots.find((snapshot) => snapshot.version === version)) || value.snapshots.find((snapshot) => snapshot.id === value.activeSnapshotId) || value.snapshots[0];
    setData(value); setSelectedId(chosen?.id || ''); focus.current = chosen?.version;
    setComment(''); setConfirmed(false); setEvidence(''); setOlderVersion(''); setError('');
    setReadOwner({ session, retry }); guard.current = 'idle'; setVerificationRequired(false);
  }
  useEffect(() => { setWriting(false); return () => operationController.current?.abort(); }, [session]);
  useEffect(() => {
    const controller = new AbortController(), version = focus.current; guard.current = 'reading'; setLoading(true); setError('');
    read(version, controller.signal).then((value) => { if (!controller.signal.aborted) apply(value, version); })
      .catch((reason) => { if (!controller.signal.aborted) { guard.current = 'verify'; setError(problem(reason)); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item.id, session, retry]);
  function reload() { if (guard.current === 'reading' || guard.current === 'writing') return; if (confirmLeave({ dirty, busy })) { guard.current = 'reading'; setFeedback(''); setRetry((value) => value + 1); } }
  function choose(id: string) {
    if (!readCurrent || guard.current !== 'idle' || id === selectedId || !confirmLeave({ dirty, busy })) return;
    setSelectedId(id); focus.current = data?.snapshots.find((snapshot) => snapshot.id === id)?.version;
    setComment(''); setConfirmed(false); setEvidence(''); setOlderVersion(''); setFeedback('');
  }
  async function older() {
    const version = Number(olderVersion);
    if (!readCurrent || guard.current !== 'idle' || busy || !Number.isSafeInteger(version) || version < 1 || !confirmLeave({ dirty: !!comment || confirmed || !!evidence, busy })) return;
    const controller = new AbortController(); operationController.current = controller; guard.current = 'reading'; setLoading(true); setError(''); setFeedback('');
    try { const value = await read(version, controller.signal); if (!controller.signal.aborted) apply(value, version); }
    catch (reason) { if (!controller.signal.aborted) { guard.current = 'verify'; setError(problem(reason)); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function perform(operation: Operation) {
    if (!data || !readCurrent || guard.current !== 'idle' || busy || error || !confirmed || !comment.trim() || (operation !== 'snapshot' && !admin) || (operation === 'snapshot' && !editor)) return;
    const control = operation === 'freeze' || operation === 'resume';
    if (control && !evidence.trim()) return;
    if (!control && operation !== 'snapshot' && !selected) return;
    const impact = control ? '此操作影响所有食材的教育发布。恢复不会自动恢复旧批准或发布内容。' : operation === 'snapshot' ? '只固定当前依据，不批准、不发布。' : operation === 'approve' ? '只记录独立批准，不自动发布。参与内容或查证的账号不能自行批准。' : operation === 'withdraw' || operation === 'revoke' ? '内容可能立即停止公开；历史记录仍保留。' : '服务端将重新检查全部固定依据与当前授权；历史目录和安全规则不会被替换。';
    if (!window.confirm(`${labels[operation]}？${impact}`)) return;
    const common = { comment: comment.trim(), confirmed: true };
    const controller = new AbortController(); operationController.current = controller; guard.current = 'writing'; setWriting(true); setFeedback(''); let recorded = false;
    try {
      const post = <T,>(endpoint: string, body: object, decode: (value: unknown) => T) => requestDecoded(endpoint, session, decode, { method: 'POST', signal: controller.signal, body: JSON.stringify(body) });
      let version = focus.current;
      if (operation === 'freeze' || operation === 'resume') {
        const input: PublicationControlInput = { ...common, action: operation, expectedVersion: data.control?.version || 0, evidenceReference: evidence.trim() };
        await post('/editorial/publication-controls', input, value => parseSavedPublicationControl(value, data.control, input, session));
      } else if (operation === 'snapshot') {
        if (!data.basisDigest) { guard.current = 'idle'; return; }
        const input: PublicationSnapshotInput = { ...common, expectedBasisDigest: data.basisDigest };
        const result = await post(`${path}/snapshots`, input, value => parseSavedPublicationSnapshot(value, data, input, session)); version = result.version;
      } else if (operation === 'approve' || operation === 'revoke') {
        const input: PublicationApprovalInput = { ...common, snapshotId: selected!.id, snapshotDigest: selected!.digest, expectedApprovalVersion: approval?.version || 0, expectedControlVersion: data.control?.version || 0, decision: operation };
        await post(`${path}/approvals`, input, value => parseSavedPublicationApproval(value, data, input, session));
      } else {
        const input: PublicationActionInput = { ...common, snapshotId: selected!.id, action: operation, expectedVersion: data.eventVersion, expectedControlVersion: data.control?.version || 0 };
        await post(`${path}/actions`, input, value => parseSavedPublicationEvent(value, data, input, session));
      }
      if (controller.signal.aborted) return; recorded = true;
      const refreshed = await read(version, controller.signal);
      if (controller.signal.aborted) return;
      apply(refreshed, version); setFeedback(`已记录「${labels[operation]}」。以重新读取的当前状态为准；批准或恢复本身不会发布。`);
    } catch (reason) {
      if (controller.signal.aborted) return; guard.current = 'verify'; setVerificationRequired(true);
      setError(`${recorded ? '操作已记录，但状态刷新失败。' : '操作未能确认成功，输入已保留。'}${problem(reason)} 请重新加载最新状态后再操作，不要重复提交。`);
    } finally { if (!controller.signal.aborted) setWriting(false); }
  }
  const ready = readCurrent && !verificationRequired && !busy && !error && !!data && confirmed && !!comment.trim();
  // Keep unsent form input, but never present a previous read as current authority.
  const current = !!data && readCurrent && !verificationRequired && !busy && !error;
  return <section className="panel workflow-panel publication-panel"><div className="workflow-toolbar"><h2>{item.name} · 固定版本发布</h2><button className="secondary" disabled={busy} onClick={reload}>重新加载发布状态</button></div>
    <p className="notice">新草稿与发布快照分开。只有当前有效的独立批准和明确发布才允许公开；不是医疗服务，也不授予照片或整方发布权限。请勿输入健康资料或证件信息。</p>
    {loading && <p role="status">正在读取固定快照与当前发布权限…</p>}{error && <p role="alert" className="notice error" aria-label="发布操作错误">{error}</p>}
    {writing && <p role="status">正在记录操作并核对最新发布状态…</p>}
    {!busy && error && <p className="notice" aria-label="发布状态待确认">当前发布状态、批准效力与历史记录不能确认，旧资料已隐藏。这不代表没有记录或内容已撤回。已有输入保留，请重新加载最新状态后再操作；不会自动重发操作。</p>}
    {data && readOwner?.session.user.id === session.user.id && <>{current && <><p className="notice" aria-label="教育发布状态">{data.enabled ? '服务端公开能力已显式开启' : '服务端公开能力关闭'} · {data.control?.action === 'resume' ? '允许核对发布操作' : '全部教育发布冻结或未初始化'} · {data.activeSnapshotId ? `当前有效快照 ${data.snapshots.find((snapshot) => snapshot.id === data.activeSnapshotId)?.version || data.activeSnapshotId}` : '当前无有效公开内容'}</p>
      <div aria-label="发布阻断原因">{data.blockedReasons.map((code) => <p key={code}>{reasonLabel(code)}</p>)}</div>
      <p className="small muted">发布事件版本 {data.eventVersion} · 冻结版本 {data.control?.version || 0} · 当前正文修订 {data.preflight.contentRevision || '无'}</p>
      <p>{data.basisDigest ? '当前固定资料条件已记录；仍需人工核对，不能视为真实签审认证。' : '当前正文资料条件未齐备，不能生成快照。'}</p>
      {!data.basisDigest && <div aria-label="快照资料缺口">{data.preflight.reasons.map((reason) => <p key={reason}>{reasonLabel(reason)}</p>)}</div>}
      <label>固定快照版本<select aria-label="固定快照版本" value={selectedId} disabled={busy || !data.snapshots.length} onChange={(e) => choose(e.target.value)}>{!data.snapshots.length && <option value="">暂无固定快照</option>}{data.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>快照 {snapshot.version} · 正文 {snapshot.basis.draft.revision}{snapshot.id === data.activeSnapshotId ? ' · 当前公开' : ''}</option>)}</select></label>
      <div className="workflow-actions"><label>更早快照版本<input aria-label="更早快照版本" type="number" min={1} value={olderVersion} disabled={busy} onChange={(e) => setOlderVersion(e.target.value)} /></label><button className="secondary" onClick={older} disabled={busy || !olderVersion}>读取历史快照版本</button></div>
      <p className="muted small">默认显示最近 20 条及当前公开快照。可以按版本读取更早快照；历史记录不是当前发布许可。</p>
      {selected && <><SnapshotPreview item={selected} /><p aria-label="快照批准状态">{approval ? `批准记录 ${approval.version} · ${approval.decision === 'approve' ? '已记录批准，仍需核对当前效力' : '已撤销批准'}` : '此快照尚无独立批准记录'}</p></>}
      </>}
      <div className="workflow-form"><label>发布操作说明<textarea aria-label="发布操作说明" value={comment} maxLength={1000} disabled={busy || !editor} onChange={(e) => setComment(e.target.value)} /></label>
        {admin && <label>恢复或冻结核对编号<input aria-label="恢复或冻结核对编号" value={evidence} maxLength={200} disabled={busy} onChange={(e) => setEvidence(e.target.value)} /></label>}
        <label className="assistant-check"><input aria-label="确认已核对发布依据" type="checkbox" checked={confirmed} disabled={busy || !editor} onChange={(e) => setConfirmed(e.target.checked)} />我已核对固定内容、当前权限、来源和专业依据；工程测试不代表真人签审。恢复前还须核对备份后的撤销记录。</label>
      </div>
      <div className="workflow-actions"><button className="primary" onClick={() => perform('snapshot')} disabled={!ready || !editor || !data.basisDigest}>生成固定快照</button>
        <button className="secondary" onClick={() => perform('approve')} disabled={!ready || !admin || !selected || data.control?.action !== 'resume'}>批准此快照</button>
        <button className="secondary" onClick={() => perform('revoke')} disabled={!ready || !admin || approval?.decision !== 'approve'}>撤销此批准</button>
        <button className="primary" onClick={() => perform('publish')} disabled={!ready || !admin || !selected || !data.enabled || data.control?.action !== 'resume' || approval?.decision !== 'approve'}>发布此快照</button>
        <button className="secondary" onClick={() => perform('withdraw')} disabled={!ready || !admin || !selected || !head || head.action === 'withdraw' || head.snapshotId !== selectedId}>撤回当前发布</button>
        <button className="secondary" onClick={() => perform('rollback')} disabled={!ready || !admin || !selected || !data.enabled || data.control?.action !== 'resume' || approval?.decision !== 'approve'}>回滚到此快照</button></div>
      {admin && <div className="workflow-actions"><button className="secondary" onClick={() => perform('freeze')} disabled={!ready || !evidence.trim()}>冻结全部教育发布</button><button className="secondary" onClick={() => perform('resume')} disabled={!ready || !evidence.trim() || data.control?.action === 'resume'}>恢复发布操作</button></div>}
      {!admin && <p className="notice">{editor ? '编辑可以整理快照，不能批准、发布、撤回、回滚或变更全局冻结。' : '审阅账号只读本页；专业意见请在专业审校记录中操作。'}</p>}
      {current && <section className="workflow-history"><h3>最近发布事件</h3>{data.events.map((event) => <article key={event.version}><strong>事件 {event.version} · {labels[event.action]}</strong><p>{event.comment}</p><small>{event.actor} · {timestamp(event.recordedAt)}</small></article>)}{!data.events.length && <p className="muted">尚无发布事件。</p>}</section>}
    </>}{feedback && <p role="status" aria-label="发布操作结果" className="notice">{feedback}</p>}
  </section>;
}

export function PublicationPanel({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [item, setItem] = useState<Ingredient | null>(null);
  const [activity, setActivity] = useState({ dirty: false, busy: false });
  const decode = useCallback((value: unknown) => parseIngredientPage(value, { page, pageSize: 8 }), [page]);
  const read = useDecodedReadResult(`/ingredients?q=${encodeURIComponent(query.trim())}&page=${page}&pageSize=8`, session, decode);
  const { data: items, loading, error } = read;
  useActivity(activity.dirty, activity.busy, onActivity);
  return <div className="workflow-split"><section className="panel workflow-panel"><h2>选择发布管理食材</h2><input aria-label="搜索发布管理食材" maxLength={80} value={query} disabled={activity.busy} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="搜索名称、拼音或别名" />
    {loading && <p role="status">正在读取食材…</p>}{error && <p role="alert" className="notice error">{error}<button className="text-button" onClick={read.retry}>重试食材列表</button></p>}
    {!loading && !error && items?.items.map((value) => <button className={`workflow-item ${item?.id === value.id ? 'selected' : ''}`} key={value.id} disabled={activity.busy} aria-label={`管理${value.name}发布`} onClick={() => { if (value.id !== item?.id && confirmLeave(activity)) setItem(value); }}><strong>{value.name}</strong><span>{value.pinyin} · 历史目录身份</span></button>)}
    {!loading && !error && items && !items.items.length && <p className="muted">没有匹配食材。</p>}
    <div className="pagination"><span aria-label="发布食材结果数量">{loading ? '正在读取结果数量…' : error || !items ? '结果数量暂不可用' : `共 ${items.total} 条`}</span><div><button className="secondary" disabled={loading || !!error || !items || activity.busy || page === 1} onClick={() => setPage(page - 1)}>上一批发布条目</button><button className="secondary" disabled={loading || !!error || !items || activity.busy || page * 8 >= (items?.total || 0)} onClick={() => setPage(page + 1)}>下一批发布条目</button></div></div>
  </section>{item ? <PublicationDetail key={`${item.id}:${session.user.id}`} item={item} session={session} onActivity={setActivity} /> : <section className="panel workflow-panel empty"><h2>选择食材查看发布历史</h2><p>生成快照、批准与实际发布是独立步骤；默认不会公开任何新内容。</p></section>}</div>;
}
