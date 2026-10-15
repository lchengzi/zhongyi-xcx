import Taro from '@tarojs/taro';
import type { StoragePort } from '@food-education/catalog-core';

export const deviceStorage: StoragePort = {
  read(key) {
    const value: unknown = Taro.getStorageSync(key);
    return value;
  },
  write(key, value) {
    Taro.setStorageSync(key, [...value]);
  },
  remove(key) {
    Taro.removeStorageSync(key);
  },
};
