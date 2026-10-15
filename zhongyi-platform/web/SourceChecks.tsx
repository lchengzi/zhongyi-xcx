import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionInfo, SourceCheckDetail, SourceCheckInput, SourceDomain } from '../shared/contracts';
import { parseIngredientPage, parseSourcePage } from '../shared/workflow-response';
import { parsePublicationPreflight, parseSavedSourceCheck, parseSourceCheckDetail } from '../shared/source-check-response';
import { requestDecoded, requiresWriteVerification } from './api';
import { useDecodedReadResult } from './useReadResult';
import { confirmLeave, problem, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

const domains: Record<SourceDomain, string> = { identity: '身份依据', edible_part: '食用部位', processing: '加工形态', safety_boundary: '安全边界', directory_scope: '目录适用范围' };
const initial = (): SourceCheckInput => ({ sourceRevision: 1, sourceDigest: '', decision: 'verified', evidenceKind: 'manual-check', ingredientIds: [], domains: [], authority: 'reference', checkedAt: `${new Date().toISOString().slice(0, 16)}:00.000Z`, validUntil: '', evidenceReference: '', comment: '', verificationConfirmed: false });
const utc = (value: string) => value ? `${value}:00.000Z` : '';
const labels = { pending: '尚未核验', verified: '已记录人工核验', returned: '核验退回', revoked: '核验已撤销', expired: '查证已过复核期', invalidated: '核验权限或依据失效', recorded: '仅工程测试核验' };
const sourcePicker = (value: unknown) => parseSourcePage(value, { page: 1, pageSize: 5 });
const ingredientPicker = (value: unknown) => parseIngredientPage(value, { page: 1, pageSize: 5 });

function SourceCheckForm({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  const [query, setQuery] = useState(''); const [target, setTarget] = useState<{ id: string; revision: number; title: string } | null>(null);
  const [detail, setDetail] = useState<SourceCheckDetail | null>(null); const [input, setInput] = useState(initial); const [baseline, setBaseline] = useState(input);
  const [ingredientQuery, setIngredientQuery] = useState('');
  const [names, setNames] = useState<Record<string, string>>({}); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState(''); const [retry, setRetry] = useState(0);
  const writeGuard = useRef<'idle' | 'writing' | 'verify'>('idle'); const [verificationRequired, setVerificationRequired] = useState(false);
  const sources = useDecodedReadResult(`/editorial/sources?q=${encodeURIComponent(query.trim())}&pageSize=5`, session, sourcePicker, retry);
  const ingredients = useDecodedReadResult(`/ingredients?q=${encodeURIComponent(ingredientQuery.trim())}&pageSize=5`, session, ingredientPicker, retry);
  const dirty = JSON.stringify(input) !== JSON.stringify(baseline) || verificationRequired; const readOnly = session.user.role === 'editor'; useActivity(dirty, busy || loading, onActivity);
  useEffect(() => {
    const items = ingredients.data?.items;
    if (items) setNames((prior) => ({ ...prior, ...Object.fromEntries(items.map((item) => [item.id, item.name])) }));
  }, [ingredients.data]);
  useEffect(() => {
    if (!target) return; const controller = new AbortController(); setLoading(true); setError('');
    requestDecoded(`/editorial/source-checks/${target.id}/${target.revision}`, session, value => parseSourceCheckDetail(value, target), { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      const latest = value.latest;
      const next: SourceCheckInput = latest ? { sourceRevision: target.revision, sourceDigest: value.sourceDigest, decision: 'verified', evidenceKind: latest.evidenceKind, ingredientIds: latest.ingredientIds,
        domains: latest.domains, authority: latest.authority, checkedAt: latest.checkedAt, validUntil: latest.validUntil, evidenceReference: latest.evidenceReference, comment: '', verificationConfirmed: false }
        : { ...initial(), sourceRevision: target.revision, sourceDigest: value.sourceDigest };
      setDetail(value); setInput(next); setBaseline(next); writeGuard.current = 'idle'; setVerificationRequired(false);
    }).catch((reason) => { if (!controller.signal.aborted) setError(problem(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target, session, retry]);
  function reload() { if (confirmLeave({ dirty, busy: busy || loading })) { setFeedback(''); setRetry((value) => value + 1); } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!target || !detail || readOnly || busy || loading || error || writeGuard.current !== 'idle') return;
    writeGuard.current = 'writing'; setBusy(true); setFeedback('');
    try {
      const value = await requestDecoded(`/editorial/source-checks/${target.id}`, session, value => parseSavedSourceCheck(value, detail, input, session), { method: 'POST', body: JSON.stringify({ check: input, expectedVersion: detail.checkVersion }) });
      const next = { ...input, comment: '', verificationConfirmed: false }; setDetail(value); setInput(next); setBaseline(next);
      setFeedback('已追加私有来源核验记录，未发布内容；工程测试不能作为真实来源核验。');
    } catch (reason) {
      if (requiresWriteVerification(reason)) { writeGuard.current = 'verify'; setVerificationRequired(true); }
      setFeedback(problem(reason));
    } finally { if (writeGuard.current === 'writing') writeGuard.current = 'idle'; setBusy(false); }
  }
  function toggle(domain: SourceDomain) { setInput({ ...input, domains: input.domains.includes(domain) ? input.domains.filter((item) => item !== domain) : [...input.domains, domain] }); }
  const current = !!detail && !loading && !busy && !error && !verificationRequired;
  return <section className="panel workflow-panel professional-panel"><div className="workflow-toolbar"><h2>固定来源核验</h2><button className="secondary" onClick={reload} disabled={busy || loading}>刷新来源核验</button></div>
    <p className="notice">核验登记与专业审校、发布批准分开。请实际核对出处、适用范围和原文；软件不会访问或认证来源网页。核验不授予照片、整方或原文转载权，只填写内部依据编号，不上传证件或健康资料。</p>
    <label>搜索待核验来源<input aria-label="搜索待核验来源" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} /></label>
    {sources.loading && <p role="status">正在读取待核验来源…</p>}{sources.error && <p role="alert" className="notice error">来源查询暂不可用。{sources.error}<button className="text-button" onClick={sources.retry}>重试待核验来源</button></p>}
    <div className="source-choices">{!sources.loading && !sources.error && sources.data?.items.map((source) => <button key={source.id} className="secondary" disabled={busy || loading} onClick={() => { if (confirmLeave({ dirty, busy: busy || loading })) { setTarget({ id: source.id, revision: source.revision, title: source.title }); setDetail(null); setFeedback(''); } }}>核验{source.title}</button>)}</div>
    {!sources.loading && !sources.error && sources.data && !sources.data.items.length && <p className="muted">暂无匹配来源；可先在来源登记中录入。</p>}{error && <p role="alert" className="notice error">来源核验状态暂不可用，不能确认当前核验。{error}</p>}{loading && <p role="status">正在读取固定来源与核验历史…</p>}
    {target && <><p aria-label="核验当前来源">已选择来源：{target.title}；搜索不改变核验对象，当前效力以成功读取的状态为准。</p><label>查看来源修订<input aria-label="查看来源修订" type="number" min={1} value={target.revision} disabled={busy || loading} onChange={(e) => { const revision = Number(e.target.value); if (Number.isSafeInteger(revision) && revision > 0 && confirmLeave({ dirty, busy: busy || loading })) { setDetail(null); setTarget({ ...target, revision }); } }} /></label></>}
    {detail && <>{current && <><p className="notice" aria-label="来源核验状态">{labels[detail.state]} · 固定来源修订 {detail.source.revision} · 私有</p><a href={detail.source.url} target="_blank" rel="noopener noreferrer">{detail.source.title}</a><p>{detail.source.publisher}</p><p className="small muted">{detail.sourceDigest}</p></>}
      <form className="workflow-form" onSubmit={save}><fieldset className="workflow-fields professional-fields" disabled={readOnly || busy || loading || !!error || verificationRequired}>
        <label>核验决定<select aria-label="核验决定" value={input.decision} onChange={(e) => setInput({ ...input, decision: e.target.value as SourceCheckInput['decision'] })}><option value="verified">记录核验通过</option><option value="return">退回核验</option><option value="revoke">撤销核验</option></select></label>
        <label>核验依据类型<select aria-label="来源核验依据类型" value={input.evidenceKind} onChange={(e) => setInput({ ...input, evidenceKind: e.target.value as SourceCheckInput['evidenceKind'] })}><option value="manual-check">人工查证（需实际依据）</option><option value="test-fixture">工程测试（不能用于发布）</option></select></label>
        <label>来源类别<select aria-label="来源类别" value={input.authority} onChange={(e) => setInput({ ...input, authority: e.target.value as SourceCheckInput['authority'] })}><option value="reference">参考资料</option><option value="research">原始研究</option><option value="official">官方资料（需人工查证）</option></select></label>
        <label>核验依据编号<input aria-label="来源核验依据编号" required maxLength={200} value={input.evidenceReference} onChange={(e) => setInput({ ...input, evidenceReference: e.target.value })} /></label>
        <label>实际查证时间（UTC）<input aria-label="实际查证时间UTC" type="datetime-local" required value={input.checkedAt.slice(0, 16)} onChange={(e) => setInput({ ...input, checkedAt: utc(e.target.value) })} /></label>
        <label>下次复核截止（UTC）<input aria-label="来源复核截止UTC" type="datetime-local" required value={input.validUntil.slice(0, 16)} onChange={(e) => setInput({ ...input, validUntil: utc(e.target.value) })} /></label>
        <div><h3>适用食材范围</h3><label>查找适用食材<input aria-label="查找适用食材" value={ingredientQuery} maxLength={80} onChange={(e) => setIngredientQuery(e.target.value)} /></label>
          {ingredients.loading && <p role="status">正在读取核验范围食材…</p>}{ingredients.error && <p role="alert" className="notice error">范围食材查询暂不可用。{ingredients.error}<button type="button" className="text-button" onClick={ingredients.retry}>重试核验范围食材</button></p>}
          <div className="source-choices">{!ingredients.loading && !ingredients.error && ingredients.data?.items.map((item) => <button key={item.id} type="button" className="secondary" disabled={input.ingredientIds.includes(item.id)} onClick={() => setInput({ ...input, ingredientIds: [...input.ingredientIds, item.id] })}>加入{item.name}核验范围</button>)}</div>
          {!ingredients.loading && !ingredients.error && ingredients.data && !ingredients.data.items.length && <p className="muted">没有匹配的核验范围食材。</p>}
          {input.ingredientIds.map((id) => <button type="button" className="secondary" key={id} onClick={() => setInput({ ...input, ingredientIds: input.ingredientIds.filter((item) => item !== id) })}>移除{names[id] || id}范围</button>)}
        </div><div><h3>原文可支持的信息</h3>{(Object.keys(domains) as SourceDomain[]).map((domain) => <label className="assistant-check" key={domain}><input type="checkbox" aria-label={domains[domain]} checked={input.domains.includes(domain)} onChange={() => toggle(domain)} />{domains[domain]}</label>)}</div>
        <label>来源核验说明<textarea aria-label="来源核验说明" required maxLength={1000} value={input.comment} onChange={(e) => setInput({ ...input, comment: e.target.value })} /></label>
        <label className="assistant-check"><input aria-label="确认已核对来源依据" type="checkbox" checked={input.verificationConfirmed} onChange={(e) => setInput({ ...input, verificationConfirmed: e.target.checked })} />我已核对相应依据；工程测试不代表真实来源查证。</label>
        <button className="primary" disabled={!dirty || !input.ingredientIds.length || !input.domains.length || (input.decision === 'verified' && !input.verificationConfirmed)}>保存来源核验</button>
      </fieldset></form>{readOnly && <p className="notice">编辑可查看，不能核验来源。来源整理者也不能自行核验。</p>}
      {current && <div className="workflow-history"><h3>最近来源核验记录</h3>{detail.checks.map((item) => <article key={item.version}><strong>核验 {item.version} · 来源修订 {item.sourceRevision} · {item.decision === 'verified' ? '记录通过' : item.decision === 'return' ? '退回' : '撤销'}</strong><p>{item.evidenceKind === 'test-fixture' ? '工程测试，不能用于发布' : '人工查证记录（非系统认证）'} · {item.evidenceReference}</p><p>{item.comment}</p><small>{item.actor} · 查证 {timestamp(item.checkedAt)} · 复核截止 {timestamp(item.validUntil)}</small></article>)}</div>}</>}
    {feedback && <p className="notice" role="status" aria-label="来源核验结果">{feedback}</p>}
  </section>;
}
function PublicationChecks({ session }: { session: SessionInfo }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(''); const [selectedName, setSelectedName] = useState(''); const [retry, setRetry] = useState(0);
  const items = useDecodedReadResult(`/ingredients?q=${encodeURIComponent(query.trim())}&pageSize=5`, session, ingredientPicker, retry);
  const decode = useCallback((value: unknown) => parsePublicationPreflight(value, selected), [selected]);
  const read = useDecodedReadResult(selected ? `/editorial/publication-preflight/${selected}` : null, session, decode, retry, 0);
  const result = read.data;
  const reason = (code: string) => ({ content_missing: '尚无内容草稿', editorial_review_required: '当前正文未通过独立编辑审阅', professional_review_required: '缺少两类有效真人专业意见', education_fields_incomplete: '食用部位、教育说明或安全边界不完整', source_references_required: '缺少固定来源引用', source_checks_required: '引用来源尚有无效或测试核验', source_domains_incomplete: '来源未覆盖必需信息', official_directory_scope_required: '缺少官方目录适用范围依据' })[code] || code;
  return <section className="panel workflow-panel professional-panel"><div className="workflow-toolbar"><h2>发布前资料检查</h2><button className="secondary" disabled={read.loading} onClick={() => setRetry((value) => value + 1)}>刷新发布前检查</button></div>
    <p className="notice">这是必要资料检查，不是发布批准或公开接口。即使资料齐备，本页也不执行发布；还须单独批准固定快照、检查恢复冻结与发布范围，并明确发布。不会把历史目录标为今日最新。</p>
    <label>搜索发布检查食材<input aria-label="搜索发布检查食材" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} /></label>
    {items.loading && <p role="status">正在读取发布检查食材…</p>}{items.error && <p role="alert" className="notice error">食材查询暂不可用。{items.error}<button className="text-button" onClick={items.retry}>重试发布检查食材</button></p>}
    <div className="source-choices">{!items.loading && !items.error && items.data?.items.map((item) => <button className="secondary" key={item.id} disabled={read.loading} onClick={() => { setSelected(item.id); setSelectedName(item.name); if (selected === item.id) read.retry(); }}>检查{item.name}发布资料</button>)}</div>
    {!items.loading && !items.error && items.data && !items.data.items.length && <p className="muted">没有匹配的发布检查食材。</p>}
    {read.loading && <p role="status">正在核对固定版本资料…</p>}{read.error && <p role="alert" className="notice error">发布前资料状态暂不可用，不代表资料齐备或没有资料。{read.error}</p>}
    {!read.loading && !read.error && result && <div aria-label="发布前检查结果"><h3>{selectedName} · 当前选中食材</h3><p className="notice">{result.readyForReleaseApproval ? '必要资料已记录，仍须单独发布批准' : '资料条件未齐备'} · 本页不执行发布</p><p>内容修订 {result.contentRevision || '无'} · 协作版本 {result.lockVersion} · 专业审校版本 {result.professionalReviewVersion}</p>
      {result.reasons.map((code) => <p key={code}>{reason(code)}</p>)}{result.missingDomains.length > 0 && <p>缺失信息：{result.missingDomains.map((domain) => domains[domain]).join('、')}</p>}
      {result.sources.map((source) => <article className="source" key={source.sourceId}><strong>来源修订 {source.sourceRevision} · 核验协作版本 {source.checkVersion} · {source.ready ? '范围匹配' : '待核对'}</strong><p>{source.reasons.includes('source_check_test_fixture') ? '工程测试不能作为发布依据' : source.reasons.includes('source_scope_mismatch') ? '来源核验范围不包含此食材' : source.reasons.length ? '核验缺失、失效或尚未确认' : '已绑定人工核验记录，仍不授予转载权'}</p></article>)}
    </div>}
  </section>;
}
export function SourceChecks({ session, onActivity }: { session: SessionInfo; onActivity: ActivityHandler }) {
  return <div><SourceCheckForm session={session} onActivity={onActivity} /><PublicationChecks session={session} /></div>;
}
