import { Button, View } from '@tarojs/components';
import type { EducationState } from '@food-education/catalog-core';
import { Section, Fact } from './page';
import { copySourceUrl } from '../platform/feedback';

export function EducationSection({ state, onRefresh, canInteract }: { state: EducationState; onRefresh: () => void; canInteract: () => boolean }) {
  if (state.status === 'disabled') return null;
  const document = state.document;
  const message = state.status === 'loading' ? '正在核对更新…'
    : state.status === 'withdrawn' ? '目前没有可用的补充资料，下方基础档案仍可查阅。'
    : state.status === 'incompatible' ? '更新资料暂时无法核对，未替换基础档案。'
    : state.status === 'stale' ? '连接暂时中断，以下为刚才核对的资料，过期后会收起。'
    : state.status === 'unavailable' ? '补充资料暂时无法读取，下方基础档案仍可查阅。' : '';
  return <Section title='补充资料' caption={document ? `发布版本 ${document.snapshotVersion}` : ''}>
    {message && <View className='reading-note' role='status'>{message}</View>}
    {document && <>
      <Fact label='记录部位' value={document.ediblePart} />
      {document.latinName && <Fact label='来源学名' value={document.latinName} />}
      <View className='reading-copy'>{document.educationText}</View>
      <View className='reading-copy'>{document.safetyText}</View>
      <Fact label='发布时间' value={document.publishedAt.slice(0, 10)} />
      {document.sources.map((source, index) => <View className='source' key={`${index}-${source.url}`}>
        <View className='source__title'>{source.title}</View>
        <View className='source__meta'>{source.publisher} · {source.locator}</View>
        <View className='source__meta'>核对记录 {source.checkedAt.slice(0, 10)}</View>
        <Button className='button button--text' onClick={() => { if (canInteract()) void copySourceUrl(source.url); }}>复制来源链接 ↗</Button>
      </View>)}
      <View className='reading-note'>补充资料单独保留发布版本，不改变当前安全提示与基础档案的审校状态。</View>
    </>}
    <Button className='button button--text' disabled={state.status === 'loading'} onClick={onRefresh}>{state.status === 'loading' ? '正在核对' : '重新核对更新'}</Button>
  </Section>;
}
