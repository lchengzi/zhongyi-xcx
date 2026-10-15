"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ACTIVE_PATH,
  ARTIFACT_PATHS,
  MANIFEST_PATH,
  NOTICES_PATH,
  RAW_RULE_ARTIFACT_PATHS,
  SCHEMA_VERSION,
  activeStateFor,
  assertReleaseEligible,
  renderJson,
  sha256Buffer,
  validateManifest,
  validateNotices,
  verifyWorkspace
} = require("./version-core");
const { captureRelease, initializeVersioning } = require("./version-snapshot");
const { applyRollback, planRollback, transactionalReplace } = require("./version-rollback");
const { buildRuntimeConfig } = require("./build-runtime-config");
const { VERSION_RUNTIME_PATH, CONFIG_RUNTIME_PATH, versionRuntimeReplacement, checkRuntimeJsonProjections } = require("./runtime-projections");

const T1 = "2026-08-10T01:00:00.000Z";
const T2 = "2026-08-10T02:00:00.000Z";
const T3 = "2026-08-10T03:00:00.000Z";
const T4 = "2026-08-10T04:00:00.000Z";

function writeJson(root, relative, value) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderJson(value), "utf8");
}

function moduleSource(value) {
  return `"use strict";\nmodule.exports = ${JSON.stringify(value, null, 2)};\n`;
}

function writeArtifactSet(root, generation) {
  for (const directory of ["data", "utils", "tools"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  const catalogVersion = `catalog-${generation}`;
  const recipeVersion = `recipes-${generation}`;
  fs.writeFileSync(path.join(root, "data", "ingredients.js"), moduleSource({
    schemaVersion: "1.0.0", contentVersion: catalogVersion,
    publishedAt: "2026-08-10", count: 1,
    marker: `ingredients-${generation}`
  }), "utf8");
  const recipeModule = {
    schemaVersion: "1.0.0", contentVersion: recipeVersion,
    publishedAt: "2026-08-10", count: 1,
    marker: `recipes-${generation}`
  };
  fs.writeFileSync(path.join(root, "data", "recipes.js"), moduleSource(recipeModule), "utf8");
  fs.writeFileSync(path.join(root, "data", "recipes-public.js"), moduleSource(recipeModule), "utf8");
  fs.writeFileSync(path.join(root, "data", "rule-set.js"), moduleSource({
    schemaVersion: "1.0.0", contentVersion: `rules-${generation}`,
    publishedAt: "2026-08-10", count: 1,
    marker: `rules-${generation}`
  }), "utf8");
  for (const artifactPath of RAW_RULE_ARTIFACT_PATHS) {
    const file = path.join(root, ...artifactPath.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `"use strict";\n// ${artifactPath} ${generation}\n`, "utf8");
  }
}

function expectCode(fn, code, message) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error.code, code, `${message}: received ${error.code || error.name}: ${error.message}`);
    return true;
  }, message);
}

function fixtureReplacementNotice() {
  return {
    id: "notice-replace-release-v1",
    type: "replacement",
    state: "effective",
    issuedAt: T3,
    effectiveAt: T3,
    releaseId: "release-v1",
    replacementReleaseId: "release-v2",
    reason: "Fixture content update",
    rollbackAllowed: true,
    authorization: {
      decisionId: "fixture-decision-replace-v1",
      approvedBy: ["content_owner", "compliance"]
    }
  };
}

function safeCleanup(root) {
  if (!root || !fs.existsSync(root)) return;
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  const relative = path.relative(tempRoot, resolved);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "test cleanup escaped the system temp directory");
  assert(path.basename(resolved).startsWith("zhongyi-version-test-"), "test cleanup target has an unexpected name");
  const stack = [resolved];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), `test cleanup refused symbolic link ${current}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    }
  }
  fs.rmSync(resolved, { recursive: true });
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhongyi-version-test-"));
  try {
    writeArtifactSet(root, "v1");
    const initial = initializeVersioning(root, {
      id: "release-v1",
      label: "Fixture release v1",
      createdAt: T1,
      rollbackPolicy: "allowed",
      manifestVersion: "fixture-manifest.1",
      noticesVersion: "fixture-notices.1"
    });
    assert.strictEqual(initial.verification.releaseId, "release-v1");
    assert.strictEqual(verifyWorkspace(root, { now: T1 }).artifactCount, ARTIFACT_PATHS.length);
    const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
    assert(fs.readFileSync(path.join(root, VERSION_RUNTIME_PATH)).equals(versionRuntimeReplacement(initial.active).bytes));
    writeJson(root, "config/public-api.json", { baseUrl: "" });
    assert.deepStrictEqual(buildRuntimeConfig(root, { now: T1 }).updated, [CONFIG_RUNTIME_PATH]);
    assert.deepStrictEqual(buildRuntimeConfig(root, { now: T1 }).updated, []);
    checkRuntimeJsonProjections(read);
    writeJson(root, "config/public-api.json", { baseUrl: "https://catalog.example.test" });
    assert.deepStrictEqual(buildRuntimeConfig(root, { now: T1 }).updated, [CONFIG_RUNTIME_PATH]);
    const configuredBytes = fs.readFileSync(path.join(root, CONFIG_RUNTIME_PATH));
    for (const bad of [{ baseUrl: "http://catalog.example.test" }, { baseUrl: "https://catalog.example.test", apiKey: "fixture-secret" }, { baseUrl: "https://user:pass@catalog.example.test" }]) {
      writeJson(root, "config/public-api.json", bad);
      assert.throws(() => buildRuntimeConfig(root, { now: T1 }));
      assert(fs.readFileSync(path.join(root, CONFIG_RUNTIME_PATH)).equals(configuredBytes));
    }
    writeJson(root, "config/public-api.json", { baseUrl: "https://catalog.example.test" });
    fs.writeFileSync(path.join(root, CONFIG_RUNTIME_PATH), "not valid JavaScript {{", "utf8");
    assert.deepStrictEqual(buildRuntimeConfig(root, { now: T1 }).updated, [CONFIG_RUNTIME_PATH]);
    checkRuntimeJsonProjections(read);

    const runtimeBefore = fs.readFileSync(path.join(root, VERSION_RUNTIME_PATH));
    assert.throws(() => transactionalReplace(root, [
      { relative: CONFIG_RUNTIME_PATH, bytes: Buffer.from("changed config") },
      { relative: VERSION_RUNTIME_PATH, bytes: Buffer.from("changed version") }
    ], () => { throw new Error("fixture verification failure"); }), /fixture verification failure/);
    assert(fs.readFileSync(path.join(root, CONFIG_RUNTIME_PATH)).equals(configuredBytes));
    assert(fs.readFileSync(path.join(root, VERSION_RUNTIME_PATH)).equals(runtimeBefore));
    expectCode(() => transactionalReplace(root, [
      { relative: CONFIG_RUNTIME_PATH, bytes: Buffer.from("must not stage") },
      { relative: "app.js", bytes: Buffer.from("outside allowed targets") }
    ], () => {}), "write_scope_violation", "all transaction targets must validate before staging");
    expectCode(() => transactionalReplace(root, [
      { relative: CONFIG_RUNTIME_PATH, bytes: configuredBytes },
      { relative: CONFIG_RUNTIME_PATH, bytes: configuredBytes }
    ], () => {}), "duplicate_target", "duplicate transaction targets must stop before writes");
    assert(!fs.readdirSync(path.join(root, "config")).some((name) => name.includes(".version-")));

    const noticesPath = path.join(root, ...NOTICES_PATH.split("/"));
    const noticesBytes = fs.readFileSync(noticesPath);
    fs.renameSync(noticesPath, `${noticesPath}.missing-fixture`);
    expectCode(() => verifyWorkspace(root, { now: T1 }), "missing_file", "missing notice registry must fail closed");
    fs.renameSync(`${noticesPath}.missing-fixture`, noticesPath);
    assert.strictEqual(sha256Buffer(fs.readFileSync(noticesPath)), sha256Buffer(noticesBytes));

    fs.appendFileSync(path.join(root, "data", "ingredients.js"), "\n// drift\n", "utf8");
    expectCode(() => buildRuntimeConfig(root, { now: T1 }), "artifact_size_mismatch", "runtime build must not bless unregistered content drift");
    assert(fs.readFileSync(path.join(root, VERSION_RUNTIME_PATH)).equals(runtimeBefore));
    expectCode(() => verifyWorkspace(root, { now: T1 }), "artifact_size_mismatch", "unregistered catalog drift must fail closed");
    const v1Snapshot = initial.captured.snapshotPayload;
    for (const artifact of v1Snapshot.artifacts) {
      fs.writeFileSync(path.join(root, ...artifact.path.split("/")), Buffer.from(artifact.contentBase64, "base64"));
    }
    assert.strictEqual(verifyWorkspace(root, { now: T1 }).releaseId, "release-v1");

    const safetyPath = path.join(root, "utils", "safety.js");
    fs.appendFileSync(safetyPath, "\n// unregistered rule drift\n", "utf8");
    expectCode(() => verifyWorkspace(root, { now: T1 }), "artifact_size_mismatch", "unregistered safety-rule drift must fail closed");
    expectCode(() => captureRelease(root, {
      id: "release-v1-rule-drift",
      label: "Fixture reused rule version",
      createdAt: T2,
      rollbackPolicy: "allowed"
    }), "rules_version_reused", "changed rule code must not be registered under an existing rules version");
    assert(!fs.existsSync(path.join(root, "tools", "version-snapshots", "release-v1-rule-drift.json")), "rejected rule-version reuse left an orphan snapshot");
    const capturedSafety = v1Snapshot.artifacts.find((artifact) => artifact.path === "utils/safety.js");
    fs.writeFileSync(safetyPath, Buffer.from(capturedSafety.contentBase64, "base64"));
    assert.strictEqual(verifyWorkspace(root, { now: T1 }).rulesContentVersion, "rules-v1");

    writeArtifactSet(root, "v2");
    const capturedV2 = captureRelease(root, {
      id: "release-v2",
      label: "Fixture release v2",
      createdAt: T2,
      rollbackPolicy: "allowed"
    });
    const manifest = validateManifest({
      schemaVersion: SCHEMA_VERSION,
      manifestVersion: "fixture-manifest.2",
      generatedAt: T3,
      releases: [initial.captured.release, capturedV2.release]
    });
    const notices = validateNotices({
      schemaVersion: SCHEMA_VERSION,
      noticesVersion: "fixture-notices.2",
      generatedAt: T3,
      notices: [fixtureReplacementNotice()]
    }, manifest, T4);
    expectCode(() => activeStateFor(initial.captured.release, manifest, notices, {
      activatedAt: T3,
      mode: "release"
    }), "release_replaced", "an effective replacement must invalidate a normal old-release pointer");
    const activeV2 = activeStateFor(capturedV2.release, manifest, notices, {
      activatedAt: T3,
      mode: "release"
    });
    writeJson(root, MANIFEST_PATH, manifest);
    writeJson(root, NOTICES_PATH, notices);
    writeJson(root, ACTIVE_PATH, activeV2);
    assert.strictEqual(verifyWorkspace(root, { now: T4 }).releaseId, "release-v2");
    assert.deepStrictEqual(buildRuntimeConfig(root, { now: T4 }).updated, [VERSION_RUNTIME_PATH]);
    checkRuntimeJsonProjections(read);

    writeJson(root, NOTICES_PATH, {
      ...notices,
      notices: notices.notices.map((notice, index) => index === 0 ? { ...notice, reason: "Tampered without version bump" } : notice)
    });
    expectCode(() => verifyWorkspace(root, { now: T4 }), "notice_digest_mismatch", "notice content changed without a version bump must fail closed");
    writeJson(root, NOTICES_PATH, notices);

    writeJson(root, MANIFEST_PATH, { ...manifest, generatedAt: T4 });
    expectCode(() => verifyWorkspace(root, { now: T4 }), "manifest_digest_mismatch", "manifest content changed without a version bump must fail closed");
    writeJson(root, MANIFEST_PATH, manifest);
    assert.strictEqual(verifyWorkspace(root, { now: T4 }).releaseId, "release-v2");

    const withdrawalNotices = validateNotices({
      ...notices,
      noticesVersion: "fixture-notices.withdrawal",
      notices: notices.notices.concat({
        id: "notice-withdraw-release-v2",
        type: "withdrawal",
        state: "effective",
        issuedAt: T4,
        effectiveAt: T4,
        releaseId: "release-v2",
        replacementReleaseId: null,
        reason: "Fixture safety withdrawal",
        rollbackAllowed: false,
        authorization: {
          decisionId: "fixture-decision-withdraw-v2",
          approvedBy: ["content_owner", "compliance"]
        }
      })
    }, manifest, T4);
    expectCode(() => activeStateFor(capturedV2.release, manifest, withdrawalNotices, {
      activatedAt: T4,
      mode: "release"
    }), "release_withdrawn", "an effective withdrawal must invalidate the selected release");

    const noRollbackNotices = validateNotices({
      ...notices,
      noticesVersion: "fixture-notices.no-rollback",
      notices: [{ ...notices.notices[0], rollbackAllowed: false }]
    }, manifest, T4);
    expectCode(() => assertReleaseEligible(initial.captured.release, noRollbackNotices, "rollback"), "rollback_blocked", "replacement notice must be able to prohibit rollback");

    const plan = planRollback(root, "release-v1", { now: T4 });
    assert.strictEqual(plan.currentVerification.ok, true);
    const beforeWrongConfirmation = fs.readFileSync(path.join(root, "data", "ingredients.js"));
    expectCode(() => applyRollback(root, "release-v1", {
      releaseId: "release-v1",
      planDigest: `sha256:${"0".repeat(64)}`
    }, { now: T4 }), "confirmation_mismatch", "stale plan confirmation must stop before writes");
    assert.strictEqual(sha256Buffer(fs.readFileSync(path.join(root, "data", "ingredients.js"))), sha256Buffer(beforeWrongConfirmation));

    const applied = applyRollback(root, "release-v1", {
      releaseId: "release-v1",
      planDigest: plan.planDigest
    }, { now: T4 });
    assert.strictEqual(applied.releaseId, "release-v1");
    assert.strictEqual(applied.verification.mode, "rollback");
    assert.strictEqual(applied.verification.releaseCreatedAt, T1);
    assert.strictEqual(applied.cleanupWarnings.length, 0);
    assert(fs.existsSync(path.join(root, ...applied.recoverySnapshot.path.split("/"))), "rollback recovery snapshot was not retained");
    assert.strictEqual(verifyWorkspace(root, { now: T4 }).catalogContentVersion, "catalog-v1");
    checkRuntimeJsonProjections(read);
    assert(fs.readFileSync(path.join(root, CONFIG_RUNTIME_PATH)).equals(configuredBytes), "rollback must not change the environment's public origin");
    assert(fs.readFileSync(path.join(root, VERSION_RUNTIME_PATH)).equals(versionRuntimeReplacement(JSON.parse(read(ACTIVE_PATH))).bytes));

    const v2SnapshotPath = path.join(root, ...capturedV2.release.snapshot.path.split("/"));
    const pristineV2Snapshot = fs.readFileSync(v2SnapshotPath);
    fs.appendFileSync(v2SnapshotPath, "\n", "utf8");
    expectCode(() => planRollback(root, "release-v2", { now: T4 }), "snapshot_digest_mismatch", "tampered rollback snapshot must be rejected");
    fs.writeFileSync(v2SnapshotPath, pristineV2Snapshot);
    assert.strictEqual(planRollback(root, "release-v2", { now: T4 }).targetReleaseId, "release-v2");

    return {
      assertions: "passed",
      releases: manifest.releases.length,
      effectiveNotices: notices.notices.length,
      rollbackVerified: true,
      rollbackRuntimeProjectionVerified: true,
      runtimeGenerationAndRepairVerified: true,
      runtimeGenerationFailureRestored: true,
      runtimeConfigSecretsRejected: true,
      driftRejected: true,
      ruleDriftRejected: true,
      ruleVersionReuseRejected: true,
      lifecycleRegistryDriftRejected: true,
      withdrawalRejected: true
    };
  } finally {
    safeCleanup(root);
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(`[version-test] ${error.code || "error"}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run };
