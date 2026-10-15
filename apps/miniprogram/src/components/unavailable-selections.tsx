import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';
import type { SelectionKind } from '@food-education/catalog-core';
import { Disclosure } from './disclosure';

/** Retain unlisted IDs until the user explicitly removes a selected record.
 * Reuse the selection store's revision/readback checks, not a separate writer. */
export function UnavailableSelections({ kind, ids, canInteract, onRemove }: {
  kind: SelectionKind; ids: readonly string[]; canInteract: () => boolean; onRemove: (id: string) => void;
}) {
  const [visible, setVisible] = useState(12);
  if (!ids.length) return null;
  const title = kind === 'compare' ? '暂不可用的对比记录' : '暂不可用的收藏';
  return <Disclosure title={title} summary={`${ids.length} 项不在当前目录 · 原记录保留`} canInteract={canInteract}>
    <View className='reading-note'>可逐项移除，不影响其他记录。</View>
    {ids.slice(0, visible).map((id, index) => <View className='unavailable-selection' key={id}>
      <Text className='reading-copy'>留存条目 {index + 1}</Text>
      <Button className='button button--text' ariaLabel={`移出${title} ${index + 1}`} onClick={() => { if (canInteract()) onRemove(id); }}>移出</Button>
    </View>)}
    {visible < ids.length && <Button className='button button--wide' onClick={() => {
      if (canInteract()) setVisible(value => Math.min(ids.length, value + 12));
    }}>继续查看旧记录</Button>}
  </Disclosure>;
}
