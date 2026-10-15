import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Catalog from '../../src/pages/catalog';
import Favorites from '../../src/pages/favorites';
import Detail from '../../src/subpackages/catalog/detail';
import About from '../../src/pages/about';
import Compare from '../../src/pages/compare';
import Safety from '../../src/pages/safety';
import { connectivity } from '../../src/platform/connectivity';
import { safetySession } from '../../src/features/safety';
import { RED_FLAG_OPTIONS, assessIngredient, findIngredient } from '@food-education/catalog-core';
import { catalogResult } from '../../src/data/catalog';
import { TestPageVisibility, emitTestConnectivity, confirmNextTestModal, initializeEmptyDemoSelections } from './taro';
initializeEmptyDemoSelections();
emitTestConnectivity(true);
type Tab = 'catalog' | 'favorites' | 'detail' | 'about' | 'compare' | 'safety';
function Fixture() {
  const [tab, setTab] = useState<Tab | null>('catalog'), [visited, setVisited] = useState<readonly Tab[]>(['catalog']), [detailId, setDetailId] = useState('bai-he');
  const show = (next: Tab) => {
    // Native navigation hides the old page before showing the next. Model two
    // commits so one page's hide cannot invalidate another page's fresh read.
    flushSync(() => setTab(null));
    setVisited(current => current.includes(next) ? current : [...current, next]); setTab(next);
  };
  const goTab = (next: Exclude<Tab, 'detail'>) => {
    const hash = `#/pages/${next}/index`;
    if (location.hash === hash) show(next); else location.hash = hash;
  };
  const safety = useSyncExternalStore(safetySession.subscribe, safetySession.getSnapshot, safetySession.getSnapshot);
  const detailItem = catalogResult.ok ? findIngredient(catalogResult.catalog, detailId) : undefined;
  useEffect(() => {
    const change = () => {
      if (location.hash.includes('catalog/detail')) { setDetailId(new URLSearchParams(location.hash.split('?')[1]).get('id') ?? 'bai-he'); show('detail'); }
      else if (location.hash.includes('/favorites/')) show('favorites'); else if (location.hash.includes('/about/')) show('about');
      else if (location.hash.includes('/compare/')) show('compare'); else if (location.hash.includes('/safety/')) show('safety'); else show('catalog');
    };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => connectivity.start(), []);
  return <><nav className='test-navigation' aria-label='仅工程照片验证'>
    <p>工程测试色块，不是食材照片；模拟微信适配不代表真机验收。</p>
    <button onClick={() => goTab('catalog')}>测试目录</button><button onClick={() => goTab('favorites')}>测试收藏</button><button onClick={() => goTab('about')}>测试关于</button>
    <button onClick={() => goTab('compare')}>测试对比</button><button onClick={() => goTab('safety')}>测试安全</button>
    <button onClick={() => emitTestConnectivity(false)}>测试断网</button><button onClick={() => emitTestConnectivity(true)}>测试重连</button>
    <button onClick={confirmNextTestModal}>允许下一次测试确认</button>
    <button onClick={() => { const snapshot = safetySession.getSnapshot(); safetySession.clear(snapshot.revision); }}>清除测试会话</button>
    <button onClick={() => { const snapshot = safetySession.getSnapshot(), flag = RED_FLAG_OPTIONS[0]; if (flag) safetySession.addRedFlags([flag.value], snapshot.revision); }}>添加测试红旗</button>
  </nav>
    <output id='test-detail-assessment' hidden>{JSON.stringify({ assessment: assessIngredient(detailItem, safety.profile), riskNotes: detailItem?.riskNotes ?? [] })}</output>
    <TestPageVisibility.Provider value={tab === 'catalog'}><div id='catalog-fixture' hidden={tab !== 'catalog'}><Catalog /></div></TestPageVisibility.Provider>
    {visited.includes('favorites') && <TestPageVisibility.Provider value={tab === 'favorites'}><div id='favorites-fixture' hidden={tab !== 'favorites'}><Favorites /></div></TestPageVisibility.Provider>}
    {visited.includes('detail') && <TestPageVisibility.Provider value={tab === 'detail'}><div id='detail-fixture' hidden={tab !== 'detail'}><Detail key={detailId} /></div></TestPageVisibility.Provider>}
    {visited.includes('about') && <TestPageVisibility.Provider value={tab === 'about'}><div id='about-fixture' hidden={tab !== 'about'}><About /></div></TestPageVisibility.Provider>}
    {visited.includes('compare') && <TestPageVisibility.Provider value={tab === 'compare'}><div id='compare-fixture' hidden={tab !== 'compare'}><Compare /></div></TestPageVisibility.Provider>}
    {visited.includes('safety') && <TestPageVisibility.Provider value={tab === 'safety'}><div id='safety-fixture' hidden={tab !== 'safety'}><Safety /></div></TestPageVisibility.Provider>}
  </>;
}
const root = document.getElementById('root'); if (!root) throw new Error('Missing owned catalog-photo fixture'); createRoot(root).render(<Fixture />);
