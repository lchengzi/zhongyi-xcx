"use strict";

// Static preparation only. Never starts DevTools, logs in, uploads, or probes a service.
const fs = require("node:fs");
const path = require("node:path");
const { validBaseUrl } = require("../utils/public-catalog");
const ROOT = path.resolve(__dirname, "..");

function evaluatePreparation(project, app, api, privateConfigPresent) {
  if (!project || typeof project !== "object" || Array.isArray(project) ||
      !app || typeof app !== "object" || Array.isArray(app) ||
      !api || typeof api !== "object" || Array.isArray(api) || typeof privateConfigPresent !== "boolean") {
    throw new Error("invalid_preparation_input");
  }
  const appId = project.appid === "touristappid" ? "tourist" :
    typeof project.appid === "string" && project.appid.trim() ? "configured_not_verified" : "missing";
  const origin = validBaseUrl(api) ? "https_origin_configured_not_verified" :
    Object.keys(api).length === 1 && api.baseUrl === "" ? "not_configured" : "invalid";
  const urlCheck = Boolean(project.setting && project.setting.urlCheck === true);
  const pages = Array.isArray(app.pages) ? app.pages : [];
  const packages = Array.isArray(app.subPackages) ? app.subPackages : [];
  return {
    schemaVersion: 1,
    inspectionKind: "local_static_preparation_only",
    // Deliberately omit all supplied identifiers, URLs, paths, and private settings.
    project: {
      appIdState: appId, requestOriginState: origin, urlCheckEnabled: urlCheck,
      baseLibraryBaselinePinned: project.libVersion === "3.7.6",
      mainPageCount: pages.length, subpackageCount: packages.length,
      privateConfigPresent,
      effectiveDevtoolsConfigurationVerified: false
    },
    prerequisites: [
      { id: "real_app_id_and_account_permission", scope: "device_preview", state: appId === "configured_not_verified" ? "unverified" : "required" },
      { id: "devtools_installation_login_and_compilation", scope: "device_preview", state: "unverified" },
      { id: "actual_preview_package_and_package_analysis", scope: "device_preview", state: "unverified" },
      { id: "android_wechat_key_flows", scope: "device_preview", state: "unverified" },
      { id: "ios_wechat_key_flows", scope: "device_preview", state: "unverified" },
      { id: "harmonyos_wechat_key_flows", scope: "device_preview", state: "unverified" },
      { id: "https_service_and_wechat_request_domain", scope: "online_catalog_only", state: origin === "not_configured" ? "required" : "unverified" },
      { id: "domain_validation_enabled", scope: "configuration", state: urlCheck ? "observed_enabled_not_runtime_verified" : "needs_correction" },
      { id: "local_private_overrides", scope: "configuration", state: privateConfigPresent ? "manual_effective_configuration_check_required" : "not_present" }
    ],
    inspectionSucceeded: true,
    readyForDeviceAcceptance: false,
    buildVerifiedByThisCommand: false,
    devtoolsExecuted: false,
    networkRequestsPerformed: 0,
    actualAndroidVerified: false,
    actualIosVerified: false,
    actualHarmonyosVerified: false,
    uploadPerformed: false,
    deploymentVerified: false,
    professionalApprovalVerified: false
  };
}

function ordinaryConfig(relative) {
  const filename = path.join(ROOT, relative);
  for (const target of [ROOT, path.dirname(filename), filename]) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || path.resolve(fs.realpathSync(target)).toLowerCase() !== path.resolve(target).toLowerCase()) {
      throw new Error("linked_configuration_not_supported");
    }
  }
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("invalid_configuration_file");
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
function inspectPreparation() {
  return evaluatePreparation(ordinaryConfig("project.config.json"), ordinaryConfig("app.json"), ordinaryConfig("config/public-api.json"),
    fs.existsSync(path.join(ROOT, "project.private.config.json")));
}
function requireNoArguments(args) {
  if (!Array.isArray(args) || args.length) throw new Error("preflight_accepts_no_arguments");
}
function main(args = process.argv.slice(2)) {
  requireNoArguments(args);
  console.log(JSON.stringify(inspectPreparation(), null, 2));
}
if (require.main === module) {
  try { main(); }
  catch (_) { console.error("Device preparation inspection failed. Check local configuration; no upload or deployment was performed."); process.exitCode = 1; }
}
module.exports = { evaluatePreparation, inspectPreparation, requireNoArguments, main };
