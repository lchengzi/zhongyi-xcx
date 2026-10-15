import { Button, View } from '@tarojs/components';
import { Page, Section, Fact } from '../../components/page';
import { missingSafetyDimensions } from '@food-education/catalog-core';
import { StorageNotice } from '../../components/storage-notice';
import { catalogResult } from '../../data/catalog';
import { useSelections } from '../../features/selections';
import { usePageInteraction } from '../../platform/lifecycle';
import { confirmRecordDeletion } from '../../platform/feedback';
import { useSafety } from '../../features/safety';
import { useReadingPreferences } from '../../features/reading';

export default function AboutPage() {
  const canInteract = usePageInteraction();
  const selections = useSelections(canInteract);
  const safety = useSafety(canInteract);
  const reading = useReadingPreferences();

  return <Page>
    <View className='about-brand'><View className='about-brand__title'>食养图录</View><View className='about-brand__subtitle'>认识食材，也认识资料的边界。</View></View>
    <Section title='阅读字号'>
      <View className='reading-sizes'>
        {([
          { size: 'standard', label: '标准' },
          { size: 'large', label: '大' },
          { size: 'extra-large', label: '特大' },
        ] as const).map(option => <Button key={option.size} id={`reading-size-${option.size}`}
          className={`button reading-sizes__choice ${reading.state.size === option.size ? 'button--primary' : ''}`}
          ariaLabel={`${option.label}字号${reading.state.size === option.size ? '，已选中' : ''}`}
          onClick={() => reading.setSize(option.size, canInteract)}>{option.label}</Button>)}
      </View>
      <View className='reading-note'>调整后适用于各页，本次打开期间有效。</View>
    </Section>
    <Section title='关于这份图录'>
      <View className='reading-copy'>把食药物质的名称、部位、加工形态和公开来源整理在一起，方便查找、收藏和对比。</View>
      <View className='reading-copy'>内容用于食养教育，不提供疾病诊断、疗效承诺、处方或个人用药建议。有疾病、正在用药或属于特殊人群时，请向医生或药师确认。</View>
    </Section>
    <Section title='资料版本'>
      {catalogResult.ok ? <>
        <Fact label='目录条目' value={`${catalogResult.catalog.ingredients.length} 项历史资料`} />
        <Fact label='来源截至' value={catalogResult.catalog.catalogAsOf} />
        <Fact label='内容版本' value={catalogResult.catalog.contentVersion} />
        <Fact label='规则版本' value={catalogResult.catalog.rulesVersion} />
        <Fact label='专业审校' value='待完成' />
        <View className='reading-note'>历史目录保留原有核对日期。列入目录与适合个人食用是不同问题，请留意每项资料的部位、形态和限制。</View>
      </> : <View className='reading-copy'>本地资料暂时无法读取，请退出后重新打开。</View>}
    </Section>
    <Section title='本机记录'>
      <View className='reading-copy'>收藏与对比列表保存在当前设备，仅记录条目编号。安全问项与阅读清单只在本次运行中保留，不保存到本机、不上传。</View>
      <Fact label='收藏' value={selections.favorites.status === 'ready' ? `${selections.favorites.ids.length} 项` : '待读取'} />
      <Fact label='对比' value={selections.compare.status === 'ready' ? `${selections.compare.ids.length} 项` : '待读取'} />
      <Fact label='安全问项' value={`${6 - missingSafetyDimensions(safety.state.profile).length}/6 项状态已填写`} />
      <Fact label='阅读清单' value={`${safety.state.checks.length}/8 项`} />
      {(selections.favorites.status === 'error' || selections.compare.status === 'error') && <StorageNotice onRetry={selections.refresh} />}
      <Button id='delete-local-records' className='button button--danger button--wide' onClick={() => { void selections.clearRecords(confirmRecordDeletion); }}>删除本机记录与本次安全信息</Button>
      <View className='reading-note'>删除会清除收藏、对比、安全问项与阅读清单，不影响微信中的其他数据。已复制的链接和咨询摘要需在系统剪贴板或对应应用中处理。</View>
    </Section>
    <View className='footer-note'>阅读、核对，再作判断。</View>
  </Page>;
}
