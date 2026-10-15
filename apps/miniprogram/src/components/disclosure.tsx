import { Button, Text, View } from '@tarojs/components';
import { useRef, useState, type PropsWithChildren } from 'react';

export function Disclosure({ title, summary, children, canInteract }: PropsWithChildren<{ title: string; summary: string; canInteract: () => boolean }>) {
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  const renderedGeneration = generation.current;
  return <View className='disclosure'>
    <Button className='disclosure__toggle' ariaLabel={`${title}，${open ? '已展开，点击收起' : '已收起，点击展开'}`} onClick={() => {
      if (!canInteract() || generation.current !== renderedGeneration) return;
      generation.current++; setOpen(!open);
    }}>
      <View><View className='disclosure__title'>{title}</View><View className='disclosure__summary'>{summary}</View></View>
      <Text className='disclosure__action'>{open ? '收起 −' : '展开 ＋'}</Text>
    </Button>
    {open && <View className='disclosure__body'>{children}</View>}
  </View>;
}
