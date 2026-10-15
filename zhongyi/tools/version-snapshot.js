"use strict";

const fs = require("fs");
const path = require("path");
const { VERSION_RUNTIME_PATH, versionRuntimeReplacement } = require("./runtime-projections");
const {
  ACTIVE_PATH,
  MANIFEST_PATH,
  NOTICES_PATH,
  SCHEMA_VERSION,
  SNAPSHOT_PREFIX,
  activeStateFor,
  createReleasePackage,
  ensure,
  readJsonFile,
  renderJson,
  validateManifest,
  verifyWorkspace,
  writeNewFile
} = require("./version-core");

const DEFAULT_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const result = { command: argv[0] || "" };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    ensure(token.startsWith("--"), "invalid_argument", `Unexpected argument ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    ensure(index + 1 < argv.length && !argv[index + 1].startsWith("--"), "invalid_argument", `Missing value for ${token}`);
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

function captureRelease(root, options) {
  const settings = options || {};
  const result = createReleasePackage(root, settings);
  const manifestFile = path.join(root, ...MANIFEST_PATH.split("/"));
  if (fs.existsSync(manifestFile)) {
    const current = validateManifest(readJsonFile(root, MANIFEST_PATH, "version manifest"));
    validateManifest({ ...current, releases: current.releases.concat(result.release) });
  }
  writeNewFile(root, result.release.snapshot.path, result.snapshotBytes, (relative) => relative.startsWith(SNAPSHOT_PREFIX));
  return result;
}

function initializeVersioning(root, options) {
  const settings = options || {};
  for (const relative of [MANIFEST_PATH, NOTICES_PATH, ACTIVE_PATH, VERSION_RUNTIME_PATH]) {
    ensure(!fs.existsSync(path.join(root, ...relative.split("/"))), "file_exists", `Versioning is already initialized: ${relative}`);
  }
  const captured = captureRelease(root, settings);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: settings.manifestVersion,
    generatedAt: settings.createdAt,
    releases: [captured.release]
  };
  const notices = {
    schemaVersion: SCHEMA_VERSION,
    noticesVersion: settings.noticesVersion,
    generatedAt: settings.createdAt,
    notices: []
  };
  const active = activeStateFor(captured.release, manifest, notices, {
    activatedAt: settings.createdAt,
    mode: "release"
  });
  writeNewFile(root, MANIFEST_PATH, Buffer.from(renderJson(manifest), "utf8"), (relative) => relative === MANIFEST_PATH);
  writeNewFile(root, NOTICES_PATH, Buffer.from(renderJson(notices), "utf8"), (relative) => relative === NOTICES_PATH);
  writeNewFile(root, ACTIVE_PATH, Buffer.from(renderJson(active), "utf8"), (relative) => relative === ACTIVE_PATH);
  const runtime = versionRuntimeReplacement(active);
  writeNewFile(root, runtime.relative, runtime.bytes, (relative) => relative === VERSION_RUNTIME_PATH);
  return { captured, manifest, notices, active, verification: verifyWorkspace(root, { now: settings.createdAt }) };
}

function required(value, name) {
  ensure(typeof value === "string" && value.trim(), "invalid_argument", `${name} is required`);
  return value.trim();
}

function main(argv) {
  const args = parseArgs(argv);
  ensure(args.command === "init" || args.command === "capture", "invalid_argument", "Usage: version-snapshot.js <init|capture> --release ID --label LABEL --created-at ISO_TIMESTAMP [--root PATH]");
  const root = args.root ? path.resolve(args.root) : DEFAULT_ROOT;
  const settings = {
    id: required(args.release, "--release"),
    label: required(args.label, "--label"),
    createdAt: required(args.createdAt, "--created-at"),
    rollbackPolicy: args.rollbackPolicy || "allowed"
  };
  if (args.command === "capture") {
    const captured = captureRelease(root, settings);
    console.log(JSON.stringify({ snapshot: captured.release.snapshot, release: captured.release }, null, 2));
    return;
  }
  settings.manifestVersion = required(args.manifestVersion, "--manifest-version");
  settings.noticesVersion = required(args.noticesVersion, "--notices-version");
  const initialized = initializeVersioning(root, settings);
  console.log(JSON.stringify(initialized.verification, null, 2));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[version-snapshot] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { captureRelease, initializeVersioning, main, parseArgs };
