export default defineAppConfig({
  pages: [
    'pages/catalog/index',
    'pages/favorites/index',
    'pages/compare/index',
    'pages/safety/index',
    'pages/about/index',
  ],
  subPackages: [{ root: 'subpackages/catalog', pages: ['detail/index'] }],
  window: {
    navigationBarBackgroundColor: '#f7f8f3',
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '食养图录',
    backgroundColor: '#f7f8f3',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#7d877b',
    selectedColor: '#264e39',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/catalog/index', text: '食材', iconPath: 'assets/tabbar/catalog.png', selectedIconPath: 'assets/tabbar/catalog-active.png' },
      { pagePath: 'pages/favorites/index', text: '收藏', iconPath: 'assets/tabbar/favorites.png', selectedIconPath: 'assets/tabbar/favorites-active.png' },
      { pagePath: 'pages/compare/index', text: '对比', iconPath: 'assets/tabbar/compare.png', selectedIconPath: 'assets/tabbar/compare-active.png' },
      { pagePath: 'pages/safety/index', text: '安全', iconPath: 'assets/tabbar/safety.png', selectedIconPath: 'assets/tabbar/safety-active.png' },
      { pagePath: 'pages/about/index', text: '关于', iconPath: 'assets/tabbar/about.png', selectedIconPath: 'assets/tabbar/about-active.png' },
    ],
  },
  lazyCodeLoading: 'requiredComponents',
});
