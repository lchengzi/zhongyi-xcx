// Original, code-native editorial symbols. These never represent specimens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'apps/miniprogram/src/assets');
const { chromium } = createRequire(path.join(root, 'zhongyi-platform/package.json'))('@playwright/test');
const symbols = {
  roots: `<path d="M126 57C122 37 133 27 150 23C153 38 146 54 126 57" fill="#a4b58b"/><path d="M121 58C103 50 93 40 96 26C114 26 128 38 121 58" fill="#728d67"/><path d="M125 54C124 75 107 82 104 100C100 123 114 143 128 151C142 141 154 120 147 101C142 87 127 76 125 54" fill="#c2a37a"/><path d="M124 82L128 133M109 103L130 109M112 117L135 123" fill="none" stroke="#9e7e5a" stroke-width="3"/><path d="M128 151L125 167M137 143L146 158M116 142L108 155" stroke="#b39770" fill="none" stroke-width="2"/>`,
  leaves: `<path d="M100 158Q137 113 143 36" stroke="#617d59" stroke-width="4" fill="none"/><path d="M130 91Q86 90 88 53Q126 52 130 91" fill="#a2b68e"/><path d="M139 70Q173 65 171 33Q140 31 139 70" fill="#6f8a61"/><path d="M119 124Q73 122 73 85Q108 87 119 124" fill="#799669"/><path d="M129 111Q169 119 183 82Q148 72 129 111" fill="#b0bf9b"/><path d="M132 90L102 66M140 68L161 43M116 123L87 97M132 110L168 90" stroke="#f4f0e5" fill="none" stroke-width="2"/>`,
  fruits: `<path d="M117 60Q133 44 145 28" stroke="#6c815b" stroke-width="4" fill="none"/><path d="M134 43Q158 17 181 32Q168 58 134 43" fill="#8d9f72"/><ellipse cx="115" cy="108" rx="43" ry="51" fill="#b97852"/><ellipse cx="148" cy="119" rx="36" ry="42" fill="#cf9c6e"/><path d="M88 83Q79 102 85 122M131 96Q126 107 130 119" stroke="#e5c4a0" fill="none" stroke-width="4" stroke-linecap="round"/><path d="M109 57L119 67L128 56M143 77L149 85L157 79" stroke="#7b6543" fill="none" stroke-width="3"/>`,
  seeds: `<path d="M62 113Q128 100 194 113L177 153Q128 173 79 153Z" fill="#b6be9f"/><ellipse cx="128" cy="114" rx="66" ry="16" fill="#6d8367"/><g fill="#d9bc81" stroke="#b29768" stroke-width="2"><ellipse cx="97" cy="105" rx="12" ry="8" transform="rotate(-24 97 105)"/><ellipse cx="122" cy="108" rx="12" ry="8" transform="rotate(18 122 108)"/><ellipse cx="148" cy="105" rx="12" ry="8" transform="rotate(-20 148 105)"/><ellipse cx="172" cy="112" rx="10" ry="7"/><ellipse cx="110" cy="91" rx="12" ry="8" transform="rotate(15 110 91)"/><ellipse cx="139" cy="91" rx="12" ry="8" transform="rotate(-28 139 91)"/></g><path d="M110 137Q128 145 147 136" fill="none" stroke="#d9decb" stroke-width="3"/>`,
  flowers: `<path d="M125 150Q140 108 128 68" fill="none" stroke="#7b9567" stroke-width="4"/><path d="M130 123Q94 122 91 99Q120 98 130 123" fill="#9cad86"/><path d="M133 106Q162 108 170 83Q142 82 133 106" fill="#6f885f"/><g fill="#cfb3a2"><ellipse cx="129" cy="48" rx="15" ry="26"/><ellipse cx="108" cy="63" rx="15" ry="25" transform="rotate(-65 108 63)"/><ellipse cx="150" cy="63" rx="15" ry="25" transform="rotate(65 150 63)"/><ellipse cx="116" cy="84" rx="15" ry="24" transform="rotate(-145 116 84)"/><ellipse cx="142" cy="84" rx="15" ry="24" transform="rotate(145 142 84)"/></g><circle cx="129" cy="69" r="13" fill="#b89b57"/><circle cx="126" cy="66" r="3" fill="#e0cc8c"/>`,
  archive: `<path d="M62 53Q96 42 128 57Q160 42 194 53L194 146Q161 137 128 153Q95 137 62 146Z" fill="#f5f0e1" stroke="#9ba689" stroke-width="3"/><path d="M128 57L128 153" stroke="#9ba689" stroke-width="3"/><path d="M75 70Q96 64 114 72M75 83Q95 77 114 84M75 96Q95 90 114 97M142 123Q162 116 181 121M142 136Q162 128 181 133" stroke="#c8c8b1" stroke-width="3" fill="none"/><path d="M158 111Q158 87 165 68" stroke="#738b65" fill="none" stroke-width="3"/><path d="M163 87Q142 88 144 71Q158 68 163 87M161 100Q181 99 180 81Q164 81 161 100" fill="#93a77d"/>`,
};

function svg(body, width = 256, height = 192, color = '#7d877b') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 256 192"><g stroke-linecap="round" stroke-linejoin="round" color="${color}">${body}</g></svg>`;
}
for (const sub of ['illustrations', 'tabbar']) fs.mkdirSync(path.join(target, sub), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 192 }, deviceScaleFactor: 1 });
  for (const [name, body] of Object.entries(symbols)) {
    const filename = path.join(target, 'illustrations', name + '.png');
    if (fs.existsSync(filename)) throw new Error('Preserving existing art: ' + name);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(`<ellipse cx="128" cy="164" rx="65" ry="6" fill="#d5cdb7" opacity=".35"/>` + body)}</body></html>`);
    await page.screenshot({ path: filename, omitBackground: true });
  }
  for (const name of ['catalog', 'favorites', 'compare', 'safety']) for (const suffix of ['', '-active']) {
    const filename = path.join(target, 'tabbar', name + suffix + '.png');
    if (fs.existsSync(filename)) throw new Error('Preserving existing icon: ' + name + suffix);
    fs.copyFileSync(path.join(root, 'zhongyi/assets/tabbar', name + suffix + '.png'), filename);
  }
  // Fifth tab extends the established small outline icon family.
  await page.setViewportSize({ width: 96, height: 96 });
  for (const [suffix, color] of [['', '#7d877b'], ['-active', '#264e39']]) {
    const filename = path.join(target, 'tabbar', 'about' + suffix + '.png');
    if (fs.existsSync(filename)) throw new Error('Preserving existing about icon');
    await page.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="29" fill="none" stroke="${color}" stroke-width="5"/><path d="M48 44V65M48 31V32" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/></svg></body></html>`);
    await page.screenshot({ path: filename, omitBackground: true });
  }
  console.log('Rendered six original decorative symbols and ten navigation icons; no private photos read.');
} finally { await browser.close(); }
