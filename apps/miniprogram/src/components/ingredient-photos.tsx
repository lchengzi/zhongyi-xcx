import { Button, Image, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { publicPhotoUrl, type Ingredient, type PublicPhotoGallery } from '@food-education/catalog-core';
import { IngredientVisual } from './ingredient-visual';
import { Disclosure } from './disclosure';
import { copySourceUrl } from '../platform/feedback';

export function IngredientPhotos({ ingredient, gallery, origin, canInteract }: {
  ingredient: Ingredient; gallery: PublicPhotoGallery | null; origin: string | null; canInteract: () => boolean;
}) {
  if (!gallery || !origin || gallery.ingredientId !== ingredient.id || gallery.name !== ingredient.name) return <IngredientVisual key={ingredient.id} ingredient={ingredient} large />;
  return <Gallery key={`${gallery.ingredientId}:${gallery.version}:${gallery.photos.map(photo => photo.sha256).join(':')}`} ingredient={ingredient} gallery={gallery} origin={origin} canInteract={canInteract} />;
}
function Gallery({ ingredient, gallery, origin, canInteract }: {
  ingredient: Ingredient; gallery: PublicPhotoGallery; origin: string; canInteract: () => boolean;
}) {
  const [index, setIndex] = useState(0);
  const photo = gallery.photos[index];
  if (!photo) return <IngredientVisual ingredient={ingredient} large />;
  return <View className='ingredient-photos'>
    <View className='ingredient-photos__frame'>
      <PhotoImage key={photo.sha256} url={publicPhotoUrl(origin, gallery, photo)} caption={photo.caption} canInteract={canInteract} />
      <Text className='ingredient-photos__count'>{index + 1} / {gallery.photos.length}</Text>
    </View>
    <View className='ingredient-photos__caption'>{photo.caption}</View>
    <View className='ingredient-photos__meta'>{photo.part} · {photo.processing}</View>
    {gallery.photos.length > 1 && <View className='ingredient-photos__switcher'>
      {gallery.photos.map((item, position) => <Button key={item.sha256} className={`ingredient-photos__choice${position === index ? ' ingredient-photos__choice--active' : ''}`}
        ariaLabel={`查看照片 ${position + 1}：${item.caption}`} onClick={() => { if (canInteract()) setIndex(position); }}>{position + 1} · {item.processing}</Button>)}
    </View>}
    <Disclosure key={photo.sha256} title='照片来源' summary={`${photo.author} · ${photo.license}`} canInteract={canInteract}>
      <View className='reading-copy'>{photo.modification}</View>
      <Button className='button button--text' onClick={() => { if (canInteract()) void copySourceUrl(photo.sourceUrl); }}>复制照片来源 ↗</Button>
      <Button className='button button--text' onClick={() => { if (canInteract()) void copySourceUrl(photo.licenseUrl); }}>复制许可链接 ↗</Button>
    </Disclosure>
  </View>;
}

/** Each displayed photo owns its loading attempt. A late event from a timed-out
 * or retried image cannot overwrite the current attempt's feedback. */
function PhotoImage({ url, caption, canInteract }: { url: string; caption: string; canInteract: () => boolean }) {
  const [state, setState] = useState<{ attempt: number; status: 'loading' | 'ready' | 'error' }>({ attempt: 0, status: 'loading' });
  const current = useRef(state);
  const settle = (status: 'ready' | 'error', attempt: number) => {
    if (current.current.attempt !== attempt || current.current.status !== 'loading') return;
    const next = { attempt, status }; current.current = next; setState(next);
  };
  useEffect(() => {
    if (state.status !== 'loading') return;
    const timer = setTimeout(() => settle('error', state.attempt), 15000);
    return () => clearTimeout(timer);
  }, [state.attempt, state.status]);
  if (state.status === 'error') return <View className='ingredient-photos__error'><Text>照片暂时无法加载</Text>
    <Button className='button button--soft' onClick={() => {
      if (!canInteract() || current.current.status !== 'error') return;
      const next = { attempt: current.current.attempt + 1, status: 'loading' as const }; current.current = next; setState(next);
    }}>重新加载</Button></View>;
  return <>
    <Image key={state.attempt} className='ingredient-photos__image' src={url} mode='aspectFit' ariaLabel={caption}
      onLoad={() => settle('ready', state.attempt)} onError={() => settle('error', state.attempt)} />
    {state.status === 'loading' && <Text className='ingredient-photos__loading'>照片加载中…</Text>}
  </>;
}
