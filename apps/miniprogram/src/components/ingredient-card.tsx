import { Button, Text, View } from '@tarojs/components';
import type { Ingredient, PublicPhotoGallery } from '@food-education/catalog-core';
import { IngredientArtwork } from './ingredient-artwork';

export function IngredientCard({ ingredient, index, onOpen, favorite = false, onRemove, gallery, origin, compare }: {
  ingredient: Ingredient; index: number; onOpen: () => void; favorite?: boolean; onRemove?: () => void; gallery?: PublicPhotoGallery | undefined; origin?: string | null;
  compare?: { selected: boolean; disabled: boolean; full: boolean; onToggle: () => void };
}) {
  return <View className='ingredient-card'>
    <Button className='ingredient-card__open' onClick={onOpen} ariaLabel={`查看${ingredient.name}详情`}>
      <View className='ingredient-card__art'><IngredientArtwork ingredient={ingredient} gallery={gallery} origin={origin ?? null} />
        <Text className='ingredient-card__number' ariaHidden>{String(index + 1).padStart(2, '0')}</Text></View>
      <View className='ingredient-card__body'>
        <View className='ingredient-card__name'>{ingredient.name}</View>
        <View className='ingredient-card__pinyin'>{ingredient.pinyin}</View>
        <View className='ingredient-card__part'>{ingredient.partReview === 'source_checked' ? ingredient.partText : '部位尚待核对'}</View>
        <View className='ingredient-card__tags'>
          <Text className={`tag ${ingredient.partReview === 'source_checked' ? 'tag--green' : ''}`}>{ingredient.partReview === 'source_checked' ? '部位有来源' : '部位待核对'}</Text>
        </View>
      </View>
    </Button>
    {compare && <Button className={`ingredient-card__compare${compare.selected ? ' ingredient-card__compare--selected' : ''}`}
      disabled={compare.disabled} ariaLabel={`${compare.selected ? '移出' : '加入'}${ingredient.name}对比`} onClick={compare.onToggle}>
      {compare.selected ? '已选 · 移出对比' : compare.full ? '对比已选满' : '加入对比'}
    </Button>}
    {favorite && onRemove && <Button className='ingredient-card__remove' onClick={onRemove}>取消收藏</Button>}
  </View>;
}
