import { Button, Text, View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { findIngredient, assessIngredient } from '@food-education/catalog-core';
import { Page, EmptyState, Section, Fact } from '../../../components/page';
import { StorageNotice } from '../../../components/storage-notice';
import { catalogResult } from '../../../data/catalog';
import { useSelections } from '../../../features/selections';
import { usePageInteraction } from '../../../platform/lifecycle';
import { openCatalog, openCompare } from '../../../platform/navigation';
import { copySourceUrl } from '../../../platform/feedback';
import { useSafety } from '../../../features/safety';
import { UrgentNotice } from '../../../components/safety-notice';
import { openSafety } from '../../../platform/navigation';
import { useEducation } from '../../../features/education';
import { EducationSection } from '../../../components/education-section';
import { Disclosure } from '../../../components/disclosure';
import { IngredientPhotos } from '../../../components/ingredient-photos';
import { usePhotos } from '../../../features/photos';
import { DetailSafetyNotice } from '../../../components/detail-safety-notice';

export default function DetailPage() {
  const router = useRouter();
  const canInteract = usePageInteraction();
  const safety = useSafety(canInteract);
  const selections = useSelections(safety.isCurrent);
  const id = router.params.id ?? '';
  const education = useEducation(id, safety.state.profile.redFlags.length > 0, safety.isCurrent);
  const photos = usePhotos(id, safety.state.profile.redFlags.length > 0, safety.isCurrent);
  const item = catalogResult.ok ? findIngredient(catalogResult.catalog, id) : undefined;
  if (safety.state.profile.redFlags.length) return <Page><UrgentNotice canInteract={safety.isCurrent} /></Page>;
  if (!item || !catalogResult.ok) return <Page><EmptyState title='没有找到这项资料' message='条目不在当前目录中，请返回食材目录重新选择。' action='返回食材目录' onAction={() => { if (canInteract()) openCatalog(); }} /></Page>;

  const isFavorite = selections.favorites.status === 'ready' && selections.favorites.ids.includes(item.id);
  const isCompared = selections.compare.status === 'ready' && selections.compare.ids.includes(item.id);
  const assessment = assessIngredient(item, safety.state.profile);
  const hasPhoto = !!photos.origin && photos.state.gallery?.ingredientId === item.id && photos.state.gallery.name === item.name;
  const safetyNotice = <DetailSafetyNotice assessment={assessment} riskNotes={item.riskNotes} canInteract={safety.isCurrent}
    onSafety={() => { if (safety.isCurrent()) openSafety(); }} />;

  return <Page className='detail-page'>
    <View className={`detail-hero${hasPhoto ? '' : ' detail-hero--symbol'}`}>
      <View className='detail-hero__art'><IngredientPhotos ingredient={item} gallery={photos.state.gallery} origin={photos.origin} canInteract={photos.isCurrent} /></View>
      <View className='detail-hero__identity'>
      <Text className='eyebrow'>食材档案</Text>
      <View className='detail-name'>{item.name}</View>
      <View className='detail-pinyin'>{item.pinyin}</View>
      <View className='detail-status'><Text className='tag tag--green'>历史目录资料</Text><Text className='tag tag--warm'>专业审校待完成</Text></View>
      </View>
    </View>
    {(photos.state.status === 'unavailable' || photos.state.status === 'expired') && <Button id='detail-photos-retry' className='button button--text'
      disabled={!photos.isCurrent()} onClick={photos.refresh}>重新加载照片</Button>}
    {(selections.favorites.status === 'error' || selections.compare.status === 'error') && <StorageNotice onRetry={selections.refresh} />}
    {assessment.blocked && safetyNotice}
    <EducationSection state={education.state} onRefresh={education.refresh} canInteract={education.isCurrent} />
    <Section title='部位与形态'>
      {item.aliases.length > 0 && <Fact label='相关名称' value={item.aliases.join('、')} />}
      <Fact label='食用部位' value={item.partReview === 'source_checked' ? item.partText : '尚待核对'} />
      <Fact label='加工形态' value={item.processingForms.length ? item.processingForms.join(' · ') : '尚待核对'} />
      {item.latinName && <Fact label='来源学名' value={item.latinName} />}
      <View className='reading-note'>名称收录不等于所有品种、部位或加工品都可食用。</View>
    </Section>
    {!assessment.blocked && safetyNotice}
    <Section title='使用边界'>
      <View className='reading-copy'>{item.restriction}</View>
    </Section>
    <Disclosure title='部位与加工记录' summary='查看原始说明与核对状态' canInteract={safety.isCurrent}>
      <Fact label='规范名称' value={item.name} />
      <Fact label='部位记录' value={item.partText} />
      <Fact label='部位依据' value={item.partReview === 'source_checked' ? '项目已核对所列来源，待专业审校' : '来源尚不足以确认具体部位'} />
      <View className='reading-copy'>{item.processingNote}</View>
    </Disclosure>
    <Disclosure title='资料使用范围' summary='学习查阅，不用于诊断、治疗或处方指导' canInteract={safety.isCurrent}>
      <View className='reading-copy'>{catalogResult.catalog.boundaryNotice}</View>
      <View className='reading-note'>规则仅能提示已记录的风险与资料缺口，不能完成个体食用安全评估。</View>
    </Disclosure>
    <Disclosure title='来源与记录' summary={`${item.sources.length} 项来源 · ${catalogResult.catalog.catalogAsOf}`} canInteract={safety.isCurrent}>
      <Fact label='目录日期' value={catalogResult.catalog.catalogAsOf} />
      <Fact label='来源核对' value={item.sourceCheckedAt ?? '待核对'} />
      <Fact label='专业审校' value='待完成' />
      <Fact label='内容版本' value={catalogResult.catalog.contentVersion} />
      <Fact label='规则版本' value={catalogResult.catalog.rulesVersion} />
      {item.sources.map(source => <View className='source' key={source.id}>
        <View className='source__title'>{source.title}</View>
        <View className='source__meta'>{source.publisher}</View>
        <View className='source__meta'>来源核对记录 · {source.checkedAt}</View>
        <Button className='button button--text' onClick={() => { if (safety.isCurrent()) void copySourceUrl(source.url); }}>复制来源链接 ↗</Button>
      </View>)}
      <View className='reading-note'>日期来自已保存的来源记录，不表示今天重新核验。复制链接时会写入系统剪贴板。</View>
    </Disclosure>
    {isCompared && <Button className='button button--wide' onClick={() => { if (safety.isCurrent()) openCompare(); }}>查看已选对比</Button>}
    <View className='detail-actions'>
      <Button id='detail-favorite' className={`button ${isFavorite ? 'button--soft' : ''}`} disabled={selections.favorites.status !== 'ready' || (assessment.blocked && !isFavorite)} onClick={() => { if (safety.isCurrent() && (!assessment.blocked || isFavorite)) selections.toggle('favorites', item.id); }}>{selections.favorites.status !== 'ready' ? '收藏待读取' : isFavorite ? '取消收藏' : assessment.blocked ? '暂不收藏' : '收藏'}</Button>
      <Button id='detail-compare' className={`button ${isCompared ? 'button--soft' : 'button--primary'}`} disabled={selections.compare.status !== 'ready' || (assessment.blocked && !isCompared)} onClick={() => { if (safety.isCurrent() && (!assessment.blocked || isCompared)) selections.toggle('compare', item.id); }}>{selections.compare.status !== 'ready' ? '对比待读取' : isCompared ? '移出对比' : assessment.blocked ? '暂不对比' : '加入对比'}</Button>
    </View>
  </Page>;
}
