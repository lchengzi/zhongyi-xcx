import { Image, Text, View } from '@tarojs/components';
import { publicPhotoUrl, type Ingredient, type PublicPhotoGallery } from '@food-education/catalog-core';
import { useState } from 'react';
import { IngredientVisual } from './ingredient-visual';

function CardPhoto({ ingredient, gallery, origin }: { ingredient: Ingredient; gallery: PublicPhotoGallery; origin: string }) {
  const [failed, setFailed] = useState(false), photo = gallery.photos[0];
  if (failed || !photo) return <IngredientVisual ingredient={ingredient} />;
  return <View className='ingredient-card-photo'>
    <Image className='ingredient-card-photo__image' src={publicPhotoUrl(origin, gallery, photo)} mode='aspectFit' lazyLoad ariaLabel={photo.caption} onError={() => setFailed(true)} />
    <View className='ingredient-card-photo__credit'><Text className='ingredient-card-photo__author'>{photo.author}</Text><Text>{photo.license}</Text></View>
  </View>;
}

/** Lists and comparison share the same verified image, credit and fallback. */
export function IngredientArtwork({ ingredient, gallery, origin }: {
  ingredient: Ingredient; gallery?: PublicPhotoGallery | undefined; origin?: string | null;
}) {
  return gallery && origin && gallery.ingredientId === ingredient.id && gallery.name === ingredient.name
    ? <CardPhoto key={`${gallery.version}:${gallery.photos[0]?.sha256}`} ingredient={ingredient} gallery={gallery} origin={origin} />
    : <IngredientVisual ingredient={ingredient} />;
}
