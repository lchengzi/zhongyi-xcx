"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const catalog = require("../data/ingredients");
const safety = require("../utils/safety");
const contract = require("../utils/public-catalog-contract");
const network = require("../utils/public-catalog");
const { checkNonMedicalRuntimeBoundary, checkRuntimeJsonProjections, renderRuntimeProjection, checkRuntimePackageImports } = require("./check-project");
const ROOT = path.resolve(__dirname, "..");
const config = { baseUrl: "https://content.example.test" };
const clone = (value) => JSON.parse(JSON.stringify(value));
let groups = 0;

async function group(name, action) {
  await action(); groups += 1; console.log(`[public-catalog] ${name}: passed`);
}

async function main() {
  await group("WeChat-compatible runtime projections remain bound to authoritative JSON", () => {
    checkRuntimeJsonProjections();
    const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const changed of ["config/public-api.js", "data/version-runtime.js"]) {
      assert.throws(() => checkRuntimeJsonProjections((relative) => read(relative) + (relative === changed ? "\nmodule.exports.extra = true;\n" : "")));
    }
    assert.throws(() => checkRuntimeJsonProjections((relative) => relative === "config/public-api.json" ? JSON.stringify(config) : read(relative)));
    assert.throws(() => checkRuntimeJsonProjections((relative) => {
      if (relative !== "data/version-active.json") return read(relative);
      return JSON.stringify({ ...JSON.parse(read(relative)), releaseDigest: "sha256:" + "0".repeat(64) });
    }));
    assert.strictEqual(renderRuntimeProjection({ baseUrl: "" }), read("config/public-api.js").replace(/\r\n/g, "\n"));
  });
  await group("runtime import guard rejects the original JSON-module regression", () => {
    const source = path.join(ROOT, "utils/public-catalog.js");
    assert.throws(() => checkRuntimePackageImports([source, path.join(ROOT, "config/public-api.json")],
      (filename) => filename === source ? 'require("../config/public-api.json");' : ""), /must target JavaScript/);
  });
  await group("catalog adapter boots with a JavaScript-only CommonJS loader", () => {
    const vm = require("node:vm"), modules = new Map();
    const load = (filename) => {
      assert(filename.startsWith(ROOT + path.sep));
      assert.strictEqual(path.extname(filename), ".js", "WeChat does not register JSON as executable modules");
      if (modules.has(filename)) return modules.get(filename).exports;
      const module = { exports: {} }; modules.set(filename, module);
      const requireJs = (request) => {
        assert(request.startsWith("."), "No Node modules in the mini runtime");
        const resolved = path.resolve(path.dirname(filename), request);
        return load(path.extname(resolved) ? resolved : resolved + ".js");
      };
      const fn = vm.runInNewContext("(function(require,module,exports){" + fs.readFileSync(filename, "utf8") + "\n})", { setTimeout, clearTimeout }, { filename });
      fn(requireJs, module, module.exports); return module.exports;
    };
    const client = load(path.join(ROOT, "utils/public-catalog.js"));
    assert.strictEqual(client.getState().mode, "offline");
    assert.strictEqual(client.getState().configured, false);
    const trusted = load(path.join(ROOT, "utils/public-catalog-contract.js"));
    assert.strictEqual(trusted.expectedEnvelope().items.length, 106);
    assert.strictEqual(trusted.expectedEnvelope().releaseDigest, JSON.parse(fs.readFileSync(path.join(ROOT, "data/version-active.json"), "utf8")).releaseDigest);
  });
  await group("offline default and HTTPS-only build configuration", async () => {
    assert.strictEqual(network.getState().mode, "offline");
    assert.strictEqual(network.getCatalog(), null);
    let requests = 0;
    for (const bad of [{ baseUrl: "" }, {}, { baseUrl: 42 }, { baseUrl: config.baseUrl, profile: {} },
      { baseUrl: "http://content.example.test" }, { baseUrl: "https://localhost" }, { baseUrl: "https://127.0.0.1" },
      { baseUrl: "https://user:password@content.example.test" }, { baseUrl: config.baseUrl + "/" },
      { baseUrl: config.baseUrl + "?symptoms=x" }, { baseUrl: config.baseUrl + "#fragment" },
      { baseUrl: "https://content.example.test:0" }, { baseUrl: "https://content.example.test:65536" }]) {
      const client = network.createClient(bad, () => { requests += 1; });
      assert.strictEqual((await client.load()).mode, "offline");
      assert.strictEqual(client.getState().configured, false);
    }
    assert.strictEqual(requests, 0);
    assert.strictEqual(network.validBaseUrl(config), config.baseUrl);
    assert.strictEqual(network.validBaseUrl({ baseUrl: config.baseUrl + ":8443" }), config.baseUrl + ":8443");
  });

  await group("exact snapshot and nested allowlists reject all remote changes", () => {
    const expected = contract.expectedEnvelope();
    assert.strictEqual(expected.items.length, catalog.count);
    assert.deepStrictEqual(contract.validate(clone(expected)), expected);
    const mutations = [
      (p) => { p.schemaVersion = "1"; }, (p) => { p.purpose = "clinical_recommendation"; },
      (p) => { p.releaseId += ".new"; }, (p) => { p.releaseDigest = "sha256:untrusted"; },
      (p) => { p.sourceAsOf = "2026-10-08"; }, (p) => { p.contentVersion += ".new"; },
      (p) => { p.privateDraft = "secret"; }, (p) => { p.items.pop(); },
      (p) => { p.items[0].professionalReviewState = "reviewed"; },
      (p) => { p.items[0].restriction = "safe for everyone"; },
      (p) => { p.items[0].ediblePart = "any part"; }, (p) => { p.items[0].safety = {}; },
      (p) => { p.items[0].aliases.push("remote alias"); },
      (p) => { p.items[0].sources[0].url = "https://attacker.example.test"; },
      (p) => { p.items[0].sources[0].privateEvidence = "secret"; },
      (p) => { p.items[0] = null; }, (p) => { delete p.items[0].identityState; },
      (p) => { p.items[1] = p.items[0]; }, (p) => { p.items.reverse(); }
    ];
    mutations.forEach((mutate) => { const value = clone(expected); mutate(value); assert.throws(() => contract.validate(value)); });
    for (const value of [null, [], "{}", {}, { ...expected, items: {} }]) assert.throws(() => contract.validate(value));
  });

  await group("real display projection preserves every local safety result", () => {
    const displayed = contract.forDisplay(contract.expectedEnvelope());
    assert.deepStrictEqual(displayed, catalog.ingredients);
    for (const profile of [
      {}, { ageGroup: "adult", pregnancy: "no", breastfeeding: "no", allergyStatus: "no", conditionStatus: "no", medicationStatus: "no" },
      { pregnancy: "yes" }, { ageGroup: "infant_toddler" }, { ageGroup: "older_adult" },
      { allergies: ["天麻"], allergyStatus: "yes" }, { conditions: ["高血压"], conditionStatus: "yes" },
      { medications: ["藜芦"], medicationStatus: "yes" }, { redFlags: ["sudden_severe_chest_pain"] }
    ]) {
      assert.deepStrictEqual(safety.evaluateCatalog(displayed, profile), safety.evaluateCatalog(catalog.ingredients, profile));
    }
  });

  await group("one fixed GET, deduplication, owned response and retry", async () => {
    let options; let calls = 0;
    const client = network.createClient(config, (input) => { options = input; calls += 1; return { abort() {} }; });
    const first = client.load(); assert.strictEqual(client.load(), first); assert.strictEqual(calls, 1);
    assert.strictEqual(client.getState().mode, "loading");
    assert.deepStrictEqual(Object.keys(options).sort(), ["url", "method", "header", "timeout", "dataType", "responseType", "success", "fail"].sort());
    assert.strictEqual(options.url, config.baseUrl + network.REQUEST_PATH); assert.strictEqual(options.method, "GET");
    assert.deepStrictEqual(options.header, { Accept: "application/json" }); assert.strictEqual(options.timeout, 6000);
    const response = contract.expectedEnvelope(); options.success({ statusCode: 200, data: response });
    assert.strictEqual((await first).mode, "online"); assert(client.getState().loadedAt);
    response.items[0].name = "later transport mutation";
    const displayed = client.getCatalog(); displayed[0].aliases.push("later page mutation");
    assert.deepStrictEqual(client.getCatalog(), catalog.ingredients);
    client.getState().mode = "forged"; assert.strictEqual(client.getState().mode, "online");
    const second = client.load(); options.fail({ errMsg: "fail" });
    assert.strictEqual((await second).mode, "fallback"); assert.strictEqual(client.getCatalog(), null);
    const third = client.load(); options.success({ statusCode: 200, data: contract.expectedEnvelope() });
    assert.strictEqual((await third).mode, "online");
    client.clear(); assert.strictEqual(client.getState().mode, "offline"); assert.strictEqual(client.getCatalog(), null);
  });

  await group("HTTP errors, malformed JSON, version mismatch and transport exceptions", async () => {
    for (const res of [{ statusCode: 401 }, { statusCode: 503 }, { statusCode: 304 },
      { statusCode: 200, data: "{broken" }, { statusCode: 200, data: {} },
      { statusCode: 200, data: { ...contract.expectedEnvelope(), sourceAsOf: "2026-10-08" } }]) {
      const client = network.createClient(config, (options) => { options.success(res); return {}; });
      assert.strictEqual((await client.load()).mode, "fallback"); assert.strictEqual(client.getCatalog(), null);
    }
    const client = network.createClient(config, () => { throw new Error("synthetic runtime failure"); });
    assert.strictEqual((await client.load()).mode, "fallback");
  });

  await group("clear aborts pending read; late callbacks cannot restore old data", async () => {
    const callbacks = []; let aborted = 0;
    const client = network.createClient(config, (options) => { callbacks.push(options); return { abort() { aborted += 1; options.fail({}); } }; });
    const first = client.load(); client.clear();
    assert.strictEqual((await first).mode, "offline"); assert.strictEqual(aborted, 1);
    const second = client.load(); callbacks[0].success({ statusCode: 200, data: contract.expectedEnvelope() });
    assert.strictEqual(client.getState().mode, "loading"); assert.strictEqual(client.getCatalog(), null);
    callbacks[1].success({ statusCode: 200, data: contract.expectedEnvelope() });
    assert.strictEqual((await second).mode, "online"); client.clear();
  });

  await group("deadline settles even when platform never calls success or fail", async () => {
    let aborted = false;
    const client = network.createClient(config, () => ({ abort() { aborted = true; } }));
    assert.strictEqual((await client.load()).mode, "fallback"); assert.strictEqual(aborted, true);
    assert.strictEqual(client.getCatalog(), null);
  });

  await group("narrow request gate retains account, upload and health boundaries", () => {
    const adapterFile = path.join(ROOT, "utils/public-catalog.js");
    const source = fs.readFileSync(adapterFile, "utf8");
    checkNonMedicalRuntimeBoundary(adapterFile);
    for (const code of ["wx.request({})", "wx['request']({})", "wx.login({})", "wx['login']({})", "wx.uploadFile({})", "wx . uploadFile({})", "wx.cloud.callFunction({})"]) {
      assert.throws(() => checkNonMedicalRuntimeBoundary(path.join(ROOT, "pages/index/index.js"), code));
    }
    for (const changed of [source + "\nwx.request({});", source + "\ngetApp();", source + "\nwx.getStorageSync('health');",
      source.replace('method: "GET"', 'method: "POST"'), source.replace('/api/v1/public/catalog', '/api/v1/editorial/sources')]) {
      assert.throws(() => checkNonMedicalRuntimeBoundary(adapterFile, changed));
    }
  });
  console.log(JSON.stringify({ publicCatalogGroups: groups, count: catalog.count, default: "offline", healthUploads: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
