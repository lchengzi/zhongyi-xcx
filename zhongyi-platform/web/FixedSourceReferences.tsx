import type { ContentRevision } from '../shared/contracts';
import { fixedSourceReferences } from './fixed-source-references';
import { timestamp } from './workflow-shared';

export function FixedSourceReferences({ snapshot, title }: { snapshot: ContentRevision; title: string }) {
  return <section className="draft-sources fixed-source-references"><h3>{title}</h3>
    <p className="small muted">以下为正文绑定的固定来源登记，不代表当前来源核验已通过；录入时间不是原文发布日期。</p>
    {fixedSourceReferences(snapshot.content.sourceRefs, snapshot.sources).map(({ ref, source }, index) =>
      <article className="draft-source" aria-label={`固定来源 ${index + 1}`} key={`${ref.id}:${ref.revision}:${index}`}>
        {source ? <><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} · 版本 {ref.revision}</a>
          <p>发布机构：{source.publisher}</p><p className="small muted">记录人：{source.recordedBy} · 录入：{timestamp(source.recordedAt)}</p></>
          : <p className="notice error" role="alert">无法唯一匹配此固定来源，不展示替代出处。请重新读取并核对来源编号与修订号。</p>}
        <p className="small muted">来源编号：{ref.id} · 固定修订 {ref.revision}</p>
        <p className="source-locator">原文定位：{ref.locator || '未填写，请核对'}</p>
      </article>)}
    {!snapshot.content.sourceRefs.length && <p className="muted">尚未引用固定来源；不能据此确认资料已有依据。</p>}
  </section>;
}
