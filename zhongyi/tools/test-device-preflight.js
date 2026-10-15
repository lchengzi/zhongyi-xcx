"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatePreparation, inspectPreparation, requireNoArguments } = require("./device-preflight");
const root = path.resolve(__dirname, "..");
const project = { appid: "touristappid", libVersion: "3.7.6", setting: { urlCheck: true } };
const app = { pages: Array(5).fill("fictional-page"), subPackages: [{}, {}] };
const evaluate = (p = project, a = app, api = { baseUrl: "" }, privatePresent = false) => evaluatePreparation(p, a, api, privatePresent);

test("actual project inspection reports preparation without running or accepting the product", () => {
  const report = inspectPreparation();
  const actual = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
  assert.equal(report.project.urlCheckEnabled, actual.setting.urlCheck === true);
  assert.equal(report.project.baseLibraryBaselinePinned, actual.libVersion === "3.7.6");
  assert.equal(report.readyForDeviceAcceptance, false); assert.equal(report.inspectionSucceeded, true);
});
test("tourist identity and an empty service origin retain their distinct external prerequisites", () => {
  const report = evaluate();
  assert.equal(report.project.appIdState, "tourist"); assert.equal(report.project.requestOriginState, "not_configured");
  assert.equal(report.prerequisites.find((p) => p.id === "real_app_id_and_account_permission").state, "required");
  assert.equal(report.prerequisites.find((p) => p.id === "https_service_and_wechat_request_domain").scope, "online_catalog_only");
  assert.equal(report.project.mainPageCount, 5); assert.equal(report.project.subpackageCount, 2);
});
test("configured identifiers and an HTTPS origin do not prove ownership, TLS, domain registration or devices", () => {
  const report = evaluate({ ...project, appid: "fictional-configured-id" }, app, { baseUrl: "https://content.example.test" });
  assert.equal(report.project.appIdState, "configured_not_verified");
  assert.equal(report.project.requestOriginState, "https_origin_configured_not_verified");
  assert.equal(report.prerequisites[0].state, "unverified");
  assert.equal(report.readyForDeviceAcceptance, false); assert.equal(report.deploymentVerified, false);
});
test("disabled domain validation is reported, not repaired or treated as a successful workaround", () => {
  const report = evaluate({ ...project, setting: { urlCheck: false } });
  assert.equal(report.project.urlCheckEnabled, false);
  assert.equal(report.prerequisites.find((p) => p.id === "domain_validation_enabled").state, "needs_correction");
  assert.equal(report.readyForDeviceAcceptance, false);
});
test("private local overrides require effective configuration inspection without reading their values", () => {
  const report = evaluate(project, app, { baseUrl: "" }, true);
  assert.equal(report.project.privateConfigPresent, true); assert.equal(report.project.effectiveDevtoolsConfigurationVerified, false);
  assert.equal(report.prerequisites.at(-1).state, "manual_effective_configuration_check_required");
});
test("readiness output never includes supplied identifiers URLs or extra secret-like settings", () => {
  const encoded = JSON.stringify(evaluate({ ...project, appid: "FICTIONAL_PRIVATE_IDENTIFIER", appSecret: "FICTIONAL_SECRET", setting: { urlCheck: true, token: "FICTIONAL_TOKEN" } },
    { ...app, secret: "FICTIONAL_APP_EXTRA" }, { baseUrl: "https://user:FICTIONAL_PASSWORD@content.example.test" }, true));
  for (const value of ["FICTIONAL_", "https://", "appSecret", "token", "password"]) assert(!encoded.includes(value));
});
test("invalid service configuration is not mistaken for offline mode or a verified origin", () => {
  for (const api of [{}, { baseUrl: 5 }, { baseUrl: "http://content.example.test" }, { baseUrl: "https://127.0.0.1" },
    { baseUrl: "https://content.example.test", profile: {} }]) assert.equal(evaluate(project, app, api).project.requestOriginState, "invalid");
  for (const appid of [undefined, null, 5, "", "  "]) assert.equal(evaluate({ ...project, appid }).project.appIdState, "missing");
});
test("no supplied configuration can manufacture build upload professional or device verification", () => {
  const report = evaluate({ ...project, readyForDeviceAcceptance: true, buildVerifiedByThisCommand: true }, app, { baseUrl: "https://content.example.test" }, true);
  for (const field of ["readyForDeviceAcceptance", "buildVerifiedByThisCommand", "devtoolsExecuted", "actualAndroidVerified", "actualIosVerified", "actualHarmonyosVerified", "uploadPerformed", "deploymentVerified", "professionalApprovalVerified"]) assert.equal(report[field], false);
  assert.equal(report.networkRequestsPerformed, 0);
});

test("all three operating systems retain separate unverified WeChat acceptance requirements", () => {
  const report = evaluate({ ...project, actualHarmonyosVerified: true }, app, { baseUrl: "" });
  for (const system of ["ios", "android", "harmonyos"]) {
    const requirement = report.prerequisites.find((item) => item.id === `${system}_wechat_key_flows`);
    assert(requirement); assert.equal(requirement.state, "unverified"); assert.equal(requirement.scope, "device_preview");
  }
  assert.equal(report.actualHarmonyosVerified, false);
});
test("preflight has no upload login install target-path or remote-command mode", () => {
  requireNoArguments([]);
  for (const args of [["--upload"], ["--login"], ["--install"], ["--project", "E:/other"], ["--url", "https://example.test"], null]) assert.throws(() => requireNoArguments(args));
  for (const value of [null, [], "{}"]) assert.throws(() => evaluatePreparation(value, app, { baseUrl: "" }, false));
});
