import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AssistantMode, AssistantResult, DraftContent, EvidenceExcerpt, ExcerptInput, Ingredient, ManagedSource, SessionInfo } from '../shared/contracts';
import { ApiError, request, requestDecoded, requiresWriteVerification } from './api';
import { matchesExcerptInput, parseExcerptList, parseReloadedExcerpt, parseSavedExcerpt, parseSavedPermission, sameExcerpt } from '../shared/assistant-response';
import { useAssistantRead } from './useAssistantRead';
import { problem, useActivity, type ActivityHandler } from './workflow-shared';
import { isAssistantMode, supportsAssistantMode } from '../shared/assistant-tasks';
import { isAssistantResult } from '../shared/assistant-result';
import type { SummaryProposal as Proposal } from '../shared/assistant-proposal';
import { SummaryProposal } from './SummaryProposal';

const gapLabel = { identity: '身份', edible_part: '实际食用部位', processing: '加工形态', safety_boundary: '安全边界' };
type PendingWrite = { kind: 'save'; input: ExcerptInput; phase: 'unknown' | 'checked' } | { kind: 'permission'; excerpt: EvidenceExcerpt };
const uncertain = (reason: unknown) => requiresWriteVerification(reason) || (reason instanceof ApiError && reason.status >= 500);
export function AssistantPanel({ item, session, sources, readOnly, disabled, adopt, adoptProposal, input, lockVersion, onActivity }: {
  item: Ingredient; session: SessionInfo; sources: ManagedSource[]; readOnly: boolean; disabled: boolean;
  adopt: (result: AssistantResult) => Promise<boolean>; onActivity: ActivityHandler;
  input: DraftContent; lockVersion: number; adoptProposal: (proposal: Proposal) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<AssistantMode>('extract');
  const [query, setQuery] = useState(''); const [sourceKey, setSourceKey] = useState(''); const [locator, setLocator] = useState(''); const [text, setText] = useState('');
  const [allowExternal, setAllowExternal] = useState(false); const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false); const [confirmed, setConfirmed] = useState(false); const [output, setResult] = useState<AssistantResult | null>(null);
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<PendingWrite | null>(null); const pendingRef = useRef<PendingWrite | null>(null);
  const changePending = (value: PendingWrite | null) => { pendingRef.current = value; setPending(value); };
  const gate = useRef(false), lifetime = useRef<AbortController | null>(null);
  const { data, loading, error } = useAssistantRead(session, item.id, query, retry);
  const config = data?.config, quota = data?.quota, items = data?.items || [], ready = !!data && !loading && !error;
  const writeLocked = !!pending && (pending.kind === 'permission' || pending.phase === 'unknown');
  const formLocked = disabled || busy || writeLocked;
  const result = ready && !pending && output && output.citations.every(citation => items.some(current => sameExcerpt(current, citation) &&
    current.externalPermission.allowed && current.externalPermission.revision === citation.externalPermission.revision)) ? output : null;
  useActivity(!!(sourceKey || locator || text || allowExternal || pending), busy, onActivity);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, [item.id, session]);
  function begin() {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || gate.current) return null;
    gate.current = true; setBusy(true); return controller;
  }
  function finish(controller: AbortController) { if (!controller.signal.aborted) { gate.current = false; setBusy(false); } }
  function clearInput() { setSourceKey(''); setLocator(''); setText(''); setAllowExternal(false); }
  function resetResult() { setResult(null); setSelected([]); setConfirmed(false); setConsent(false); }
  function refresh() { if (gate.current) return; setConfirmed(false); setConsent(false); setRetry(value => value + 1); }
  async function save(event: FormEvent) {
    event.preventDefault(); const intent = pendingRef.current;
    if (readOnly || disabled || gate.current || (intent && (intent.kind === 'permission' || intent.phase === 'unknown'))) return;
    const source = sources.find((value) => `${value.id}:${value.revision}` === sourceKey);
    if (!source) { setFeedback('先为草稿选择一个已登记来源，再选择摘录所对应的固定版本。'); return; }
    const controller = begin(); if (!controller) return;
    const previous = pendingRef.current;
    if (previous && !window.confirm('这是新的摘录登记请求。当前未找到记录不代表先前请求永远不会完成，可能产生重复摘录。确认另行提交当前输入吗？')) { finish(controller); return; }
    const input: ExcerptInput = { sourceId: source.id, sourceRevision: source.revision, locator, text, allowExternal };
    setFeedback(''); resetResult();
    try {
      await requestDecoded(`/editorial/assistant/ingredients/${item.id}/excerpts`, session, value => parseSavedExcerpt(value, item.id, input, session.user.username),
        { method: 'POST', body: JSON.stringify(input), signal: controller.signal });
      if (!controller.signal.aborted) { clearInput(); changePending(null); setRetry(value => value + 1); setFeedback('已保存不可变原文摘录，仍为私有待核验资料；未发送给模型。'); }
    } catch (reason) { if (!controller.signal.aborted) { if (uncertain(reason)) changePending({ kind: 'save', input, phase: 'unknown' }); setFeedback(problem(reason)); } }
    finally { finish(controller); }
  }
  function toggle(id: string) {
    if (!ready || disabled || readOnly || gate.current || pendingRef.current || !items.find(value => value.id === id)?.externalPermission.allowed) return;
    if (!selected.includes(id) && selected.length >= 6) { setFeedback('最多选择 6 条摘录。'); return; }
    setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]); setResult(null); setConfirmed(false); setConsent(false);
  }
  async function generate() {
    if (readOnly || disabled || gate.current || pendingRef.current || !ready || !config?.enabled || quotaBlocked || !consent || !supportsAssistantMode(config, mode) ||
      !selected.length || selected.some(id => !items.find(excerpt => excerpt.id === id)?.externalPermission.allowed)) return;
    const controller = begin(); if (!controller) return;
    const evidence = items.filter(value => selected.includes(value.id));
    setFeedback(''); setResult(null); setConfirmed(false);
    try {
      const value = await request<unknown>(`/editorial/assistant/ingredients/${item.id}/generate`, session, { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ evidenceIds: selected, confirmExternalTransfer: consent, mode }) });
      if (!isAssistantResult(value, item.id, mode)) throw new Error('辅助结果格式或引用关联无效，未展示或采用。请重新生成。');
      if (value.citations.some(citation => !evidence.some(source => sameExcerpt(source, citation) && source.externalPermission.allowed &&
        source.externalPermission.revision === citation.externalPermission.revision && citation.externalPermission.allowed))) throw new Error('辅助结果与本次所选摘录或许可版本不一致，未展示或采用。');
      if (!controller.signal.aborted) { setResult(value); setFeedback(value.statements.length ? '辅助结果已返回，尚未改写或保存草稿。请逐条对照原文。' : '资料不足，未生成结论。请补充缺口。'); }
    } catch (reason) { if (!controller.signal.aborted) setFeedback(problem(reason)); }
    finally { if (!controller.signal.aborted) { setConsent(false); setRetry((value) => value + 1); } finish(controller); }
  }
  async function permission(excerpt: EvidenceExcerpt) {
    if (!ready || disabled || gate.current || pendingRef.current || session.user.role === 'reviewer') return;
    const controller = begin(); if (!controller) return;
    const allowed = !excerpt.externalPermission.allowed;
    if (!window.confirm(allowed ? '已核对资料用途与使用权，允许外部模型使用这条摘录吗？这不是专业批准。' : '撤回后阻止后续授权并拒绝在途结果；已发送给外部服务的资料无法追回。继续吗？')) { finish(controller); return; }
    setFeedback(''); resetResult();
    try {
      await requestDecoded(`/editorial/assistant/excerpts/${excerpt.id}/permission`, session, value => parseSavedPermission(value, excerpt, allowed, session.user.username),
        { method: 'PUT', body: JSON.stringify({ allowExternal: allowed, expectedRevision: excerpt.externalPermission.revision }), signal: controller.signal });
      if (!controller.signal.aborted) setFeedback(allowed ? '已登记新的外部使用许可；仍需每次发送确认，不代表专业批准。' : '已撤回外部使用许可。原文和历史保留，已发送资料无法追回。');
    } catch (reason) { if (!controller.signal.aborted) { if (uncertain(reason)) changePending({ kind: 'permission', excerpt }); setFeedback(problem(reason)); } }
    finally { if (!controller.signal.aborted) setRetry(value => value + 1); finish(controller); }
  }
  async function verifyWrite() {
    const intent = pendingRef.current;
    if (!intent || disabled || gate.current) return;
    const controller = begin(); if (!controller) return;
    if (intent.kind === 'save' && !window.confirm('读取匹配摘录；如果已有相同记录，将清空本次表单以免重复登记。这只能说明当前存在记录，不能证明先前提交归属或取消在途请求。继续吗？')) { finish(controller); return; }
    try {
      if (intent.kind === 'save') {
        const query = intent.input.locator.trim().slice(0, 80);
        const records = await requestDecoded(`/editorial/assistant/ingredients/${item.id}/excerpts?q=${encodeURIComponent(query)}`, session,
          value => parseExcerptList(value, item.id), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (records.items.some(value => matchesExcerptInput(value, intent.input, session.user.username))) {
          const unchanged = sourceKey === `${intent.input.sourceId}:${intent.input.sourceRevision}` && locator.trim() === intent.input.locator.trim() && text.trim() === intent.input.text.trim() && allowExternal === intent.input.allowExternal;
          if (unchanged) clearInput(); changePending(null);
          setFeedback(unchanged ? '当前存在相同的私有摘录，已清空本次表单；未重复提交，不能证明原请求归属。' : '当前存在先前输入对应的私有摘录；已保留后来编辑的新输入，未重复提交，不能证明原请求归属。');
        } else { changePending({ ...intent, phase: 'checked' }); setFeedback('当前检索窗口未找到相同摘录，不代表先前请求没有或不会完成。输入保留，新的登记须单独确认。'); }
      } else {
        await requestDecoded(`/editorial/assistant/ingredients/${item.id}/excerpts/${intent.excerpt.id}`, session,
          value => parseReloadedExcerpt(value, intent.excerpt), { signal: controller.signal });
        if (controller.signal.aborted) return;
        changePending(null); setFeedback('已读取当前许可版本；这不能归因先前请求。未重发许可修改，再次修改仍需单独确认。');
      }
      setRetry(value => value + 1); resetResult();
    } catch (reason) { if (!controller.signal.aborted) { if (intent.kind === 'save') changePending({ ...intent, phase: 'unknown' }); setFeedback(problem(reason)); } }
    finally { finish(controller); }
  }
  const quotaBlocked = !quota || !quota.policyMatches || quota.usedTotal >= quota.limits.dailyTotal || quota.usedByActor >= quota.limits.dailyPerActor || quota.activeTotal >= quota.limits.concurrentTotal || quota.activeByActor >= quota.limits.concurrentPerActor;
  async function apply() {
    if (!result || result.mode === 'review' || !confirmed || disabled || readOnly || pendingRef.current) return;
    const controller = begin(); if (!controller) return; setFeedback('');
    try {
      for (const citation of result.citations) {
        const current = await requestDecoded(`/editorial/assistant/ingredients/${item.id}/excerpts/${citation.id}`, session,
          value => parseReloadedExcerpt(value, citation), { signal: controller.signal });
        if (!current.externalPermission.allowed || current.externalPermission.revision !== citation.externalPermission.revision) throw new Error('摘录外发许可已变化，未采用旧结果；请重新核对原文。');
      }
      if (controller.signal.aborted) return;
      const adopted = await adopt(result);
      if (!controller.signal.aborted) { setConfirmed(false); setFeedback(adopted ? '已填入当前私有编辑输入，尚未保存或提交审阅。' : '已取消采用，当前草稿输入未改变。'); }
    }
    catch (reason) { if (!controller.signal.aborted) setFeedback(problem(reason)); }
    finally { finish(controller); }
  }
  async function applyProposal(proposal: Proposal) {
    if (disabled || readOnly || pendingRef.current || result?.id !== proposal.resultId || result.mode !== 'summary') return false;
    const controller = begin(); if (!controller) return false;
    try { return await adoptProposal(proposal); }
    finally { finish(controller); }
  }
  return <section className="assistant-panel" aria-label="有来源的编辑辅助"><h3>原文摘录与 AI 编辑辅助</h3>
    <p className="notice">只整理身份、部位和加工形态，不生成医疗建议。摘录是录入者声明的原文，仍需核验身份、出处与权利；外部许可不代表专业批准。</p>
    {!readOnly && <label className="workflow-form">辅助任务<select aria-label="辅助任务类型" value={mode} disabled={disabled || busy || !!pending} onChange={(event) => { if (isAssistantMode(event.target.value)) setMode(event.target.value); setResult(null); setConsent(false); setConfirmed(false); setFeedback(''); }}>
      <option value="extract">逐字短句选取</option><option value="summary" disabled={!config || !supportsAssistantMode(config, 'summary')}>有来源的资料摘要草稿</option>
      <option value="review" disabled={!config || !supportsAssistantMode(config, 'review')}>资料缺口与来源分歧检查</option>
    </select></label>}
    {mode === 'summary' && <p className="notice">摘要是模型改写，不是原文。系统核对引用和格式，但不能证明语义完全正确；请检查否定、限定条件和来源分歧。安全性仍是未审核缺口。</p>}
    {mode === 'review' && <p className="notice">检查仅针对本次选中的摘录，不代表完整资料。候选和分歧都需对照原文核实；检查结果不会填入草稿，也不作安全审核。</p>}
    {!readOnly && <details><summary>登记新原文摘录</summary><form className="workflow-form" onSubmit={save}>
      <label>固定来源版本<select aria-label="摘录固定来源" value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} disabled={formLocked} required><option value="">请选择草稿已关联的来源</option>{sources.map((source) => <option key={source.id} value={`${source.id}:${source.revision}`}>{source.title} · v{source.revision}</option>)}</select></label>
      <label>原文位置<input aria-label="摘录原文定位" value={locator} maxLength={400} onChange={(event) => setLocator(event.target.value)} disabled={formLocked} required /></label>
      <label>原文摘录<textarea aria-label="原文摘录文本" value={text} maxLength={1800} onChange={(event) => setText(event.target.value)} disabled={formLocked} placeholder="手动摘录已获准使用的原文；不填写健康档案、联系方式或个人身份资料。" required /></label>
      <label className="assistant-check"><input type="checkbox" checked={allowExternal} onChange={(event) => setAllowExternal(event.target.checked)} disabled={formLocked} />我已核对用途与权限，允许这条摘录用于外部模型辅助（默认关闭）</label>
      <button className="secondary" disabled={formLocked}>保存私有摘录</button>
    </form></details>}
    {pending && <p className="notice error">{pending.kind === 'save' ? '摘录登记结果仍需核对，输入保留；修改检索或普通刷新不会重发登记。' : '外发许可修改结果仍需核对，已暂停相关操作，不会自动重发。'}<button className="secondary" onClick={verifyWrite} disabled={disabled || busy}>{pending.kind === 'save' ? '核对摘录保存结果' : '核对外发许可结果'}</button></p>}
    <input aria-label="检索原文摘录" placeholder="按原文或定位检索，最多显示 50 条" maxLength={80} value={query} onChange={(event) => { setQuery(event.target.value); setResult(null); setSelected([]); setConsent(false); }} disabled={busy} />
    {error && <p className="notice error" role="alert">{error} <button className="text-button" disabled={busy} onClick={refresh}>重新读取摘录</button></p>}
    {loading ? <p role="status">正在读取原文摘录…</p> : items.map((excerpt) => <article className="assistant-excerpt" key={excerpt.id}>
      <label className="assistant-check"><input type="checkbox" aria-label={`选择摘录 ${excerpt.locator}`} checked={selected.includes(excerpt.id)} onChange={() => toggle(excerpt.id)} disabled={readOnly || disabled || busy || !!pending || !ready || !excerpt.externalPermission.allowed} /><strong>{excerpt.locator}</strong></label>
      <p>{excerpt.text}</p><small>固定版本 {excerpt.sourceRevision} · {excerpt.externalPermission.allowed ? '当前允许外部使用' : '仅本地查阅，不允许外部发送'} · 许可修订 {excerpt.externalPermission.revision} · 待核验</small>
      {session.user.role !== 'reviewer' && (session.user.role === 'admin' || session.user.username === excerpt.recordedBy) && <button className="text-button" disabled={disabled || busy || !!pending || !ready} aria-label={`${excerpt.externalPermission.allowed ? '撤回外部许可' : '允许外部使用'} ${excerpt.locator}`} onClick={() => void permission(excerpt)}>{excerpt.externalPermission.allowed ? '撤回外部许可' : '允许外部使用'}</button>}
    </article>)}
    {ready && !items.length && <p className="muted">没有匹配摘录。只有网址不能证明原文内容，辅助器不会据此补写结论。</p>}
    <p className="small muted" aria-label="模型服务状态">{loading ? '正在核对模型服务状态…' : !ready ? '模型服务状态暂不可用，外部调用已暂停。' : config?.enabled ? `${config.simulated ? '测试模拟器（非真实模型）' : '真实模型已配置'} · ${config.model}` : '真实模型未配置，原文检索可用，外部调用关闭。'}</p>
    {quota && <p className="small muted" aria-label="辅助调用额度">{quota.day}（UTC）· 全库已授权 {quota.usedTotal}/{quota.limits.dailyTotal} 次 · 当前账号 {quota.usedByActor}/{quota.limits.dailyPerActor} 次。失败或取消不退额度，不是费用账单。{!quota.policyMatches && ' 服务实例额度配置不一致，已阻止调用。'}<button className="text-button" onClick={refresh} disabled={busy}>刷新调用额度</button></p>}
    {!readOnly && <><label className="assistant-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={disabled || busy || !!pending || !ready || !config?.enabled} />{!ready ? '服务状态未核对，暂不能确认发送' : config?.simulated ? '确认本次模拟整理（不调用外部模型）' : '确认将选中摘录与来源标题发送给配置的外部模型，可能产生费用'}</label>
      <button className="secondary" onClick={generate} disabled={disabled || busy || !!pending || !ready || quotaBlocked || !config?.enabled || !supportsAssistantMode(config, mode) || !selected.length || !consent || selected.some((id) => !items.find((excerpt) => excerpt.id === id)?.externalPermission.allowed)}>{busy ? '正在处理…' : mode === 'review' ? '检查资料缺口与来源分歧' : mode === 'summary' ? '生成有来源的摘要草稿' : '整理所选原文摘录'}</button></>}
    {result && <div className="assistant-result"><h4>{result.simulated ? '测试模拟结果 · 不代表真实 AI 验收' : result.mode === 'review' ? '资料检查结果 · 待人工核对' : result.mode === 'summary' ? '模型资料摘要草稿 · 待人工核对' : '模型选取的原文短句 · 待人工核对'}</h4>
      {result.mode === 'review' && <div className="assistant-findings" aria-label="资料缺口与来源分歧检查结果">{result.findings.map((finding) => <article key={finding.field} data-kind={finding.kind}>
        <strong>{gapLabel[finding.field]} · {{ candidate: '资料候选', gap: '信息缺口', conflict: '来源分歧' }[finding.kind]}</strong><p>{finding.text}</p>
        <small>{finding.evidenceIds.length ? `原文依据：${finding.evidenceIds.map((id) => `资料 ${result.statements.findIndex((statement) => statement.evidenceId === id) + 1}`).join('、')}` : '选中摘录缺少相应说明，需补充资料。'}</small>
      </article>)}<p className="small muted">引用关联不证明含义正确。请核对来源、限定条件和真实分歧；此结果不自动修改草稿。</p></div>}
      {result.mode === 'summary' && <div aria-label="有来源的摘要段落">{result.sections.map((section) => <article key={section.field}><strong>{gapLabel[section.field]}</strong><p>{section.text}</p><small>原文依据：{section.evidenceIds.map((id) => `资料 ${result.statements.findIndex((statement) => statement.evidenceId === id) + 1}`).join('、')}</small></article>)}<p className="small muted">摘要的依据关联已核对，但改写准确性、分歧与限定条件仍需人工核验。</p></div>}
      {result.statements.map((statement) => { const source = result.citations.find((citation) => citation.id === statement.evidenceId)!;
        const title = sources.find((item) => item.id === source.sourceId && item.revision === source.sourceRevision)?.title || source.sourceId;
        return <blockquote key={statement.evidenceId}><p>{statement.quote}</p><small>{result.mode !== 'extract' && `资料 ${result.statements.indexOf(statement) + 1} · `}{title} · {source.locator} · 固定版本 {source.sourceRevision}</small></blockquote>; })}
      <p>模型提示的资料缺口：{result.gaps.map((gap) => gapLabel[gap]).join('、') || '未报告；不代表资料已完整'}</p>
      <p className="small muted">耗时 {result.metrics.durationMs} ms · 输入/输出 token：{result.metrics.inputTokens ?? '未知'}/{result.metrics.outputTokens ?? '未知'} · 估计费用：{result.metrics.estimatedCostUsd === null ? '未知，不按免费记账' : `$${result.metrics.estimatedCostUsd.toFixed(6)}`}</p>
      {!readOnly && result.mode === 'summary' && !!result.sections.length && <SummaryProposal key={result.id} result={result} input={input} lockVersion={lockVersion} disabled={disabled || busy} adopt={applyProposal} />}
      {!readOnly && result.mode === 'extract' && !!result.statements.length && <><label className="assistant-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={disabled || busy} />我已逐条对照原文，仅作为私有编辑参考，不是专业批准</label><button className="secondary" disabled={!confirmed || disabled || busy} onClick={apply}>将核对摘录填入编辑输入（不自动保存）</button></>}
    </div>}
    {feedback && <p className="notice" role="status" aria-label="摘录辅助结果">{feedback}</p>}
  </section>;
}
