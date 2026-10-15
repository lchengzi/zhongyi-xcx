import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'zhongyi', 'project.config.json');
const destination = path.join(root, 'apps', 'miniprogram', 'project.config.json');
const original = JSON.parse(fs.readFileSync(source, 'utf8'));
if (typeof original.appid !== 'string' || !/^wx[0-9a-f]{16}$/i.test(original.appid)) {
  throw new Error('The existing project must have a valid configured AppID. No account is changed.');
}
const result = {
  description: '食养资料馆 TypeScript 微信验证工程',
  miniprogramRoot: 'dist/',
  projectname: 'food-education-ts',
  appid: original.appid,
  compileType: 'miniprogram',
  libVersion: original.libVersion || '3.7.6',
  setting: {
    urlCheck: true, es6: false, enhance: false, postcss: false,
    minified: true, minifyWXSS: true, minifyWXML: true,
    uploadWithSourceMap: false, compileHotReLoad: false,
    ignoreUploadUnusedFiles: false
  },
  packOptions: { ignore: [{ type: 'suffix', value: '.map' }], include: [] }
};
if (fs.existsSync(destination)) {
  const current = JSON.parse(fs.readFileSync(destination, 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(result)) {
    throw new Error('A different mini project configuration already exists; it was preserved.');
  }
} else fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log('Local Taro project configuration ready; existing AppID reused without printing it.');
