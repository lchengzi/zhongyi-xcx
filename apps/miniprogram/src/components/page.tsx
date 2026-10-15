import { Button, Text, View } from '@tarojs/components';
import type { PropsWithChildren } from 'react';
import { ConnectionNotice } from './connection-notice';
import { useReadingPreferences } from '../features/reading';

export function Page({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  const { state } = useReadingPreferences();
  return <View className={`page page--${state.size} ${className}`}><ConnectionNotice />{children}</View>;
}

export function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <View className='page-heading'>
    <Text className='eyebrow'>{eyebrow}</Text>
    <View className='page-title'>{title}</View>
    <View className='page-subtitle'>{subtitle}</View>
  </View>;
}

export function EmptyState({ title, message, action, onAction }: {
  title: string; message: string; action?: string; onAction?: () => void;
}) {
  return <View className='empty-state'>
    <View className='empty-state__mark' ariaHidden>·</View>
    <View className='empty-state__title'>{title}</View>
    <View className='empty-state__message'>{message}</View>
    {action && onAction && <Button className='button button--primary' onClick={onAction}>{action}</Button>}
  </View>;
}

export function Notice({ title, children, action, onAction }: PropsWithChildren<{
  title: string; action?: string; onAction?: () => void;
}>) {
  return <View className='notice' role='alert'>
    <View className='notice__title'>{title}</View>
    <View className='notice__copy'>{children}</View>
    {action && onAction && <Button className='button button--text' onClick={onAction}>{action}</Button>}
  </View>;
}

export function Section({ title, caption, children }: PropsWithChildren<{ title: string; caption?: string }>) {
  return <View className='section'>
    <View className='section-heading'><View className='section-title'>{title}</View>{caption && <Text className='muted small'>{caption}</Text>}</View>
    {children}
  </View>;
}

export function Fact({ label, value }: { label: string; value: string }) {
  return <View className='fact'><Text className='fact__label'>{label}</Text><Text className='fact__value' selectable>{value}</Text></View>;
}
