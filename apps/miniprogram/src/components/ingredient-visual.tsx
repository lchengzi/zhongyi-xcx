import { Image, Text, View } from '@tarojs/components';
import type { Ingredient } from '@food-education/catalog-core';
import { useState } from 'react';
import rootArt from '../assets/illustrations/roots.png';
import leafArt from '../assets/illustrations/leaves.png';
import fruitArt from '../assets/illustrations/fruits.png';
import seedArt from '../assets/illustrations/seeds.png';
import flowerArt from '../assets/illustrations/flowers.png';
import archiveArt from '../assets/illustrations/archive.png';

// Decorative part symbols, not photographs, species identification or approval.
// A pending part never acquires an inferred edible-part label from its name.
function artwork(ingredient: Ingredient): { src: string; label: string; tone: string } {
  if (ingredient.partReview !== 'source_checked') return { src: archiveArt, label: '资料图录', tone: 'paper' };
  const part = ingredient.partText;
  if (/根|茎|鳞茎/.test(part)) return { src: rootArt, label: '部位示意', tone: 'sand' };
  if (/花/.test(part)) return { src: flowerArt, label: '部位示意', tone: 'rose' };
  if (/叶/.test(part)) return { src: leafArt, label: '部位示意', tone: 'sage' };
  if (/种子|种仁|仁/.test(part)) return { src: seedArt, label: '部位示意', tone: 'oat' };
  if (/果/.test(part)) return { src: fruitArt, label: '部位示意', tone: 'clay' };
  return { src: archiveArt, label: '资料图录', tone: 'paper' };
}

export function IngredientVisual({ ingredient, large = false }: { ingredient: Ingredient; large?: boolean }) {
  const art = artwork(ingredient);
  const [failed, setFailed] = useState(false);
  return <View className={`ingredient-visual ingredient-visual--${art.tone}${large ? ' ingredient-visual--large' : ''}`}>
    {failed ? <Text className='ingredient-visual__fallback' ariaHidden>{ingredient.name.slice(0, 1)}</Text>
      : <Image className='ingredient-visual__image' src={art.src} mode='aspectFit' lazyLoad={!large} ariaHidden onError={() => { setFailed(true); }} />}
    <Text className='ingredient-visual__caption'>{art.label}</Text>
  </View>;
}
