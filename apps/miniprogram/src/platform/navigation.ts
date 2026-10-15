import Taro from '@tarojs/taro';
import { notify } from './feedback';

let navigationPending = false;

async function navigate(action: () => Promise<unknown>): Promise<void> {
  if (navigationPending) return;
  navigationPending = true;
  try {
    await action();
  } catch {
    notify('页面暂时无法打开，请重试');
  } finally {
    navigationPending = false;
  }
}

export function openIngredient(id: string): void {
  void navigate(() => Taro.navigateTo({ url: `/subpackages/catalog/detail/index?id=${encodeURIComponent(id)}` }));
}

export function openCatalog(): void {
  void navigate(() => Taro.switchTab({ url: '/pages/catalog/index' }));
}

export function openCompare(): void {
  void navigate(() => Taro.switchTab({ url: '/pages/compare/index' }));
}

export function openSafety(): void {
  void navigate(() => Taro.switchTab({ url: '/pages/safety/index' }));
}

export function openAbout(): void {
  void navigate(() => Taro.switchTab({ url: '/pages/about/index' }));
}
