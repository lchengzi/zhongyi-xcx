import { createRoot } from 'react-dom/client';
import { useState, useSyncExternalStore } from 'react';
import Detail from '../../src/subpackages/catalog/detail';
import About from '../../src/pages/about';
import Favorites from '../../src/pages/favorites';
import Compare from '../../src/pages/compare';
import Catalog from '../../src/pages/catalog';
import { safetySession } from '../../src/features/safety';
import { favoritesBrowse } from '../../src/features/browsing';
import { catalogResult } from '../../src/data/catalog';
import { storageProbe, faultControls, TestPageVisibility } from './storage-taro';

// Deliberately synthetic session, never real health input or device records.
safetySession.saveProfile({ ageGroup: 'adult' }, 0);
safetySession.setChecks(['identity'], safetySession.getSnapshot().revision);
type Tab = 'detail' | 'about' | 'favorites' | 'compare' | 'catalog';
function Fixture() {
  const [tab, setTab] = useState<Tab>('detail');
  const [visited, setVisited] = useState<readonly Tab[]>(['detail']);
  const storage = useSyncExternalStore(storageProbe.subscribe, storageProbe.getSnapshot);
  const safety = useSyncExternalStore(safetySession.subscribe, safetySession.getSnapshot);
  const browse = useSyncExternalStore(favoritesBrowse.subscribe, favoritesBrowse.getSnapshot);
  const [, capturePosition] = useState(0);
  const navigate = (next: Tab) => { setVisited(values => values.includes(next) ? values : [...values, next]); setTab(next); };
  const controls = [
    ['模拟读取失败', () => faultControls.failReads(true)], ['恢复读取', () => faultControls.failReads(false)],
    ['模拟对比读取失败', () => faultControls.failCompareReads(true)], ['恢复对比读取', () => faultControls.failCompareReads(false)],
    ['模拟对比写入拒绝', () => faultControls.compareWrite('throw')], ['模拟忽略对比写入', () => faultControls.compareWrite('ignore')],
    ['模拟对比写后读取失败', () => faultControls.compareWrite('readback-failed')], ['恢复对比写入', () => faultControls.compareWrite('normal')],
    ['模拟空对比记录', () => faultControls.replaceCompare([])],
    ['模拟格式异常', faultControls.malformed], ['恢复原始记录', faultControls.restoreRecords],
    ['模拟同数量变更', faultControls.replaceSameCount],
    ['模拟旧对比记录', () => faultControls.replaceCompare(['bai-he', 'retired-one', 'retired-two', 'retired-three'])],
    ['模拟全旧对比记录', () => faultControls.replaceCompare(['retired-one', 'retired-two'])],
    ['模拟更新旧对比记录', () => faultControls.replaceCompare(['shan-yao', 'retired-one', 'retired-two'])],
    ['模拟旧收藏记录', () => faultControls.replaceFavorites(['shan-yao', 'retired-one'])],
    ['模拟多项旧收藏', () => faultControls.replaceFavorites(Array.from({ length: 25 }, (_, index) => `retired-${index + 1}`))],
    ['模拟多项收藏', () => {
      if (!catalogResult.ok) throw new Error('Actual catalog required');
      faultControls.replaceFavorites(catalogResult.catalog.ingredients.filter(item => item.id !== 'bai-he').slice(0, 30).map(item => item.id));
    }],
    ['设置列表测试位置', () => { favoritesBrowse.savePosition(650, favoritesBrowse.getSnapshot().revision); capturePosition(value => value + 1); }],
    ['模拟写入拒绝', () => faultControls.write('throw')], ['模拟忽略写入', () => faultControls.write('ignore')],
    ['模拟写后报错', () => faultControls.write('persist-throw')], ['模拟写后读取失败', () => faultControls.write('readback-failed')],
    ['恢复正常写入', () => faultControls.write('normal')],
    ['模拟对比删除失败', () => faultControls.remove('throw')], ['模拟忽略对比删除', () => faultControls.remove('ignore')],
    ['模拟对比删除后报错', () => faultControls.remove('persist-throw')], ['恢复正常删除', () => faultControls.remove('normal')],
    ['测试确认删除', () => faultControls.modal('confirm')], ['测试取消删除', () => faultControls.modal('cancel')],
    ['测试确认异常', () => faultControls.modal('reject')], ['等待确认', () => faultControls.modal('defer')],
    ['返回删除确认', faultControls.resolveModal],
    ['模拟新安全信息', () => safetySession.saveProfile({ ageGroup: 'older_adult' }, safetySession.getSnapshot().revision)],
  ] as const;
  return <><nav className='test-navigation' aria-label='仅测试存储故障'>
    <button onClick={() => navigate('detail')}>测试详情页</button><button onClick={() => navigate('about')}>测试关于页</button>
    <button onClick={() => navigate('favorites')}>测试收藏页</button>
    <button onClick={() => navigate('compare')}>测试对比页</button>
    <button onClick={() => navigate('catalog')}>测试目录页</button>
    {controls.map(([label, action]) => <button key={label} onClick={() => { action(); }}>{label}</button>)}
  </nav><details><summary>仅测试状态</summary><pre id='test-storage-state'>{storage}</pre>
    <pre id='test-session-state'>{JSON.stringify({ revision: safety.revision, clearEpoch: safety.clearEpoch, checks: safety.checks.length })}</pre></details>
    <pre id='test-browse-state' hidden>{JSON.stringify({ ...browse, position: favoritesBrowse.position() })}</pre>
    {visited.map(name => <TestPageVisibility.Provider key={name} value={tab === name}><div id={`test-${name}`} hidden={tab !== name}>
      {name === 'detail' ? <Detail /> : name === 'about' ? <About /> : name === 'compare' ? <Compare /> : name === 'catalog' ? <Catalog /> : <Favorites />}
    </div></TestPageVisibility.Provider>)}
  </>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing owned storage-fixture root');
createRoot(root).render(<Fixture />);
