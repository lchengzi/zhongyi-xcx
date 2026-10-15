import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

/** A callback from an older page visit must not mutate the current visit. */
export function usePageInteraction() {
  const generation = useRef(0);
  const active = useRef(true);
  const [visit, setVisit] = useState(0);
  useDidShow(() => {
    active.current = true;
    generation.current += 1;
    setVisit(generation.current);
  });
  const invalidate = () => {
    active.current = false;
    generation.current += 1;
  };
  useDidHide(invalidate);
  useUnload(invalidate);
  useEffect(() => invalidate, []);
  return () => active.current && generation.current === visit;
}
