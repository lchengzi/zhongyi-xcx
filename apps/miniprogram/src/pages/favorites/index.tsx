import { Button, Input, Text, View } from '@tarojs/components';
import { searchCatalog, assessIngredient } from '@food-education/catalog-core';
import { useMemo } from 'react';
import { Page, PageHeading, EmptyState } from '../../components/page';
import { IngredientCard } from '../../components/ingredient-card';
import { StorageNotice } from '../../components/storage-notice';
import { catalogResult } from '../../data/catalog';
import { useSelections } from '../../features/selections';
import { usePageInteraction } from '../../platform/lifecycle';
import { openCatalog, openIngredient } from '../../platform/navigation';
import { useSearch } from '../../features/search';
import { useSafety } from '../../features/safety';
import { UrgentNotice } from '../../components/safety-notice';
import { favoritesBrowse } from '../../features/browsing';
import { useBrowsePosition } from '../../platform/browse-position';
import { useCardPhotos } from '../../features/photos';
import { UnavailableSelections } from '../../components/unavailable-selections';


export default function FavoritesPage() {
  const canInteract = usePageInteraction();
  const safety = useSafety(canInteract);
  const selections = useSelections(safety.isCurrent);
  const search = useSearch(safety.isCurrent, favoritesBrowse);
  const { query, visible } = search;
  useBrowsePosition(favoritesBrowse, search.revision, search.viewportRevision, safety.isCurrent,
    catalogResult.ok && selections.favorites.status === 'ready' && safety.state.profile.redFlags.length === 0);
  const catalog = catalogResult.ok ? catalogResult.catalog : null;
  const ids = selections.favorites.status === 'ready' ? selections.favorites.ids : null;
  const items = useMemo(() => catalog && ids ? searchCatalog(catalog, query).filter(item => ids.includes(item.id)) : [], [catalog, ids, query]);
  const unavailableIds = catalog && ids ? ids.filter(id => !catalog.ingredients.some(item => item.id === id)) : [];
  const displayed = useMemo(() => items.slice(0, visible), [items, visible]);
  const pictureItems = useMemo(() => displayed.filter(item => !assessIngredient(item, safety.state.profile).blocked), [displayed, safety.state.profile]);
  const photos = useCardPhotos(pictureItems, safety.state.profile.redFlags.length > 0 || selections.favorites.status !== 'ready', safety.isCurrent);

  if (safety.state.profile.redFlags.length) return <Page><UrgentNotice canInteract={safety.isCurrent} /></Page>;

  return <Page>
    <PageHeading eyebrow='你的资料夹' title='收藏的食材' subtitle='留下想继续了解的条目，下次接着看。' />
    {!catalogResult.ok ? <EmptyState title='食材目录暂时无法读取' message='请退出后重新打开，本机收藏记录未被修改。' /> : <>
      {selections.favorites.status === 'error' && <StorageNotice onRetry={selections.refresh} />}
      {selections.favorites.status === 'unread' && <View className='reading-copy'>正在读取收藏记录…</View>}
      {ids && <>
        <UnavailableSelections kind='favorites' ids={unavailableIds} canInteract={() => selections.isCurrent('favorites', selections.favorites.revision)} onRemove={id => selections.remove('favorites', id)} />
        {ids.length > 0 && <>
          <View className='search'><Text className='search__icon' ariaHidden>⌕</Text><Input id='favorites-search' className='search__input' value={query} maxlength={60} placeholder='搜索收藏中的食材' ariaLabel='搜索收藏' confirmType='search' onInput={event => { search.input(event.detail.value); }} onConfirm={event => { search.confirm(event.detail.value); }} />{query && <Button className='search__clear' onClick={() => { search.clear(); }}>清除</Button>}</View>
          <View className='list-heading'><Text className='list-heading__title'>留待细读</Text><Text className='muted small'>{items.length} 项</Text></View>
        </>}
        {items.length > 0 ? <View className='ingredient-list'>{displayed.map((ingredient, index) => <View key={ingredient.id}>{assessIngredient(ingredient, safety.state.profile).blocked && <View className='blocked-note'>与本次安全信息存在冲突，请查看详情。原收藏保留，可自行移除。</View>}<IngredientCard ingredient={ingredient} index={index} favorite gallery={photos.galleries[ingredient.id]} origin={photos.origin} onOpen={() => { if (search.isCurrent() && selections.isCurrent('favorites', selections.favorites.revision)) openIngredient(ingredient.id); }} onRemove={() => { if (search.isCurrent()) selections.remove('favorites', ingredient.id); }} /></View>)}</View> : <EmptyState title={query ? '收藏中没有匹配的条目' : unavailableIds.length ? '当前没有可展示的收藏' : '先收藏一份感兴趣的资料'} message={query ? '试试其他名称或拼音。' : unavailableIds.length ? '旧记录仍保留，可在上方逐项整理。' : '打开食材详情，点“收藏”，就能在这里继续查阅。'} action='去看食材' onAction={() => { if (safety.isCurrent()) openCatalog(); }} />}
        {visible < items.length && <Button className='button button--wide' onClick={() => { search.more(items.length); }}>继续查看</Button>}
      </>}
    </>}
    <View className='footer-note'>收藏保存在本机，不代表食用建议。</View>
  </Page>;
}
