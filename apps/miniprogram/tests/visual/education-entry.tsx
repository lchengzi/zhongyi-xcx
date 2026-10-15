import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import Detail from '../../src/subpackages/catalog/detail';
import About from '../../src/pages/about';
import { connectivity } from '../../src/platform/connectivity';
import { safetySession } from '../../src/features/safety';
import { RED_FLAG_OPTIONS } from '@food-education/catalog-core';
import { TestPageVisibility, emitTestConnectivity, confirmNextTestModal } from './taro';

// All controls below are test-only, outside product source and build roots.
emitTestConnectivity(true);
function Fixture() {
  const [tab, setTab] = useState<'detail' | 'about'>('detail');
  const [visitedAbout, setVisitedAbout] = useState(false);
  const [, redraw] = useState(0);
  useEffect(() => connectivity.start(), []);
  const showDetail = (id = 'bai-he') => {
    location.hash = `/subpackages/catalog/detail/index?id=${id}`; setTab('detail'); redraw(value => value + 1);
  };
  return <><nav className='test-navigation' aria-label='仅测试连接与生命周期'>
    <button onClick={() => emitTestConnectivity(false)}>测试断网</button>
    <button onClick={() => emitTestConnectivity(true)}>测试重连</button>
    <button onClick={() => { setVisitedAbout(true); setTab('about'); }}>测试关于页</button>
    <button onClick={() => showDetail()}>测试百合页</button>
    <button onClick={() => showDetail('shan-yao')}>测试山药页</button>
    <button onClick={confirmNextTestModal}>允许下一次测试确认</button>
    <button onClick={() => { const current = safetySession.getSnapshot(); safetySession.clear(current.revision); }}>清除测试会话</button>
    <button onClick={() => { const flag = RED_FLAG_OPTIONS[0]; if (!flag) throw new Error('Missing fixture red flag');
      const current = safetySession.getSnapshot(); safetySession.addRedFlags([flag.value], current.revision); }}>添加测试红旗</button>
  </nav>
    <TestPageVisibility.Provider value={tab === 'detail'}><div id='test-detail' hidden={tab !== 'detail'}><Detail /></div></TestPageVisibility.Provider>
    {visitedAbout && <TestPageVisibility.Provider value={tab === 'about'}><div id='test-about' hidden={tab !== 'about'}><About /></div></TestPageVisibility.Provider>}
  </>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing owned education-fixture root');
createRoot(root).render(<Fixture />);
