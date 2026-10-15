import Taro from '@tarojs/taro';

export function notify(message: string): void {
  void Taro.showToast({ title: message, icon: 'none', duration: 2200 }).catch(() => undefined);
}

export async function confirmRecordDeletion(): Promise<boolean> {
  try {
    const result = await Taro.showModal({
      title: '删除本机记录？',
      content: '会删除收藏、对比列表，并清除本次填写的安全信息与阅读清单。删除后无法恢复。',
      confirmText: '删除记录',
      cancelText: '保留',
      confirmColor: '#9d3e2e',
    });
    return result.confirm;
  } catch {
    notify('暂时无法确认，请重试');
    return false;
  }
}

export async function copySourceUrl(url: string): Promise<void> {
  try {
    await Taro.setClipboardData({ data: url });
  } catch {
    notify('链接复制失败，请重试');
  }
}

export async function confirmSafetyReset(): Promise<boolean> {
  try {
    const result = await Taro.showModal({ title: '清除本次安全信息？', content: '会清除健康问项和阅读清单，收藏与对比列表保留。', confirmText: '清除信息', cancelText: '保留', confirmColor: '#9d3e2e' });
    return result.confirm;
  } catch {
    notify('暂时无法确认，请重试');
    return false;
  }
}

export async function copyConsultationNote(text: string): Promise<void> {
  try { await Taro.setClipboardData({ data: text }); }
  catch { notify('摘要复制失败，请重试'); }
}
