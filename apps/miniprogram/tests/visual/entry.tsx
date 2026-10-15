import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import About from '../../src/pages/about';
import Catalog from '../../src/pages/catalog';
import Compare from '../../src/pages/compare';
import Detail from '../../src/subpackages/catalog/detail';
import Favorites from '../../src/pages/favorites';
import Safety from '../../src/pages/safety';
import { connectivity } from '../../src/platform/connectivity';

function Fixture() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const change = () => { setRoute(location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => connectivity.start(), []);
  const Page = route.includes('catalog/detail') ? Detail : route.includes('compare') ? Compare : route.includes('/catalog/') ? Catalog
    : route.includes('favorites') ? Favorites : route.includes('safety') ? Safety : About;
  return <><nav aria-label='仅测试页面导航' className='test-navigation'>
    {[['about', '关于'], ['catalog', '目录'], ['compare', '对比'], ['favorites', '收藏页'], ['safety', '安全页']].map(([id, label]) =>
      <button key={id} onClick={() => { location.hash = `/pages/${id}/index`; }}>{label}</button>)}
    {[['bai-he', '百合'], ['shan-yao', '山药'], ['lian-zi', '莲子'], ['yi-yi-ren', '薏苡仁']].map(([id, name]) =>
      <button key={id} onClick={() => { location.hash = `/subpackages/catalog/detail/index?id=${id}`; }}>{name}详情</button>)}
  </nav><Page key={route} /></>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing owned layout-fixture root');
createRoot(root).render(<Fixture />);
