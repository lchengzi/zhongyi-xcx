import { useEffect, useRef, useState } from 'react';
import type { AssistantResult, DraftContent, SummaryField } from '../shared/contracts';
import { buildSummaryProposal, matchesProposal, summaryLabels, type SummaryProposal as Proposal } from '../shared/assistant-proposal';
import { problem } from './workflow-shared';

export function SummaryProposal({ result, input, lockVersion, disabled, adopt }: {
  result: AssistantResult; input: DraftContent; lockVersion: number; disabled: boolean;
  adopt: (proposal: Proposal) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<SummaryField[]>(result.sections.map((section) => section.field));
  const [strategy, setStrategy] = useState<'append' | 'replace'>('append');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const pending = useRef(false);
  // Reverting an edit must not revive an earlier human confirmation.
  useEffect(() => { setConfirmed(false); }, [input, lockVersion]);
  const stale = !!proposal && !matchesProposal(proposal, result.ingredientId, input, lockVersion);
  function preview() {
    setConfirmed(false); setFeedback('');
    try { setProposal(buildSummaryProposal(result, input, lockVersion, fields, strategy)); }
    catch (error) { setProposal(null); setFeedback(problem(error)); }
  }
  async function apply() {
    if (!proposal || stale || !confirmed || disabled || busy || pending.current) return;
    pending.current = true;
    setBusy(true); setFeedback('');
    try { if (await adopt(proposal)) { setProposal(null); setFeedback('已采用所选建议，尚未保存。请检查编辑输入，再保存草稿。'); } }
    catch (error) { setFeedback(problem(error)); }
    finally { pending.current = false; setBusy(false); setConfirmed(false); }
  }
  return <section className="summary-proposal" aria-label="编辑修改建议"><h4>整理修改建议</h4>
    <p className="small muted">按已返回的摘要在本机整理，不再次调用模型，也不发送当前草稿。请先核对原文、语义和限定条件。</p>
    <fieldset disabled={disabled || busy}><legend>选择需要采用的摘要段落</legend>{result.sections.map((section) => <label className="assistant-check" key={section.field}>
      <input type="checkbox" checked={fields.includes(section.field)} onChange={() => { setFields(fields.includes(section.field) ? fields.filter((field) => field !== section.field) : [...fields, section.field]); setProposal(null); setConfirmed(false); }} />{summaryLabels[section.field]}</label>)}
      <label>处理方式<select aria-label="建议处理方式" value={strategy} onChange={(event) => { if (event.target.value === 'append' || event.target.value === 'replace') setStrategy(event.target.value); setProposal(null); setConfirmed(false); }}><option value="append">保留原文，追加所选摘要</option><option value="replace">替换教育说明</option></select></label>
      <button className="secondary" disabled={!fields.length} onClick={preview}>预览修改差异</button>
    </fieldset>
    {proposal && <div aria-label="修改差异预览"><div className="proposal-diff"><article><h5>当前教育说明</h5><p aria-label="建议采用前">{proposal.before.educationText || '未填写'}</p></article><article><h5>建议教育说明</h5><p aria-label="建议采用后">{proposal.after.educationText}</p></article></div>
      <h5>本次使用的原文依据</h5>{proposal.citations.map((citation) => <blockquote key={citation.id}><p>{citation.text}</p><small>{citation.locator} · 固定来源版本 {citation.sourceRevision}</small></blockquote>)}
      <h5>采用后的固定来源定位</h5>{proposal.after.sourceRefs.map((ref) => <p className="small muted" key={ref.id}>{ref.id} · v{ref.revision} · {ref.locator || '未填写'}</p>)}
      <p className="small muted">部位、拉丁名和安全边界保持原样。替换不会删除既有来源；不再适用的引用需人工整理。</p>
      {stale && <p className="notice error" role="alert">草稿输入或版本已变化，请重新预览后再采用。</p>}
      <label className="assistant-check"><input type="checkbox" checked={confirmed && !stale} disabled={disabled || busy || stale} onChange={(event) => setConfirmed(event.target.checked)} />我已核对修改差异与原文依据，确认采用所选建议</label>
      <div className="workflow-actions"><button className="secondary" disabled={disabled || busy || stale || !confirmed} onClick={apply}>采用所选修改（不自动保存）</button><button className="text-button" disabled={disabled || busy} onClick={() => { setProposal(null); setConfirmed(false); setFeedback('已取消建议，草稿输入未改变。'); }}>取消本次建议</button></div>
    </div>}
    {feedback && <p role="status" aria-label="修改建议结果" className="notice">{feedback}</p>}
  </section>;
}
