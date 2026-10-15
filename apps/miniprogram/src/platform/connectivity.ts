import Taro from '@tarojs/taro';
import { createConnectivityStore } from '@food-education/catalog-core';

export const connectivity = createConnectivityStore({
  async read() {
    const result = await Taro.getNetworkType();
    return result.networkType === 'none' ? false : result.networkType === 'unknown' ? null : true;
  },
  watch(listener) {
    const callback: Taro.onNetworkStatusChange.Callback = event => listener(event.isConnected);
    Taro.onNetworkStatusChange(callback);
    return () => Taro.offNetworkStatusChange(callback);
  }
});
