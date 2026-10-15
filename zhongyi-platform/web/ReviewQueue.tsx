import { useEffect, useRef, useState } from 'react';
import type { ContentRevision, DraftDetail, ReviewTask, SessionInfo } from '../shared/contracts';
import { requestDecoded, requiresWriteVerification } from './api';
import { parseContentDraft, parseContentRevision, parseDraftDetail, parseReviewTask, parseReviewTaskPage } from '../shared/workflow-response';
import { FixedSourceReferences } from './FixedSourceReferences';
import { hasFixedSourceReferences } from './fixed-source-references';
import { confirmLeave, problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

const statusLabel = (status: ReviewTask['status']) => ({ pending: '待编辑审阅', accepted: '编辑审阅通过 · 未发布', returned: '已退回' })[status];
function ReviewDetail({ taskId, session, onActivity, completed }: { taskId: string; session: SessionInfo; onActivity: ActivityHandler; completed: () => void }) {
  const [task, setTask] = useState<ReviewTask | null>(null); const [detail, setDetail] = useState<DraftDetail | null>(null); const [snapshot, setSnapshot] = useState<ContentRevision | null>(null);
  const [comment, setComment] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const writeGuard = useRef<'idle' | 'writing' | 'verify'>('idle');
  useActivity(!!comment.trim() || verificationRequired, busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    (async () => {
      const value = await requestDecoded(`/editorial/tasks/${taskId}`, session, result => parseReviewTask(result, taskId), { signal: controller.signal });
      const [current, revision] = await Promise.all([
        requestDecoded(`/editorial/ingredients/${value.ingredientId}`, session, result => parseDraftDetail(result, value.ingredientId), { signal: controller.signal }),
        requestDecoded(`/editorial/ingredients/${value.ingredientId}/revisions/${value.revision}`, session, result => {
          const revision = parseContentRevision(result, value.ingredientId, value.revision);
          if (revision.digest !== value.digest) throw new Error('Task snapshot mismatch'); return revision;
        }, { signal: controller.signal })
      ]);
      if (!controller.signal.aborted) { setTask(value); setDetail(current); setSnapshot(revision); writeGuard.current = 'idle'; setVerificationRequired(false); }
    })().catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId, session, retry]);
  const contributor = task?.submittedById === session.user.id || detail?.draft?.ownerId === session.user.id || detail?.contributorIds.includes(session.user.id);
  const canReview = !verificationRequired && session.user.role !== 'editor' && !contributor && task?.status === 'pending' && detail?.draft?.state === 'submitted';
  async function decide(decision: 'accept' | 'return') {
    if (decision === 'accept' && (!snapshot || !hasFixedSourceReferences(snapshot))) return;
    if (!task || !detail?.draft || !canReview || !comment.trim() || busy || writeGuard.current !== 'idle') return; writeGuard.current = 'writing'; setBusy(true); setFeedback('');
    const expectedLockVersion = detail.draft.lockVersion;
    try {
      await requestDecoded(`/editorial/tasks/${task.id}/decision`, session, value => {
        const draft = parseContentDraft(value, task.ingredientId);
        if (draft.revision !== task.revision || draft.digest !== task.digest || draft.lockVersion !== expectedLockVersion + 1 ||
          draft.state !== (decision === 'accept' ? 'editorial_accepted' : 'changes_requested')) throw new Error('Unexpected review result'); return draft;
      }, { method: 'POST', body: JSON.stringify({ decision, comment, expectedLockVersion }) });
      setComment(''); setFeedback(decision === 'accept' ? '编辑审阅已通过，仍为私有待专业审校内容，未发布。' : '已退回，作者可保存新修订后再次提交。'); setRetry((value) => value + 1); completed();
    } catch (reason) { if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); } setFeedback(problem(reason)); }
    finally { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); }
  }
  function reload() { if (confirmLeave({ dirty: !!comment.trim() || verificationRequired, busy })) { setComment(''); setRetry((value) => value + 1); } }
  if (loading) return <section className="panel workflow-panel" role="status">正在读取固定审阅版本…</section>;
  if (error || !task || !snapshot || !detail) return <section className="panel workflow-panel"><p role="alert" className="notice error">{error || '无法读取任务'}</p><button className="secondary" onClick={reload}>重新加载任务</button></section>;
  return <section className="panel workflow-panel"><div className="workflow-toolbar"><h2>{task.ingredientName} · 编辑审阅</h2><span className="status">{statusLabel(task.status)}</span></div>
    <p className="notice">编辑审阅确认资料整理质量；中医师／药师签审和发布批准需分别完成。审阅结果不会改变小程序正式目录。</p>
    {verificationRequired && <p className="notice">上次审阅结果待核对。请重新加载任务后再操作，当前意见仍保留。</p>}
    <p className="small muted">提交者：{task.submittedBy} · 内容修订 {task.revision} · {timestamp(task.submittedAt)}<br />{task.digest}</p>
    <dl className="facts"><div><dt>资料所列部位</dt><dd>{snapshot.content.ediblePart || '未填写'}</dd></div><div><dt>拉丁名</dt><dd>{snapshot.content.latinName || '未填写'}</dd></div></dl>
    <section className="review-copy"><h3>教育说明（提交版本）</h3><p>{snapshot.content.educationText || '未填写'}</p><h3>安全与适用边界</h3><p>{snapshot.content.safetyText || '未填写'}</p></section>
    <FixedSourceReferences snapshot={snapshot} title="固定版本来源与原文定位" />
    {task.comment && <p className="notice">已记录意见：{task.comment}<br /><span className="small">{task.reviewedBy} · {task.reviewedAt ? timestamp(task.reviewedAt) : ''}</span></p>}
    {task.status === 'pending' && <div className="workflow-form">{contributor ? <p className="notice">参与此条目编辑或提交的账号不能自审。服务端检查完整编辑历史。</p> : session.user.role === 'editor' ? <p className="notice">编辑账号仅可查看任务，由独立审阅者处理。</p> : null}
      <label>编辑审阅意见<textarea aria-label="编辑审阅意见" maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} readOnly={!canReview} disabled={busy} placeholder="明确需要修改的来源、定位或资料整理问题；不要填写专业签审结论。" /></label>
      <div className="workflow-actions"><button className="primary" disabled={!canReview || busy || !comment.trim() || !hasFixedSourceReferences(snapshot)} onClick={() => decide('accept')}>通过编辑审阅（不发布）</button><button className="secondary" disabled={!canReview || busy || !comment.trim()} onClick={() => decide('return')}>退回修改</button></div></div>}
    <button className="text-button" disabled={busy} onClick={reload}>重新加载任务</button>{feedback && <p role="status" aria-label="编辑审阅结果" className="notice">{feedback}</p>}
  </section>;
}
export function ReviewQueue({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [status, setStatus] = useState<ReviewTask['status']>('pending'); const [page, setPage] = useState(1); const [data, setData] = useState<{ items: ReviewTask[]; total: number } | null>(null);
  const [taskId, setTaskId] = useState(''); const [activity, setActivity] = useState({ dirty: false, busy: false }); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useActivity(activity.dirty, activity.busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    requestDecoded(`/editorial/tasks?status=${status}&page=${page}`, session, value => parseReviewTaskPage(value, { page, pageSize: 12, status }), { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, page, session, retry]);
  return <div className="workflow-split"><section className="panel workflow-panel"><div className="workflow-toolbar"><h2>编辑审阅队列</h2><button className="secondary" disabled={loading} onClick={() => setRetry((value) => value + 1)}>刷新任务</button></div>
    <label className="workflow-filter">任务状态<select aria-label="筛选审阅任务" value={status} onChange={(event) => { setStatus(event.target.value as ReviewTask['status']); setPage(1); }}><option value="pending">待编辑审阅</option><option value="returned">已退回</option><option value="accepted">编辑审阅通过 · 未发布</option></select></label>
    {error && <p role="alert" className="notice error">{error}<button onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
    {loading ? <p role="status">正在读取审阅任务…</p> : error ? <p className="muted">任务列表暂不可用，请重试；不能据此判断没有待审任务。</p> : data?.items.map((task) => <button className={`workflow-item ${taskId === task.id ? 'selected' : ''}`} aria-label={`审阅${task.ingredientName}修订${task.revision}`} key={task.id} disabled={activity.busy} onClick={() => { if (taskId !== task.id && confirmLeave(activity)) setTaskId(task.id); }}><strong>{task.ingredientName} · 修订 {task.revision}</strong><span>{task.submittedBy} · {statusLabel(task.status)}</span></button>)}
    {!loading && !error && data && !data.items.length && <p className="muted">当前状态没有审阅任务。</p>}<div className="pagination"><span>{loading ? '正在读取任务数量…' : error ? '任务数量暂不可用' : `共 ${data?.total || 0} 个任务`}</span><div><button className="secondary" disabled={loading || !!error || page === 1} onClick={() => setPage(page - 1)}>上一页任务</button><button className="secondary" disabled={loading || !!error || page * 12 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>下一页任务</button></div></div>
  </section>{taskId ? <ReviewDetail key={taskId} taskId={taskId} session={session} onActivity={setActivity} completed={() => setRetry((value) => value + 1)} /> : <section className="panel workflow-panel empty"><h2>选择一个固定版本审阅</h2><p>来源和内容摘要绑定提交时的版本，不自动替换为最新草稿。</p></section>}</div>;
}
