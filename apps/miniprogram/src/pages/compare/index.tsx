import { Button, Switch, Text, View } from '@tarojs/components';
import { assessIngredient, buildComparison, COMPARE_LIMIT, COMPARE_NOTICE, findIngredient } from '@food-education/catalog-core';
import { useRef, useState } from 'react';
import { Page, PageHeading, EmptyState, Notice } from '../../components/page';
import { StorageNotice } from '../../components/storage-notice';
import { catalogResult } from '../../data/catalog';
import { useSelections } from '../../features/selections';
import { usePageInteraction } from '../../platform/lifecycle';
import { openCatalog, openIngredient } from '../../platform/navigation';
import { useSafety } from '../../features/safety';
import { UrgentNotice } from '../../components/safety-notice';
import { IngredientArtwork } from '../../components/ingredient-artwork';
import { useCardPhotos } from '../../features/photos';
import { UnavailableSelections } from '../../components/unavailable-selections';

export default function ComparePage() {
  const canInteract = usePageInteraction();
  const safety = useSafety(canInteract);
  const selections = useSelections(safety.isCurrent);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const differenceGeneration = useRef(0);
  const renderedDifferenceGeneration = differenceGeneration.current;
  const catalog = catalogResult.ok ? catalogResult.catalog : null;
  const ids = selections.compare.status === 'ready' ? selections.compare.ids : null;
  const items = catalog && ids ? ids.flatMap(id => { const item = findIngredient(catalog, id); return item ? [item] : []; }) : [];
  const comparedItems = items.filter(item => !assessIngredient(item, safety.state.profile).blocked);
  const blockedItems = items.filter(item => assessIngredient(item, safety.state.profile).blocked);
  const rows = buildComparison(comparedItems, { differencesOnly: differencesOnly && comparedItems.length >= 2 });
  const unavailableIds = catalog && ids ? ids.filter(id => !findIngredient(catalog, id)) : [];
  const photos = useCardPhotos(comparedItems, safety.state.profile.redFlags.length > 0 || selections.compare.status !== 'ready', safety.isCurrent);
  const full = !!ids && ids.length >= COMPARE_LIMIT;

  if (safety.state.profile.redFlags.length) return <Page><UrgentNotice canInteract={safety.isCurrent} /></Page>;

  return <Page>
    <PageHeading eyebrow='并排读懂资料' title='食材对比' subtitle={`最多选 ${COMPARE_LIMIT} 项，对照部位、形态与限制。`} />
    {!catalogResult.ok ? <EmptyState title='食材目录暂时无法读取' message='请退出后重新打开，本机对比记录未被修改。' /> : <>
      {selections.compare.status === 'error' && <StorageNotice onRetry={selections.refresh} />}
      {selections.compare.status === 'unread' && <View className='reading-copy'>正在读取对比记录…</View>}
      {ids && <>
        <UnavailableSelections kind='compare' ids={unavailableIds} canInteract={() => selections.isCurrent('compare', selections.compare.revision)} onRemove={id => selections.remove('compare', id)} />
        {items.length === 0 ? <EmptyState title={unavailableIds.length ? '当前没有可展示的食材' : '把想了解的食材放在一起'} message={unavailableIds.length ? '可保留上方旧记录，或移出后重新选择。' : '从食材详情加入对比，再回来看看它们的异同。'} {...(!full ? { action: '选择食材', onAction: () => { if (safety.isCurrent()) openCatalog(); } } : {})} /> : <>
          <View className='compare-selection-heading'>
            <View><View className='list-heading__title'>已选 {ids.length} / {COMPARE_LIMIT} 项</View><View className='compare-selection-heading__note'>{full ? '移出一项，即可换选其他食材。' : '点卡片查看详情，也可以继续添加。'}</View></View>
            <Button id='compare-add' className='button button--soft' disabled={full} onClick={() => { if (selections.isCurrent('compare', selections.compare.revision)) openCatalog(); }}>{full ? '已选满' : '再选食材'}</Button>
          </View>
          <View className='compare-selected'>{items.map(item => {
            const blocked = assessIngredient(item, safety.state.profile).blocked;
            return <View className='compare-selected__item' key={item.id}>
              <Button className='compare-selected__open' ariaLabel={`查看${item.name}详情`} onClick={() => { if (selections.isCurrent('compare', selections.compare.revision)) openIngredient(item.id); }}>
                <IngredientArtwork ingredient={item} gallery={blocked ? undefined : photos.galleries[item.id]} origin={photos.origin} />
                <View className='compare-selected__body'><View className='compare-selected__name'>{item.name}</View><View className='compare-selected__part'>{item.partReview === 'source_checked' ? item.partText : '部位尚待核对'}</View>{blocked && <Text className='tag tag--warm'>查看冲突原因</Text>}</View>
              </Button>
              <Button className='compare-selected__remove' ariaLabel={`移出${item.name}`} onClick={() => selections.remove('compare', item.id)}>移出</Button>
            </View>;
          })}</View>
          {blockedItems.length > 0 && <Notice title='部分条目已停止参与对比'>{blockedItems.map(item => item.name).join('、')}与本次安全信息存在冲突。原记录保留，可点名称查看原因或移出对比。</Notice>}
          <Notice title='对比资料，不作搭配推荐'>{COMPARE_NOTICE}</Notice>
          {comparedItems.length === 1 && <Notice title='再选一项，看得更清楚'>目前有 1 项参与对比。再加入一项后可以只看不同内容。</Notice>}
          <View className='compare-controls'><Text className='small muted'>只看不同内容</Text><Switch id='compare-differences' checked={differencesOnly && comparedItems.length >= 2} disabled={comparedItems.length < 2} color='#496c3a' onChange={event => {
            if (comparedItems.length < 2 || !selections.isCurrent('compare', selections.compare.revision) || differenceGeneration.current !== renderedDifferenceGeneration) return;
            if (typeof event.detail.value !== 'boolean' || event.detail.value === differencesOnly) return;
            differenceGeneration.current += 1;
            setDifferencesOnly(event.detail.value);
          }} ariaLabel='只看不同内容' /></View>
          {rows.map(row => <View className='compare-row' key={row.id}>
            <View className='compare-row__title'>{row.label}{row.different && <Text className='tag tag--green'>有差异</Text>}</View>
            {row.values.map((value, index) => <View className='compare-row__item' key={comparedItems[index]?.id ?? String(index)}><Text className='compare-row__name'>{comparedItems[index]?.name ?? '条目'}</Text><Text className='compare-row__value'>{value}</Text></View>)}
          </View>)}
          {rows.length === 0 && <EmptyState title={comparedItems.length ? '当前展示字段没有差异' : '请先确认已选条目的安全信息'} message={comparedItems.length ? '关闭“只看不同内容”可查看完整对比。' : '存在冲突的条目不参与对比。可查看详情中的原因，再向医生或药师确认。'} />}
          <Button className='button button--wide' onClick={() => { if (safety.isCurrent()) openCatalog(); }}>继续选择食材</Button>
        </>}
      </>}
    </>}
  </Page>;
}
