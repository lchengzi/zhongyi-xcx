import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Catalog from '../../src/pages/catalog';
import Favorites from '../../src/pages/favorites';
import Compare from '../../src/pages/compare';
import Safety from '../../src/pages/safety';
import About from '../../src/pages/about';
import Detail from '../../src/subpackages/catalog/detail';
import { connectivity } from '../../src/platform/connectivity';
import { initializeEmptyDemoSelections, emitTestConnectivity, confirmNextTestModal } from './taro';
import catalogIcon from '../../src/assets/tabbar/catalog.png';
import favoritesIcon from '../../src/assets/tabbar/favorites.png';
import compareIcon from '../../src/assets/tabbar/compare.png';
import safetyIcon from '../../src/assets/tabbar/safety.png';
import aboutIcon from '../../src/assets/tabbar/about.png';

initializeEmptyDemoSelections(); emitTestConnectivity(true);
const tabs = [
  ['catalog', '食材', catalogIcon], ['favorites', '收藏', favoritesIcon], ['compare', '对比', compareIcon],
  ['safety', '安全', safetyIcon], ['about', '关于', aboutIcon],
] as const;
function Demo() {
  const [route, setRoute] = useState(location.hash || '/pages/catalog/index');
  useEffect(() => { const change = () => { setRoute(location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => connectivity.start(), []);
  const detail = route.includes('catalog/detail');
  const Page = detail ? Detail : route.includes('/favorites/') ? Favorites : route.includes('/compare/') ? Compare
    : route.includes('/safety/') ? Safety : route.includes('/about/') ? About : Catalog;
  return <>
    <header className='demo-frame__header'>
      {detail && <button id='demo-back' onClick={() => { location.hash = '/pages/catalog/index'; }}>返回</button>}
      <strong>食养图录</strong><small>浏览器流程演示</small>
    </header>
    <main><Page key={route} /></main>
    {!detail && <nav className='demo-frame__tabs' aria-label='演示页面导航'>{tabs.map(([id, label, icon]) =>
      <button key={id} id={`demo-tab-${id}`} aria-current={route.includes(`/pages/${id}/`) ? 'page' : undefined}
        onClick={() => { location.hash = `/pages/${id}/index`; }}><img src={icon} alt='' /><span>{label}</span></button>
    )}</nav>}
    <button id='demo-confirm-delete' hidden onClick={confirmNextTestModal}>仅允许下一次模拟确认</button>
  </>;
}
const root = document.getElementById('root'); if (!root) throw new Error('Owned recording fixture root required');
createRoot(root).render(<Demo />);
