import { useEffect, useRef, useState } from 'react';
import type { AssistantResult, DraftContent, DraftDetail, Ingredient, IngredientPage, ManagedSource, SessionInfo } from '../shared/contracts';
import { request, requestDecoded, requiresWriteVerification } from './api';
import { parseSavedDraft, parseDraftDetail, parseDraftSubmission, parseIngredientPage, parseManagedSource } from '../shared/workflow-response';
import { SourcePicker } from './Sources';
import { AssistantPanel } from './AssistantPanel';
import { confirmLeave, problem, stateLabel, timestamp, useActivity, type ActivityHandler } from './workflow-shared';
import { matchesProposal, type SummaryProposal } from '../shared/assistant-proposal';
import { isEvidenceExcerpt } from '../shared/assistant-result';
import { DraftPhotoCandidates } from './DraftPhotoCandidates';
import { DraftResearchReferences } from './DraftResearchReferences';

const starting = (item: Ingredient): DraftContent => ({ ediblePart: item.ediblePart, latinName: item.latinName, educationText: '', safetyText: item.restriction, sourceRefs: [] });
function DraftEditor({ item, session, blocked, onActivity }: { item: Ingredient; session: SessionInfo; blocked: boolean; onActivity: ActivityHandler }) {
  const [detail, setDetail] = useState<DraftDetail | null>(null); const [input, setInput] = useState<DraftContent>(starting(item)); const [sources, setSources] = useState<ManagedSource[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const [assistantActivity, setAssistantActivity] = useState({ dirty: false, busy: false });
  const [verificationRequired, setVerificationRequired] = useState(false);
  const writeGuard = useRef<'idle' | 'writing' | 'verify'>('idle');
  const busy = saving || assistantActivity.busy;
  const current = detail?.draft; const dirty = !!detail && JSON.stringify(input) !== JSON.stringify(current?.content || starting(item));
  const readOnly = verificationRequired || session.user.role === 'reviewer' || current?.state === 'submitted' || (!!current && current.ownerId !== session.user.id && session.user.role !== 'admin');
  const live = useRef({ input, readOnly, lockVersion: current?.lockVersion || 0, saving });
  live.current = { input, readOnly, lockVersion: current?.lockVersion || 0, saving };
  const adoption = useRef<AbortController | null>(null);
  useEffect(() => () => { adoption.current?.abort(); }, [retry]);
  useActivity(dirty || assistantActivity.dirty || verificationRequired, busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    requestDecoded(`/editorial/ingredients/${item.id}`, session, value => parseDraftDetail(value, item.id), { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { setDetail(value); setInput(value.draft?.content || starting(item)); setSources(value.draft?.sources || []); writeGuard.current = 'idle'; setVerificationRequired(false); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item, session, retry]);
  function picked(source: ManagedSource) {
    if (input.sourceRefs.some((ref) => ref.id === source.id)) { setFeedback('已引用此来源；如需新版本，请先移除旧引用。'); return; }
    if (input.sourceRefs.length >= 10) { setFeedback('每个草稿最多引用 10 个来源。'); return; }
    setInput({ ...input, sourceRefs: [...input.sourceRefs, { id: source.id, revision: source.revision, locator: '' }] }); setSources([...sources, source]); setFeedback('');
  }
  async function update() {
    if (readOnly || busy || !detail || writeGuard.current !== 'idle') return; writeGuard.current = 'writing'; setBusy(true); setFeedback('');
    try {
      const saved = await requestDecoded(`/editorial/ingredients/${item.id}`, session, value => parseSavedDraft(value, item.id, current || null, input),
        { method: 'PUT', body: JSON.stringify({ content: input, expectedLockVersion: current?.lockVersion || 0 }) });
      setDetail({ ...detail, draft: saved, revisions: [saved, ...detail.revisions].slice(0, 20) }); setInput(saved.content); setSources(saved.sources); setFeedback('已保存私有草稿新修订，尚未提交审阅。');
    } catch (reason) { if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); } setFeedback(problem(reason)); }
    finally { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); }
  }
  async function submit() {
    if (readOnly || !current || dirty || assistantActivity.dirty || busy || !detail || writeGuard.current !== 'idle') return; writeGuard.current = 'writing'; setBusy(true); setFeedback('');
    try {
      const result = await requestDecoded(`/editorial/ingredients/${item.id}/submit`, session, value => parseDraftSubmission(value, item.id, current), { method: 'POST', body: JSON.stringify({ expectedLockVersion: current.lockVersion }) });
      setDetail({ ...detail, draft: result.draft, tasks: [result.task, ...detail.tasks].slice(0, 20) }); setFeedback('已提交编辑审阅，当前内容版本锁定；专业审校与发布仍未完成。');
    } catch (reason) { if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); } setFeedback(problem(reason)); }
    finally { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); }
  }
  function reload() { if (confirmLeave({ dirty: dirty || assistantActivity.dirty || verificationRequired, busy })) { setFeedback(''); setRetry((value) => value + 1); } }
  async function adopt(result: AssistantResult) {
    if (result.mode !== 'extract') return false;
    if (readOnly || !window.confirm('将用逐字摘录替换当前教育说明，并补充固定来源定位。仅更改输入，不自动保存。继续吗？')) return false;
    const refs = input.sourceRefs.map((ref) => ({ ...ref })); const linked = sources.slice();
    for (const citation of result.citations) {
      const existing = refs.find((ref) => ref.id === citation.sourceId);
      if (existing && existing.revision !== citation.sourceRevision) throw new Error('摘录与草稿引用版本不同，请先人工处理版本冲突。');
      if (existing) {
        const positions = [existing.locator, citation.locator].filter(Boolean);
        existing.locator = Array.from(new Set(positions)).join('；');
        if (existing.locator.length > 400) throw new Error('合并后的原文定位超过 400 字，请先人工缩短。');
      } else {
        refs.push({ id: citation.sourceId, revision: citation.sourceRevision, locator: citation.locator });
        linked.push(await requestDecoded(`/editorial/sources/${citation.sourceId}?revision=${citation.sourceRevision}`, session, value => parseManagedSource(value, { id: citation.sourceId, revision: citation.sourceRevision })));
      }
    }
    if (refs.length > 10) throw new Error('固定来源超过 10 个，请先人工整理。');
    const educationText = result.statements.map((statement) => statement.quote).join('\n');
    if (!educationText || educationText.length > 1600) throw new Error('辅助内容为空或超过教育说明上限，未填入输入；请人工整理。');
    setInput({ ...input, educationText, sourceRefs: refs }); setSources(linked); return true;
  }
  async function adoptProposal(proposal: SummaryProposal) {
    if (adoption.current) return false;
    const controller = new AbortController(); adoption.current = controller;
    function checkCurrent() {
      const value = live.current;
      if (controller.signal.aborted || value.readOnly || value.saving || !matchesProposal(proposal, item.id, value.input, value.lockVersion))
        throw new Error('草稿输入、版本或编辑权限已变化，请重新读取并预览。');
    }
    try {
      checkCurrent();
      // Point-in-time checks. A later server change is still guarded by save's optimistic lock.
      const remote = await requestDecoded(`/editorial/ingredients/${item.id}`, session, value => parseDraftDetail(value, item.id), { signal: controller.signal });
      if ((remote.draft?.lockVersion || 0) !== proposal.lockVersion || remote.draft?.state === 'submitted' ||
        (remote.draft && remote.draft.ownerId !== session.user.id && session.user.role !== 'admin')) throw new Error('服务端草稿已变化，请先重新加载草稿。');
      const linked = sources.slice();
      for (const citation of proposal.citations) {
        const latest = await request<unknown>(`/editorial/assistant/ingredients/${item.id}/excerpts/${citation.id}`, session, { signal: controller.signal });
        if (!isEvidenceExcerpt(latest, item.id) || latest.digest !== citation.digest || latest.sourceId !== citation.sourceId || latest.sourceRevision !== citation.sourceRevision ||
          latest.text !== citation.text || latest.locator !== citation.locator || !latest.externalPermission.allowed || latest.externalPermission.revision !== citation.externalPermission.revision)
          throw new Error('原文依据或许可已变化，未采用建议。请重新核对并生成。');
        if (!linked.some((source) => source.id === citation.sourceId && source.revision === citation.sourceRevision)) {
          const source = await requestDecoded(`/editorial/sources/${citation.sourceId}?revision=${citation.sourceRevision}`, session, value => parseManagedSource(value, { id: citation.sourceId, revision: citation.sourceRevision }), { signal: controller.signal });
          if (source.id !== citation.sourceId || source.revision !== citation.sourceRevision) throw new Error('固定来源版本读取不一致，未采用建议。');
          linked.push(source);
        }
      }
      checkCurrent(); setInput(proposal.after); setSources(linked); return true;
    } finally { if (adoption.current === controller) adoption.current = null; }
  }
  if (loading) return <section className="panel workflow-panel" role="status">正在读取内容草稿…</section>;
  if (error || !detail) return <section className="panel workflow-panel"><p role="alert" className="notice error">{error || '无法读取草稿'}</p><button className="secondary" onClick={reload}>重新加载草稿</button></section>;
  return <section className="panel workflow-panel"><div className="workflow-toolbar"><h2>{item.name} · 内容草稿</h2><span className="status">{current ? stateLabel(current.state) : '尚未创建草稿'}</span></div>
    <p className="notice">所有内容均为私有待审。编辑审阅通过不代表专业审校或允许发布；此处不提供诊断、剂量或个体化方案。</p>
    {current && <p className="small muted">作者：{current.owner} · 内容修订 {current.revision} · 协作版本 {current.lockVersion}<br />{current.digest}</p>}
    {readOnly && <p className="notice">{verificationRequired ? '上次提交结果待核对。请重新加载草稿后继续编辑，当前输入仍保留。' : current?.state === 'submitted' ? '已提交内容不能继续改写，等待审阅结果后再修订。' : '当前账号只可查阅此草稿。'}</p>}
    <DraftPhotoCandidates ingredientId={item.id} session={session} blocked={blocked} />
    <DraftResearchReferences ingredientId={item.id} session={session} blocked={blocked} />
    <div className="workflow-form"><div className="workflow-fields"><label>资料所列部位<input aria-label="草稿食用部位" value={input.ediblePart} maxLength={200} onChange={(event) => setInput({ ...input, ediblePart: event.target.value })} readOnly={readOnly} disabled={busy} /></label>
      <label>拉丁名<input aria-label="草稿拉丁名" value={input.latinName} maxLength={200} onChange={(event) => setInput({ ...input, latinName: event.target.value })} readOnly={readOnly} disabled={busy} /></label></div>
      <label>教育说明<textarea aria-label="草稿教育说明" maxLength={1600} value={input.educationText} onChange={(event) => setInput({ ...input, educationText: event.target.value })} readOnly={readOnly} disabled={busy} placeholder="整理有来源的食材知识；未知内容明确标注，不填写个人健康资料。" /></label>
      <label>安全与适用边界<textarea aria-label="草稿安全边界" maxLength={1000} value={input.safetyText} onChange={(event) => setInput({ ...input, safetyText: event.target.value })} readOnly={readOnly} disabled={busy} /></label>
    </div>
    <section className="draft-sources"><h3>固定版本来源 <span>{input.sourceRefs.length} / 10</span></h3>{input.sourceRefs.map((ref) => {
      const source = sources.find((value) => value.id === ref.id); return <article className="draft-source" key={ref.id}><strong>{source?.title || ref.id}</strong><p className="small muted">{source?.publisher} · 固定版本 {ref.revision} · 待核验</p>{source && <a href={source.url} target="_blank" rel="noopener noreferrer">打开出处 ↗</a>}
        <label>原文定位<input aria-label={`${source?.title || ref.id}的原文定位`} maxLength={400} value={ref.locator} onChange={(event) => setInput({ ...input, sourceRefs: input.sourceRefs.map((value) => value.id === ref.id ? { ...value, locator: event.target.value } : value) })} readOnly={readOnly} disabled={busy} placeholder="页码、章节或原文段落位置" /></label>
        {!readOnly && <button className="text-button" disabled={busy} onClick={() => { setInput({ ...input, sourceRefs: input.sourceRefs.filter((value) => value.id !== ref.id) }); setSources(sources.filter((value) => value.id !== ref.id)); }}>移除此引用</button>}</article>;
    })}{!input.sourceRefs.length && <p className="muted">未关联来源。可保存未完成草稿，但提交前需教育说明、安全边界和至少一条原文定位。</p>}</section>
    {!readOnly && <SourcePicker session={session} picked={picked} disabled={busy} />}
    <AssistantPanel key={retry} item={item} session={session} sources={sources} readOnly={readOnly} disabled={saving} adopt={adopt} adoptProposal={adoptProposal} input={input} lockVersion={current?.lockVersion || 0} onActivity={setAssistantActivity} />
    <div className="workflow-actions"><button className="primary" onClick={update} disabled={readOnly || busy || (!dirty && !!current)}>保存内容草稿</button><button className="secondary" onClick={submit} disabled={readOnly || busy || dirty || assistantActivity.dirty || !current || current.state !== 'draft'}>提交编辑审阅</button><button className="text-button" onClick={reload} disabled={busy}>重新加载草稿</button></div>
    {feedback && <p role="status" aria-label="内容草稿结果" className="notice">{feedback}</p>}
    {!!detail.tasks.length && <section className="workflow-history"><h3>审阅反馈</h3>{detail.tasks.map((task) => <article key={task.id}><strong>修订 {task.revision} · {({ pending: '待编辑审阅', returned: '退回', accepted: '编辑审阅通过（未发布）' })[task.status]}</strong><p>{task.comment || '等待独立审阅者处理。'}</p><small>{task.reviewedBy || task.submittedBy} · {timestamp(task.reviewedAt || task.submittedAt)}</small></article>)}</section>}
    <section className="workflow-history"><h3>不可变修订历史（最近 20 条）</h3>{detail.revisions.map((revision) => <details key={revision.revision}><summary>修订 {revision.revision} · {revision.author} · {timestamp(revision.createdAt)}</summary><p>{revision.content.educationText || '教育说明未填写'}</p><p className="small muted">安全边界：{revision.content.safetyText || '未填写'}<br />来源版本：{revision.sources.map((source) => `${source.title} v${source.revision}`).join('；') || '无'}<br />{revision.digest}</p></details>)}</section>
  </section>;
}
export function ContentEditor({ session, blocked = false, onActivity }: { session: SessionInfo; blocked?: boolean; onActivity: ActivityHandler }) {
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [data, setData] = useState<IngredientPage | null>(null);
  const [item, setItem] = useState<Ingredient | null>(null); const [activity, setActivity] = useState({ dirty: false, busy: false });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useActivity(activity.dirty, activity.busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    const timer = setTimeout(() => {
      requestDecoded(`/ingredients?q=${encodeURIComponent(query.trim())}&page=${page}&pageSize=8`, session, value => parseIngredientPage(value, { page, pageSize: 8 }), { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setData(value); })
        .catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, session, retry]);
  function choose(value: Ingredient) { if (value.id !== item?.id && confirmLeave(activity)) setItem(value); }
  return <div className="workflow-split"><section className="panel workflow-panel"><h2>选择内容条目</h2><input aria-label="搜索待编辑食材" placeholder="搜索名称、拼音或别名" maxLength={80} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
    {error && <p role="alert" className="notice error">{error}<button disabled={loading} onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
    {loading ? <p role="status">正在读取食材…</p> : error ? <p className="muted">条目列表暂不可用，请重试；已打开的草稿输入仍保留。</p> : data?.items.map((value) => <button className={`workflow-item ${item?.id === value.id ? 'selected' : ''}`} key={value.id} aria-label={`编辑${value.name}内容`} onClick={() => choose(value)} disabled={activity.busy}><strong>{value.name}</strong><span>{value.pinyin} · 历史目录资料</span></button>)}
    {!loading && !error && data && !data.items.length && <p className="muted">没有匹配食材。</p>}<div className="pagination"><span>{loading ? '正在读取条目数量…' : error ? '条目数量暂不可用' : `共 ${data?.total || 0} 条`}</span><div><button className="secondary" disabled={loading || !!error || page === 1} onClick={() => setPage(page - 1)}>上一批条目</button><button className="secondary" disabled={loading || !!error || page * 8 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>下一批条目</button></div></div>
  </section>{item ? <DraftEditor key={item.id} item={item} session={session} blocked={blocked} onActivity={setActivity} /> : <section className="panel workflow-panel empty"><h2>从一个条目开始修订</h2><p>目录快照不会被草稿覆盖。所有新资料保持私有待审。</p></section>}</div>;
}
