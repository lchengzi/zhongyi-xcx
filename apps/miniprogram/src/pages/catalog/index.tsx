import { Button, Input, Text, View } from '@tarojs/components';
import { searchCatalog, assessIngredient, COMPARE_LIMIT, type BrowseFilter } from '@food-education/catalog-core';
import { useMemo } from 'react';
import { Page, EmptyState, Notice } from '../../components/page';
import { CatalogCover } from '../../components/catalog-cover';
import { IngredientCard } from '../../components/ingredient-card';
import { catalogResult } from '../../data/catalog';
import { usePageInteraction } from '../../platform/lifecycle';
import { openIngredient, openSafety, openCompare } from '../../platform/navigation';
import { useSearch } from '../../features/search';
import { useSafety } from '../../features/safety';
import { ProfileNotice, UrgentNotice } from '../../components/safety-notice';
import { catalogBrowse } from '../../features/browsing';
import { useBrowsePosition } from '../../platform/browse-position';
import { useCardPhotos } from '../../features/photos';
import { useSelections } from '../../features/selections';
import { StorageNotice } from '../../components/storage-notice';

const filters: readonly { id: BrowseFilter; label: string }[] = [
  { id: 'all', label: '全部食材' },
  { id: 'checked', label: '部位有来源' },
  { id: 'pending', label: '部位待核对' },
];

export default function CatalogPage() {
  const canInteract = usePageInteraction();
  const safety = useSafety(canInteract);
  const selections = useSelections(safety.isCurrent);
  const compareIds = selections.compare.status === 'ready' ? selections.compare.ids : null;
  const compareFull = compareIds !== null && compareIds.length >= COMPARE_LIMIT;
  const search = useSearch(safety.isCurrent, catalogBrowse);
  const { query, filter, visible } = search;
  useBrowsePosition(catalogBrowse, search.revision, search.viewportRevision, safety.isCurrent);
  const { items: results, blockedCount } = useMemo(() => {
    if (!catalogResult.ok) return { items: [], blockedCount: 0 };
    const matching = searchCatalog(catalogResult.catalog, query).filter(item => filter === 'all' || item.partReview === (filter === 'checked' ? 'source_checked' : 'pending'));
    const items = matching.filter(item => !assessIngredient(item, safety.state.profile).blocked);
    return { items, blockedCount: matching.length - items.length };
  }, [query, filter, safety.state.profile]);
  const displayed = useMemo(() => results.slice(0, visible), [results, visible]);
  const photos = useCardPhotos(displayed, safety.state.profile.redFlags.length > 0, safety.isCurrent);

  if (safety.state.profile.redFlags.length) return <Page><UrgentNotice canInteract={safety.isCurrent} /></Page>;

  if (!catalogResult.ok) return <Page><EmptyState title='食材目录暂时无法读取' message='本地资料校验未通过，请退出后重新打开。收藏记录仍保留在本机。' /></Page>;

  return <Page className='catalog-page'>
    <CatalogCover count={catalogResult.catalog.ingredients.length} />
    <View className='catalog-tools'>
    <View className='search'>
      <Text className='search__icon' ariaHidden>⌕</Text>
      <Input id='catalog-search' className='search__input' placeholder='搜索名称、别名或拼音' value={query} maxlength={60} confirmType='search' onInput={event => { search.input(event.detail.value); }} onConfirm={event => { search.confirm(event.detail.value); }} ariaLabel='搜索食材' />
      {query && <Button className='search__clear' onClick={() => { search.clear(); }}>清除</Button>}
    </View>
    <View className='filter-tabs'>
      {filters.map(item => <Button key={item.id} className={`filter-tab ${filter === item.id ? 'filter-tab--active' : ''}`} onClick={() => { search.chooseFilter(item.id); }}>{item.label}</Button>)}
    </View>
    </View>
    <ProfileNotice canInteract={safety.isCurrent} />
    {selections.compare.status === 'error' && <StorageNotice onRetry={selections.refresh} />}
    {compareIds !== null && compareIds.length > 0 && <View className='catalog-compare' id='catalog-compare-summary'>
      <View className='catalog-compare__copy'><View className='catalog-compare__title'>已选 {compareIds.length} / {COMPARE_LIMIT} 项</View>
        <View className='catalog-compare__note'>{compareFull ? '移出一项，即可换选其他食材。' : '继续选材，或查看部位与形态的异同。'}</View></View>
      <Button id='catalog-open-compare' className='button button--soft' onClick={() => {
        if (search.isCurrent() && selections.isCurrent('compare', selections.compare.revision)) openCompare();
      }}>查看对比</Button>
    </View>}
    <View className='list-heading'><Text className='list-heading__title'>{query ? '搜索结果' : '食材目录'}</Text><Text className='muted small'>{results.length} 项资料</Text></View>
    {blockedCount > 0 && <Notice title='部分条目已停止选择' action='核对安全信息' onAction={() => { if (safety.isCurrent()) openSafety(); }}>{blockedCount} 项匹配资料与本次填写的安全信息存在冲突，未显示在结果中。</Notice>}
    {results.length ? <View className='ingredient-list ingredient-list--grid'>{displayed.map((ingredient, index) => {
      const selected = compareIds?.includes(ingredient.id) ?? false;
      return <IngredientCard key={ingredient.id} ingredient={ingredient} index={index} gallery={photos.galleries[ingredient.id]} origin={photos.origin}
        onOpen={() => { if (search.isCurrent()) openIngredient(ingredient.id); }}
        compare={{ selected, full: compareFull, disabled: compareIds === null || (compareFull && !selected), onToggle: () => {
          if (search.isCurrent() && selections.isCurrent('compare', selections.compare.revision)
            && !assessIngredient(ingredient, safety.state.profile).blocked) selections.toggle('compare', ingredient.id);
        } }} />;
    })}</View> : <EmptyState title='没有找到匹配的食材' message='试试更短的名称、别名或拼音，也可以切换上方筛选条件。' action='查看全部食材' onAction={() => { if (search.isCurrent()) catalogBrowse.reset(); }} />}
    {visible < results.length && <Button id='catalog-load-more' className='button button--wide' onClick={() => { search.more(results.length); }}>继续查看 · 还有 {results.length - visible} 项</Button>}
    <View className='footer-note'>历史目录 · 来源核对截至 {catalogResult.catalog.catalogAsOf}<View>专业审校待完成，收藏与对比不代表适合食用。</View></View>
  </Page>;
}
