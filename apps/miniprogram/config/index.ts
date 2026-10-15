import { defineConfig } from '@tarojs/cli';
import path from 'node:path';
import { PublicContentManifestPlugin, readPublicContentOrigin } from './public-content-build';
import { readBuildOutput } from './build-output';

const publicOrigin = readPublicContentOrigin(process.env);

export default defineConfig<'webpack5'>({
  projectName: 'food-education-ts',
  date: '2026-10-11',
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: readBuildOutput(process.env),
  framework: 'react',
  compiler: { type: 'webpack5', errorLevel: 1, prebundle: { enable: false } },
  cache: { enable: false },
  plugins: ['@tarojs/plugin-platform-weapp'],
  copy: { patterns: [{ from: 'src/assets/tabbar', to: 'assets/tabbar' }], options: {} },
  defineConstants: { __FOOD_EDUCATION_PUBLIC_ORIGIN__: JSON.stringify(publicOrigin) },
  mini: {
    compile: { include: [path.resolve(__dirname, '../../../packages/catalog-core/src')] },
    webpackChain(chain) {
      chain.plugin('public-content-manifest').use(PublicContentManifestPlugin, [publicOrigin]);
      // Shared ESM source keeps .js import specifiers for future server builds.
      chain.resolve.set('extensionAlias', { '.js': ['.js', '.ts', '.tsx'] });
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false }
    }
  }
});
