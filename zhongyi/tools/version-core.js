"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.1.0";
const MODULE_ARTIFACT_PATHS = Object.freeze([
  "data/ingredients.js",
  "data/recipes.js",
  "data/recipes-public.js",
  "data/rule-set.js"
]);
const RAW_RULE_ARTIFACT_PATHS = Object.freeze([
  "data/options.js",
  "utils/safety.js",
  "utils/recipe-safety.js",
  "utils/session-profile.js",
  "utils/filter.js",
  "utils/format.js",
  "tools/recipe-digests.js",
  "tools/build-public-recipes.js"
]);
const ARTIFACT_PATHS = Object.freeze([...MODULE_ARTIFACT_PATHS, ...RAW_RULE_ARTIFACT_PATHS]);
const MODULE_ARTIFACT_SET = new Set(MODULE_ARTIFACT_PATHS);
const RULE_ARTIFACT_PATHS = Object.freeze(["data/rule-set.js", ...RAW_RULE_ARTIFACT_PATHS]);
const MANIFEST_PATH = "data/version-manifest.json";
const ACTIVE_PATH = "data/version-active.json";
const NOTICES_PATH = "data/version-notices.json";
const SNAPSHOT_PREFIX = "tools/version-snapshots/";
const RECOVERY_PREFIX = "tools/version-recovery/";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const NOTICE_TYPES = new Set(["withdrawal", "replacement"]);
const NOTICE_STATES = new Set(["draft", "effective"]);
const ROLLBACK_POLICIES = new Set(["allowed", "blocked"]);

class VersionPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VersionPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new VersionPolicyError(code, message);
}

function ensure(condition, code, message) {
  if (!condition) fail(code, message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(value, keys, label) {
  ensure(isObject(value), "invalid_shape", `${label} must be an object`);
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  ensure(!unknown.length, "unknown_field", `${label} has unknown fields: ${unknown.join(", ")}`);
  ensure(!missing.length, "missing_field", `${label} is missing fields: ${missing.join(", ")}`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Buffer(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function sha256Value(value) {
  return sha256Buffer(Buffer.from(canonicalJson(value), "utf8"));
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertDigest(value, label) {
  ensure(typeof value === "string" && DIGEST_PATTERN.test(value), "invalid_digest", `${label} must be a lowercase sha256 digest`);
}

function assertTimestamp(value, label) {
  ensure(typeof value === "string" && TIMESTAMP_PATTERN.test(value), "invalid_timestamp", `${label} must be a full ISO-8601 timestamp with timezone`);
  ensure(!Number.isNaN(Date.parse(value)), "invalid_timestamp", `${label} is not a valid timestamp`);
}

function assertDate(value, label) {
  ensure(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), "invalid_date", `${label} must be YYYY-MM-DD`);
  ensure(!Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "invalid_date", `${label} is not a valid date`);
}

function assertReleaseId(value, label) {
  ensure(typeof value === "string" && RELEASE_ID_PATTERN.test(value), "invalid_release_id", `${label} is invalid`);
}

function normalizedRelative(value, label) {
  ensure(typeof value === "string" && value.length > 0, "invalid_path", `${label} must be a path`);
  const portable = value.replace(/\\/g, "/");
  ensure(!path.posix.isAbsolute(portable), "invalid_path", `${label} must be relative`);
  const normalized = path.posix.normalize(portable);
  ensure(normalized === portable && !normalized.startsWith("../") && normalized !== "..", "invalid_path", `${label} contains traversal or non-canonical segments`);
  return normalized;
}

function resolvedInside(root, relative, label) {
  const workspace = path.resolve(root);
  const portable = normalizedRelative(relative, label);
  const candidate = path.resolve(workspace, ...portable.split("/"));
  const boundary = path.relative(workspace, candidate);
  ensure(boundary && !boundary.startsWith(`..${path.sep}`) && boundary !== ".." && !path.isAbsolute(boundary), "path_escape", `${label} escapes the workspace`);
  return candidate;
}

function assertRegularFile(root, relative, label) {
  const file = resolvedInside(root, relative, label);
  ensure(fs.existsSync(file), "missing_file", `${label} does not exist: ${relative}`);
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe_file", `${label} must be a regular non-link file: ${relative}`);
  return file;
}

function readJsonFile(root, relative, label) {
  const file = assertRegularFile(root, relative, label);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail("invalid_json", `${label} is not valid JSON: ${error.message}`);
  }
}

function moduleMetadata(moduleValue, label) {
  ensure(isObject(moduleValue), "invalid_module", `${label} must export an object`);
  ensure(typeof moduleValue.schemaVersion === "string" && moduleValue.schemaVersion, "invalid_module", `${label}.schemaVersion is missing`);
  ensure(typeof moduleValue.contentVersion === "string" && moduleValue.contentVersion, "invalid_module", `${label}.contentVersion is missing`);
  assertDate(moduleValue.publishedAt, `${label}.publishedAt`);
  ensure(Number.isInteger(moduleValue.count) && moduleValue.count >= 0, "invalid_module", `${label}.count must be a non-negative integer`);
  return {
    schemaVersion: moduleValue.schemaVersion,
    contentVersion: moduleValue.contentVersion,
    publishedAt: moduleValue.publishedAt,
    count: moduleValue.count
  };
}

function loadVerifiedModule(file, label) {
  try {
    const resolved = require.resolve(file);
    delete require.cache[resolved];
    return moduleMetadata(require(resolved), label);
  } catch (error) {
    if (error instanceof VersionPolicyError) throw error;
    fail("invalid_module", `${label} could not be loaded: ${error.message}`);
  }
}

function validateModuleDescriptor(value, label) {
  assertKeys(value, ["schemaVersion", "contentVersion", "publishedAt", "count"], label);
  ensure(typeof value.schemaVersion === "string" && value.schemaVersion, "invalid_manifest", `${label}.schemaVersion is required`);
  ensure(typeof value.contentVersion === "string" && value.contentVersion, "invalid_manifest", `${label}.contentVersion is required`);
  assertDate(value.publishedAt, `${label}.publishedAt`);
  ensure(Number.isInteger(value.count) && value.count >= 0, "invalid_manifest", `${label}.count must be a non-negative integer`);
}

function validateArtifactDescriptor(value, label) {
  assertKeys(value, ["path", "sha256", "bytes", "module"], label);
  const artifactPath = normalizedRelative(value.path, `${label}.path`);
  ensure(ARTIFACT_PATHS.includes(artifactPath), "unexpected_artifact", `${label}.path is not an approved release artifact`);
  assertDigest(value.sha256, `${label}.sha256`);
  ensure(Number.isInteger(value.bytes) && value.bytes > 0, "invalid_manifest", `${label}.bytes must be positive`);
  if (MODULE_ARTIFACT_SET.has(artifactPath)) {
    validateModuleDescriptor(value.module, `${label}.module`);
  } else {
    ensure(value.module === null, "invalid_manifest", `${label}.module must be null for a raw rule artifact`);
  }
  return artifactPath;
}

function rulesBundleDigestFromArtifacts(artifacts) {
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  return sha256Value(RULE_ARTIFACT_PATHS.map((artifactPath) => {
    const artifact = byPath.get(artifactPath);
    ensure(artifact, "invalid_manifest", `Rule bundle is missing ${artifactPath}`);
    return { path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes };
  }));
}

function validateRelease(value, label) {
  assertKeys(value, [
    "id", "label", "createdAt", "catalogContentVersion", "recipeContentVersion", "rulesContentVersion", "rulesBundleDigest",
    "rollbackPolicy", "snapshot", "artifacts"
  ], label);
  assertReleaseId(value.id, `${label}.id`);
  ensure(typeof value.label === "string" && value.label.trim(), "invalid_manifest", `${label}.label is required`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  ensure(typeof value.catalogContentVersion === "string" && value.catalogContentVersion, "invalid_manifest", `${label}.catalogContentVersion is required`);
  ensure(typeof value.recipeContentVersion === "string" && value.recipeContentVersion, "invalid_manifest", `${label}.recipeContentVersion is required`);
  ensure(typeof value.rulesContentVersion === "string" && value.rulesContentVersion, "invalid_manifest", `${label}.rulesContentVersion is required`);
  assertDigest(value.rulesBundleDigest, `${label}.rulesBundleDigest`);
  ensure(ROLLBACK_POLICIES.has(value.rollbackPolicy), "invalid_manifest", `${label}.rollbackPolicy is invalid`);
  assertKeys(value.snapshot, ["path", "sha256"], `${label}.snapshot`);
  const snapshotPath = normalizedRelative(value.snapshot.path, `${label}.snapshot.path`);
  ensure(snapshotPath.startsWith(SNAPSHOT_PREFIX) && snapshotPath.endsWith(".json"), "invalid_snapshot_path", `${label}.snapshot.path must stay under ${SNAPSHOT_PREFIX}`);
  assertDigest(value.snapshot.sha256, `${label}.snapshot.sha256`);
  ensure(Array.isArray(value.artifacts) && value.artifacts.length === ARTIFACT_PATHS.length, "invalid_manifest", `${label}.artifacts must contain the complete release set`);
  const artifactPaths = value.artifacts.map((artifact, index) => validateArtifactDescriptor(artifact, `${label}.artifacts[${index}]`));
  ensure(new Set(artifactPaths).size === ARTIFACT_PATHS.length && ARTIFACT_PATHS.every((item) => artifactPaths.includes(item)), "invalid_manifest", `${label}.artifacts is missing or duplicates an approved path`);
  const byPath = new Map(value.artifacts.map((item) => [item.path, item]));
  ensure(byPath.get("data/ingredients.js").module.contentVersion === value.catalogContentVersion, "version_mismatch", `${label} catalog content version is inconsistent`);
  for (const recipePath of ["data/recipes.js", "data/recipes-public.js"]) {
    ensure(byPath.get(recipePath).module.contentVersion === value.recipeContentVersion, "version_mismatch", `${label} recipe content version is inconsistent`);
  }
  ensure(byPath.get("data/rule-set.js").module.contentVersion === value.rulesContentVersion, "version_mismatch", `${label} rules content version is inconsistent`);
  ensure(rulesBundleDigestFromArtifacts(value.artifacts) === value.rulesBundleDigest, "rules_bundle_mismatch", `${label} rules bundle digest is inconsistent`);
  const review = byPath.get("data/recipes.js").module;
  const publicRecipe = byPath.get("data/recipes-public.js").module;
  ensure(canonicalJson(review) === canonicalJson(publicRecipe), "public_recipe_mismatch", `${label} review and public recipe metadata differ`);
}

function validateManifest(value) {
  assertKeys(value, ["schemaVersion", "manifestVersion", "generatedAt", "releases"], "version manifest");
  ensure(value.schemaVersion === SCHEMA_VERSION, "schema_mismatch", `Unsupported version manifest schema ${value.schemaVersion}`);
  ensure(typeof value.manifestVersion === "string" && value.manifestVersion, "invalid_manifest", "manifestVersion is required");
  assertTimestamp(value.generatedAt, "version manifest.generatedAt");
  ensure(Array.isArray(value.releases) && value.releases.length > 0, "invalid_manifest", "version manifest must contain at least one release");
  value.releases.forEach((release, index) => validateRelease(release, `version manifest.releases[${index}]`));
  const ids = value.releases.map((release) => release.id);
  ensure(new Set(ids).size === ids.length, "duplicate_release", "version manifest contains duplicate release IDs");
  const rulesByVersion = new Map();
  for (const release of value.releases) {
    const existing = rulesByVersion.get(release.rulesContentVersion);
    ensure(!existing || existing === release.rulesBundleDigest, "rules_version_reused", `Rules version ${release.rulesContentVersion} maps to more than one rule bundle`);
    rulesByVersion.set(release.rulesContentVersion, release.rulesBundleDigest);
  }
  return value;
}

function validateAuthorization(value, label, effective) {
  assertKeys(value, ["decisionId", "approvedBy"], label);
  ensure(typeof value.decisionId === "string" && value.decisionId.trim(), "invalid_notice", `${label}.decisionId is required`);
  ensure(Array.isArray(value.approvedBy) && value.approvedBy.every((role) => typeof role === "string" && role.trim()), "invalid_notice", `${label}.approvedBy is invalid`);
  if (effective) {
    for (const role of ["content_owner", "compliance"]) {
      ensure(value.approvedBy.includes(role), "notice_not_authorized", `${label} is missing required ${role} approval`);
    }
  }
}

function validateNotices(value, manifest, nowValue) {
  assertKeys(value, ["schemaVersion", "noticesVersion", "generatedAt", "notices"], "version notices");
  ensure(value.schemaVersion === SCHEMA_VERSION, "schema_mismatch", `Unsupported version notices schema ${value.schemaVersion}`);
  ensure(typeof value.noticesVersion === "string" && value.noticesVersion, "invalid_notice", "noticesVersion is required");
  assertTimestamp(value.generatedAt, "version notices.generatedAt");
  ensure(Array.isArray(value.notices), "invalid_notice", "version notices.notices must be an array");
  const releaseIds = new Set(manifest.releases.map((release) => release.id));
  const now = nowValue == null ? Date.now() : Date.parse(nowValue);
  ensure(!Number.isNaN(now), "invalid_timestamp", "Verification time is invalid");
  value.notices.forEach((notice, index) => {
    const label = `version notices.notices[${index}]`;
    assertKeys(notice, [
      "id", "type", "state", "issuedAt", "effectiveAt", "releaseId", "replacementReleaseId",
      "reason", "rollbackAllowed", "authorization"
    ], label);
    assertReleaseId(notice.id, `${label}.id`);
    ensure(NOTICE_TYPES.has(notice.type), "invalid_notice", `${label}.type is invalid`);
    ensure(NOTICE_STATES.has(notice.state), "invalid_notice", `${label}.state is invalid`);
    assertTimestamp(notice.issuedAt, `${label}.issuedAt`);
    assertTimestamp(notice.effectiveAt, `${label}.effectiveAt`);
    ensure(releaseIds.has(notice.releaseId), "unknown_release", `${label}.releaseId is not in the manifest`);
    ensure(typeof notice.reason === "string" && notice.reason.trim(), "invalid_notice", `${label}.reason is required`);
    ensure(typeof notice.rollbackAllowed === "boolean", "invalid_notice", `${label}.rollbackAllowed must be explicit`);
    const effective = notice.state === "effective";
    validateAuthorization(notice.authorization, `${label}.authorization`, effective);
    if (effective) ensure(Date.parse(notice.effectiveAt) <= now, "notice_not_effective", `${label} is marked effective before its effectiveAt time`);
    if (notice.type === "withdrawal") {
      ensure(notice.replacementReleaseId === null, "invalid_notice", `${label} withdrawal must not declare a replacement`);
      ensure(notice.rollbackAllowed === false, "withdrawn_rollback", `${label} withdrawal can never allow rollback`);
    } else {
      ensure(typeof notice.replacementReleaseId === "string" && releaseIds.has(notice.replacementReleaseId), "unknown_release", `${label}.replacementReleaseId is not in the manifest`);
      ensure(notice.replacementReleaseId !== notice.releaseId, "replacement_cycle", `${label} cannot replace a release with itself`);
    }
  });
  const ids = value.notices.map((notice) => notice.id);
  ensure(new Set(ids).size === ids.length, "duplicate_notice", "version notices contains duplicate IDs");
  const effective = value.notices.filter((notice) => notice.state === "effective");
  const affected = new Map();
  for (const notice of effective) {
    ensure(!affected.has(notice.releaseId), "conflicting_notice", `Release ${notice.releaseId} has multiple effective lifecycle notices`);
    affected.set(notice.releaseId, notice);
  }
  for (const start of affected.keys()) {
    const seen = new Set();
    let current = start;
    while (affected.has(current) && affected.get(current).type === "replacement") {
      ensure(!seen.has(current), "replacement_cycle", `Replacement notices contain a cycle at ${current}`);
      seen.add(current);
      current = affected.get(current).replacementReleaseId;
    }
  }
  return value;
}

function releaseDigest(release) {
  return sha256Value(release);
}

function activeNoticeFor(releaseId, notices) {
  return notices.notices.find((notice) => notice.state === "effective" && notice.releaseId === releaseId) || null;
}

function assertReleaseEligible(release, notices, mode) {
  const notice = activeNoticeFor(release.id, notices);
  if (notice && notice.type === "withdrawal") fail("release_withdrawn", `Release ${release.id} was withdrawn by ${notice.id}`);
  if (notice && notice.type === "replacement") {
    if (mode !== "rollback") fail("release_replaced", `Release ${release.id} was replaced by ${notice.replacementReleaseId}`);
    ensure(notice.rollbackAllowed, "rollback_blocked", `Replacement notice ${notice.id} forbids rollback to ${release.id}`);
  }
  if (mode === "rollback") ensure(release.rollbackPolicy === "allowed", "rollback_blocked", `Release ${release.id} is not rollback eligible`);
}

function validateRecoveryReference(value, label) {
  assertKeys(value, ["path", "sha256"], label);
  const recoveryPath = normalizedRelative(value.path, `${label}.path`);
  ensure(recoveryPath.startsWith(RECOVERY_PREFIX) && recoveryPath.endsWith(".json"), "invalid_recovery_path", `${label}.path must stay under ${RECOVERY_PREFIX}`);
  assertDigest(value.sha256, `${label}.sha256`);
}

function validateActive(value, manifest, notices) {
  assertKeys(value, [
    "schemaVersion", "manifestVersion", "manifestDigest", "noticesVersion", "noticesDigest", "releaseId", "releaseDigest",
    "snapshotSha256", "activatedAt", "mode", "previousReleaseId", "recoverySnapshot"
  ], "active version state");
  ensure(value.schemaVersion === SCHEMA_VERSION, "schema_mismatch", `Unsupported active version schema ${value.schemaVersion}`);
  ensure(value.manifestVersion === manifest.manifestVersion, "manifest_state_mismatch", "Active state is bound to another manifest version");
  assertDigest(value.manifestDigest, "active version state.manifestDigest");
  ensure(value.manifestDigest === sha256Value(manifest), "manifest_digest_mismatch", "Active state manifest digest is stale");
  ensure(value.noticesVersion === notices.noticesVersion, "notice_state_mismatch", "Active state has not acknowledged the current notices version");
  assertDigest(value.noticesDigest, "active version state.noticesDigest");
  ensure(value.noticesDigest === sha256Value(notices), "notice_digest_mismatch", "Active state notices digest is stale");
  assertReleaseId(value.releaseId, "active version state.releaseId");
  const release = manifest.releases.find((item) => item.id === value.releaseId);
  ensure(release, "unknown_release", `Active release ${value.releaseId} is not in the manifest`);
  assertDigest(value.releaseDigest, "active version state.releaseDigest");
  ensure(value.releaseDigest === releaseDigest(release), "release_digest_mismatch", "Active state release digest is stale");
  assertDigest(value.snapshotSha256, "active version state.snapshotSha256");
  ensure(value.snapshotSha256 === release.snapshot.sha256, "snapshot_digest_mismatch", "Active state snapshot digest is stale");
  assertTimestamp(value.activatedAt, "active version state.activatedAt");
  ensure(value.mode === "release" || value.mode === "rollback", "invalid_active_mode", "Active state mode is invalid");
  if (value.mode === "release") {
    ensure(value.previousReleaseId === null && value.recoverySnapshot === null, "invalid_active_state", "A normal release must not carry rollback recovery fields");
  } else {
    assertReleaseId(value.previousReleaseId, "active version state.previousReleaseId");
    ensure(value.previousReleaseId !== value.releaseId, "invalid_active_state", "Rollback previous release must differ from its target");
    validateRecoveryReference(value.recoverySnapshot, "active version state.recoverySnapshot");
  }
  assertReleaseEligible(release, notices, value.mode);
  return release;
}

function validateSnapshotPayload(value, release) {
  assertKeys(value, ["schemaVersion", "releaseId", "createdAt", "artifacts"], "version snapshot");
  ensure(value.schemaVersion === SCHEMA_VERSION, "schema_mismatch", `Unsupported snapshot schema ${value.schemaVersion}`);
  ensure(value.releaseId === release.id, "snapshot_release_mismatch", "Snapshot belongs to another release");
  assertTimestamp(value.createdAt, "version snapshot.createdAt");
  ensure(Array.isArray(value.artifacts) && value.artifacts.length === ARTIFACT_PATHS.length, "invalid_snapshot", "Snapshot must contain the complete artifact set");
  const releaseByPath = new Map(release.artifacts.map((item) => [item.path, item]));
  const paths = [];
  value.artifacts.forEach((artifact, index) => {
    const label = `version snapshot.artifacts[${index}]`;
    assertKeys(artifact, ["path", "sha256", "bytes", "module", "contentBase64"], label);
    const artifactPath = validateArtifactDescriptor({
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      module: artifact.module
    }, label);
    ensure(typeof artifact.contentBase64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(artifact.contentBase64), "invalid_snapshot", `${label}.contentBase64 is invalid`);
    const decoded = Buffer.from(artifact.contentBase64, "base64");
    ensure(decoded.length === artifact.bytes, "snapshot_size_mismatch", `${label} decoded size differs`);
    ensure(sha256Buffer(decoded) === artifact.sha256, "snapshot_digest_mismatch", `${label} decoded digest differs`);
    const descriptor = releaseByPath.get(artifactPath);
    ensure(descriptor && canonicalJson({ path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, module: artifact.module }) === canonicalJson(descriptor), "snapshot_manifest_mismatch", `${label} differs from the release manifest`);
    paths.push(artifactPath);
  });
  ensure(new Set(paths).size === ARTIFACT_PATHS.length, "invalid_snapshot", "Snapshot contains duplicate artifact paths");
  return value;
}

function verifySnapshot(root, release) {
  const snapshotFile = assertRegularFile(root, release.snapshot.path, `snapshot for ${release.id}`);
  const bytes = fs.readFileSync(snapshotFile);
  ensure(sha256Buffer(bytes) === release.snapshot.sha256, "snapshot_digest_mismatch", `Snapshot digest differs for ${release.id}`);
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail("invalid_snapshot", `Snapshot for ${release.id} is not valid JSON: ${error.message}`);
  }
  return validateSnapshotPayload(payload, release);
}

function verifyReleaseArtifacts(root, release) {
  const results = [];
  for (const artifact of release.artifacts) {
    const file = assertRegularFile(root, artifact.path, `release artifact ${artifact.path}`);
    const bytes = fs.readFileSync(file);
    ensure(bytes.length === artifact.bytes, "artifact_size_mismatch", `${artifact.path} byte length differs from release ${release.id}`);
    ensure(sha256Buffer(bytes) === artifact.sha256, "artifact_digest_mismatch", `${artifact.path} digest differs from release ${release.id}`);
    const actualMetadata = MODULE_ARTIFACT_SET.has(artifact.path) ? loadVerifiedModule(file, artifact.path) : null;
    ensure(canonicalJson(actualMetadata) === canonicalJson(artifact.module), "artifact_metadata_mismatch", `${artifact.path} metadata differs from release ${release.id}`);
    results.push({ path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, module: actualMetadata });
  }
  return results;
}

function verifyRecoveryReference(root, active) {
  if (active.mode !== "rollback") return null;
  const file = assertRegularFile(root, active.recoverySnapshot.path, "rollback recovery snapshot");
  const bytes = fs.readFileSync(file);
  ensure(sha256Buffer(bytes) === active.recoverySnapshot.sha256, "recovery_digest_mismatch", "Rollback recovery snapshot digest differs");
  return { path: active.recoverySnapshot.path, sha256: active.recoverySnapshot.sha256, bytes: bytes.length };
}

function loadVersionState(root, now) {
  const manifest = validateManifest(readJsonFile(root, MANIFEST_PATH, "version manifest"));
  const notices = validateNotices(readJsonFile(root, NOTICES_PATH, "version notices"), manifest, now);
  const active = readJsonFile(root, ACTIVE_PATH, "active version state");
  const release = validateActive(active, manifest, notices);
  return { manifest, notices, active, release };
}

function verifyWorkspace(root, options) {
  const settings = options || {};
  const state = loadVersionState(root, settings.now);
  const snapshot = verifySnapshot(root, state.release);
  const artifacts = verifyReleaseArtifacts(root, state.release);
  const recovery = verifyRecoveryReference(root, state.active);
  return {
    ok: true,
    releaseId: state.release.id,
    releaseCreatedAt: state.release.createdAt,
    mode: state.active.mode,
    manifestVersion: state.manifest.manifestVersion,
    noticesVersion: state.notices.noticesVersion,
    catalogContentVersion: state.release.catalogContentVersion,
    recipeContentVersion: state.release.recipeContentVersion,
    rulesContentVersion: state.release.rulesContentVersion,
    rulesBundleDigest: state.release.rulesBundleDigest,
    snapshotSha256: state.release.snapshot.sha256,
    artifactCount: artifacts.length,
    snapshotArtifactCount: snapshot.artifacts.length,
    recovery
  };
}

function artifactDescriptorFromWorkspace(root, artifactPath) {
  ensure(ARTIFACT_PATHS.includes(artifactPath), "unexpected_artifact", `${artifactPath} is not an approved release artifact`);
  const file = assertRegularFile(root, artifactPath, `release artifact ${artifactPath}`);
  const bytes = fs.readFileSync(file);
  return {
    descriptor: {
      path: artifactPath,
      sha256: sha256Buffer(bytes),
      bytes: bytes.length,
      module: MODULE_ARTIFACT_SET.has(artifactPath) ? loadVerifiedModule(file, artifactPath) : null
    },
    contentBase64: bytes.toString("base64")
  };
}

function createReleasePackage(root, options) {
  const settings = options || {};
  assertReleaseId(settings.id, "release id");
  ensure(typeof settings.label === "string" && settings.label.trim(), "invalid_manifest", "release label is required");
  assertTimestamp(settings.createdAt, "release createdAt");
  const rollbackPolicy = settings.rollbackPolicy || "allowed";
  ensure(ROLLBACK_POLICIES.has(rollbackPolicy), "invalid_manifest", "release rollbackPolicy is invalid");
  const captured = ARTIFACT_PATHS.map((artifactPath) => artifactDescriptorFromWorkspace(root, artifactPath));
  const snapshotPath = `${SNAPSHOT_PREFIX}${settings.id}.json`;
  const snapshotPayload = {
    schemaVersion: SCHEMA_VERSION,
    releaseId: settings.id,
    createdAt: settings.createdAt,
    artifacts: captured.map((item) => ({ ...item.descriptor, contentBase64: item.contentBase64 }))
  };
  const snapshotBytes = Buffer.from(renderJson(snapshotPayload), "utf8");
  const byPath = new Map(captured.map((item) => [item.descriptor.path, item.descriptor]));
  const release = {
    id: settings.id,
    label: settings.label.trim(),
    createdAt: settings.createdAt,
    catalogContentVersion: byPath.get("data/ingredients.js").module.contentVersion,
    recipeContentVersion: byPath.get("data/recipes.js").module.contentVersion,
    rulesContentVersion: byPath.get("data/rule-set.js").module.contentVersion,
    rulesBundleDigest: rulesBundleDigestFromArtifacts(captured.map((item) => item.descriptor)),
    rollbackPolicy,
    snapshot: { path: snapshotPath, sha256: sha256Buffer(snapshotBytes) },
    artifacts: captured.map((item) => item.descriptor)
  };
  validateRelease(release, "generated release");
  validateSnapshotPayload(snapshotPayload, release);
  return { release, snapshotPayload, snapshotBytes };
}

function activeStateFor(release, manifest, notices, options) {
  const settings = options || {};
  const mode = settings.mode || "release";
  const active = {
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: manifest.manifestVersion,
    manifestDigest: sha256Value(manifest),
    noticesVersion: notices.noticesVersion,
    noticesDigest: sha256Value(notices),
    releaseId: release.id,
    releaseDigest: releaseDigest(release),
    snapshotSha256: release.snapshot.sha256,
    activatedAt: settings.activatedAt,
    mode,
    previousReleaseId: mode === "rollback" ? settings.previousReleaseId : null,
    recoverySnapshot: mode === "rollback" ? settings.recoverySnapshot : null
  };
  validateActive(active, manifest, notices);
  return active;
}

function ensureWritableTarget(root, relative, allowed, label) {
  const portable = normalizedRelative(relative, label);
  ensure(allowed(portable), "write_scope_violation", `${label} is outside the version tool write scope`);
  const target = resolvedInside(root, portable, label);
  const parent = path.dirname(target);
  if (fs.existsSync(parent)) {
    const parentStat = fs.lstatSync(parent);
    ensure(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "unsafe_directory", `${label} parent must be a non-link directory`);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe_file", `${label} target must be a regular non-link file`);
  }
  return target;
}

function writeNewFile(root, relative, bytes, allowed) {
  const target = ensureWritableTarget(root, relative, allowed, `new file ${relative}`);
  ensure(!fs.existsSync(target), "file_exists", `Refusing to overwrite existing ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const parentStat = fs.lstatSync(path.dirname(target));
  ensure(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "unsafe_directory", `Parent for ${relative} is unsafe`);
  const handle = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return target;
}

module.exports = {
  ACTIVE_PATH,
  ARTIFACT_PATHS,
  MODULE_ARTIFACT_PATHS,
  MANIFEST_PATH,
  NOTICES_PATH,
  RECOVERY_PREFIX,
  RAW_RULE_ARTIFACT_PATHS,
  RULE_ARTIFACT_PATHS,
  SCHEMA_VERSION,
  SNAPSHOT_PREFIX,
  VersionPolicyError,
  activeNoticeFor,
  activeStateFor,
  assertReleaseEligible,
  canonicalJson,
  createReleasePackage,
  ensure,
  ensureWritableTarget,
  loadVersionState,
  normalizedRelative,
  readJsonFile,
  releaseDigest,
  rulesBundleDigestFromArtifacts,
  renderJson,
  resolvedInside,
  sha256Buffer,
  sha256Value,
  validateActive,
  validateManifest,
  validateNotices,
  validateSnapshotPayload,
  verifyReleaseArtifacts,
  verifySnapshot,
  verifyWorkspace,
  writeNewFile
};
