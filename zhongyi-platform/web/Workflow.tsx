import { useState } from 'react';
import type { SessionInfo, WorkflowEvent } from '../shared/contracts';
import { useDecodedReadResult } from './useReadResult';
import { parseWorkflowEventList } from '../shared/workbench-response';
import { ContentEditor } from './ContentEditor';
import { ReviewQueue } from './ReviewQueue';
import { Sources } from './Sources';
import { ProfessionalReviewPanel } from './ProfessionalReview';
import { SourceChecks } from './SourceChecks';
import { PublicationPanel } from './Publication';
import { confirmLeave, timestamp, useActivity, type ActivityHandler } from './workflow-shared';

const eventLabel = (action: WorkflowEvent['action']) => ({ source_created: '登记来源', source_updated: '来源新版本', draft_saved: '保存内容修订', draft_submitted: '提交编辑审阅', review_returned: '退回修改', review_accepted: '编辑审阅通过（未发布）' })[action];
function WorkflowHistory({ session }: { session: SessionInfo }) {
  const read = useDecodedReadResult('/editorial/events', session, parseWorkflowEventList, 0, 0);
  return <section className="panel workflow-panel"><div className="workflow-toolbar"><h2>最近内容协作记录</h2><button className="secondary" disabled={read.loading} onClick={read.retry}>刷新协作记录</button></div>{read.error && <p className="notice error" role="alert">协作记录暂不可用，不代表没有历史。{read.error}</p>}
    {read.loading && <p role="status">正在读取记录…</p>}{!read.loading && !read.error && read.data && <div className="table-scroll"><table aria-label="内容协作记录"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>修订</th></tr></thead><tbody>{read.data.items.map((event) => <tr key={event.id}><td>{timestamp(event.createdAt)}</td><td>{event.actor}</td><td>{eventLabel(event.action)}</td><td>{event.ingredientId || event.sourceId}</td><td>{event.revision}</td></tr>)}</tbody></table>{!read.data.items.length && <p className="muted">尚无协作记录。</p>}</div>}</section>;
}
export function Workflow({ session, blocked = false, onActivity }: { session: SessionInfo; blocked?: boolean; onActivity: ActivityHandler }) {
  const [tab, setTab] = useState<'content' | 'sources' | 'reviews' | 'professional' | 'sourceChecks' | 'publication' | 'history'>('content'); const [activity, setActivity] = useState({ dirty: false, busy: false });
  useActivity(activity.dirty, activity.busy, onActivity);
  const labels = { content: '内容修订', sources: '来源登记', reviews: '编辑审阅任务', professional: '专业审校记录', sourceChecks: '来源核验与发布检查', publication: '固定版本发布', history: '协作记录' };
  return <section className="workflow"><p className="notice workflow-boundary">内部内容治理：编辑审阅、专业审校记录与发布批准相互独立；新草稿默认私有，只有完成独立批准并明确发布的固定版本才可能公开。后台角色不代表医疗专业资质。</p><nav className="workflow-tabs" aria-label="内容协作导航">{(Object.keys(labels) as (keyof typeof labels)[]).map((value) => <button className={tab === value ? 'secondary active' : 'secondary'} key={value} disabled={activity.busy} onClick={() => { if (tab !== value && confirmLeave(activity)) setTab(value); }}>{labels[value]}</button>)}</nav>
    {tab === 'content' ? <ContentEditor session={session} blocked={blocked} onActivity={setActivity} /> : tab === 'sources' ? <Sources session={session} onActivity={setActivity} /> : tab === 'reviews' ? <ReviewQueue session={session} onActivity={setActivity} /> : tab === 'professional' ? <ProfessionalReviewPanel session={session} onActivity={setActivity} /> : tab === 'sourceChecks' ? <SourceChecks session={session} onActivity={setActivity} /> : tab === 'publication' ? <PublicationPanel session={session} onActivity={setActivity} /> : <WorkflowHistory session={session} />}
  </section>;
}
