import { View } from '@tarojs/components';
import { useSyncExternalStore } from 'react';
import { connectivity } from '../platform/connectivity';
import { publicContentConfig } from '../config/public-content';

export function ConnectionNotice() {
  const state = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot, connectivity.getSnapshot);
  return state.status === 'offline' ? <View className='connection-notice' role='status'>当前离线，本地目录仍可查阅。{publicContentConfig.origin ? '在线资料需联网后重新核对。' : ''}</View> : null;
}
