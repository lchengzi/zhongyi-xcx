import { Notice } from './page';

export function StorageNotice({ onRetry }: { onRetry: () => void }) {
  return <Notice title='本机记录暂时无法读取' action='重新读取' onAction={onRetry}>
    收藏或对比记录尚未读取成功，当前数量不能代表原有记录。
  </Notice>;
}
