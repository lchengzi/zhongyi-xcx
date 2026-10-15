import { Image, Text, View } from '@tarojs/components';
import { useState } from 'react';
import cover from '../assets/illustrations/catalog-cover.jpg';

export function CatalogCover({ count }: { count: number }) {
  const [failed, setFailed] = useState(false);
  return <View className='catalog-cover'>
    <View className='catalog-brand'><Text className='catalog-brand__name'>食养图录</Text><Text className='catalog-brand__count'>{count} 味食材</Text></View>
    <View className={`catalog-cover__scene${failed ? ' catalog-cover__scene--fallback' : ''}`}>
      {!failed && <Image className='catalog-cover__image' src={cover} mode='aspectFill' ariaHidden onError={() => { setFailed(true); }} />}
      <View className='catalog-cover__copy'><Text className='catalog-cover__eyebrow'>日常食材 · 慢慢了解</Text><View className='catalog-cover__title'><View>一味食材</View><View>一份档案</View></View><Text className='catalog-cover__subtitle'>名称 / 部位 / 加工</Text></View>
      <Text className='catalog-cover__caption'>插画</Text>
    </View>
  </View>;
}
