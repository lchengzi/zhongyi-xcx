"use strict";
// Build native tabBar PNGs from first-party, code-owned SVGs. Not food photos.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("playwright");
const mini = path.resolve(__dirname, "../../zhongyi");
function ordinaryDirectory(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(fs.realpathSync(current).toLowerCase(), current.toLowerCase());
    if (path.dirname(current) === current) return;
  }
}
async function main() {
  assert.equal(process.argv.length, 2, "no arbitrary paths or overwrite arguments");
  ordinaryDirectory(mini);
  const directory = path.join(mini, "assets", "tabbar");
  for (const current of [path.dirname(directory), directory]) {
    if (!fs.existsSync(current)) fs.mkdirSync(current); ordinaryDirectory(current);
  }
  const jobs = [];
  for (const name of ["catalog", "favorites", "compare", "safety"]) {
    const source = fs.readFileSync(path.join(mini, "tools", "tab-icons", name + ".svg"), "utf8");
    assert(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert(!/<(?:script|image|foreignObject)|(?:href|url\()|on\w+=/.test(source));
    for (const [suffix, color] of [["", "#617066"], ["-active", "#245b46"]]) {
      const output = path.join(directory, name + suffix + ".png");
      assert(!fs.existsSync(output), "stop: generated icon already exists; no silent overwrite");
      jobs.push({ source, output, color });
    }
  }
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  let networkAttempts = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 72, height: 72 }, deviceScaleFactor: 1 });
    await page.route("**/*", route => { networkAttempts++; return route.abort(); });
    for (const job of jobs) {
      await page.setContent(`<style>body{margin:0;color:${job.color}}svg{display:block}</style>${job.source}`);
      const bytes = await page.screenshot({ omitBackground: true });
      assert(bytes.length < 40000); assert.equal(bytes.readUInt32BE(16), 72); assert.equal(bytes.readUInt32BE(20), 72);
      fs.writeFileSync(job.output, bytes, { flag: "wx" });
    }
  } finally { await browser.close(); }
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ generated: jobs.length, size: "72x72", networkAttempts, outputs: jobs.map(job => path.relative(mini, job.output)) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
