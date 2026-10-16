import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { parsePublicPhotoGallery } from '@food-education/catalog-core';
import { catalogResult } from '../../src/data/catalog';
import { IngredientPhotos } from '../../src/components/ingredient-photos';
if (!catalogResult.ok) throw new Error('Catalog unavailable');
const ingredient = catalogResult.catalog.ingredients[0]!;
const now = Date.now();
const gallery = parsePublicPhotoGallery({ schemaVersion: 'public-photo-gallery.1', ingredientId: ingredient.id, name: ingredient.name, baseReleaseId: 'test-release',
  version: 1, publishedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 60000).toISOString(),
  photos: ['a', 'b'].map((hash, index) => ({ sha256: `sha256:${hash.repeat(64)}`, width: 96, height: 48, bytes: 300, caption: `工程测试图 ${index + 1}（非食材照片）`,
    part: '工程测试部位', processing: `形态 ${index + 1}`, author: '工程测试作者', sourceUrl: 'https://example.test/source', license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', modification: '工程测试素材，不作食材鉴别或实际授权证明。' }))
}, { ingredientId: ingredient.id, name: ingredient.name, baseReleaseId: 'test-release' }, now);
function App() {
  const [active, setActive] = useState(true);
  const allowed = useRef(true);
  return <main className='page'><p>仅工程交互验证，非实际公开食材</p><button id='withdraw' onClick={() => setActive(false)}>模拟撤回</button>
    <button id='block-interaction' onClick={() => { allowed.current = false; }}>暂停测试交互</button>
    <button id='resume-interaction' onClick={() => { allowed.current = true; }}>恢复测试交互</button>
    <IngredientPhotos ingredient={ingredient} gallery={active ? gallery : null} origin='https://photos.example.test' canInteract={() => active && allowed.current} /></main>;
}
const root = document.getElementById('root'); if (!root) throw new Error('Missing root'); createRoot(root).render(<App />);
