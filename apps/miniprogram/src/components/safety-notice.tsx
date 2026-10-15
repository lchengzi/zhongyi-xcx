import { Button, View } from '@tarojs/components';
import { EMERGENCY_MESSAGE } from '@food-education/catalog-core';
import { openAbout, openSafety } from '../platform/navigation';

export function UrgentNotice({ canInteract, showNavigation = true }: { canInteract: () => boolean; showNavigation?: boolean }) {
  return <View className='urgent-notice' role='alert'>
    <View className='urgent-notice__title'>请优先处理紧急情况</View>
    <View className='reading-copy'>{EMERGENCY_MESSAGE}</View>
    <View className='reading-note'>食材筛选、收藏与对比操作已暂停。</View>
    {showNavigation && <Button className='button button--wide' onClick={() => { if (canInteract()) openSafety(); }}>查看已填写信息</Button>}
    <Button className='button button--text' onClick={() => { if (canInteract()) openAbout(); }}>管理本机记录</Button>
  </View>;
}

export function ProfileNotice({ canInteract }: { canInteract: () => boolean }) {
  return <View className='safety-entry'>
    <View className='safety-entry__copy'>有过敏、疾病或正在用药？<View className='safety-entry__note'>先核对个人情况，再查阅食材。</View></View>
    <Button className='safety-entry__action' onClick={() => { if (canInteract()) openSafety(); }}>安全问项 ›</Button>
  </View>;
}
