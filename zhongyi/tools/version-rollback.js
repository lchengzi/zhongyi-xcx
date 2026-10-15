"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { VERSION_RUNTIME_PATH, CONFIG_RUNTIME_PATH, versionRuntimeReplacement } = require("./runtime-projections");
const {
  ACTIVE_PATH,
  ARTIFACT_PATHS,
  RECOVERY_PREFIX,
  SCHEMA_VERSION,
  activeStateFor,
  assertReleaseEligible,
  ensure,
  ensureWritableTarget,
  loadVersionState,
  renderJson,
  sha256Buffer,
  sha256Value,
  verifySnapshot,
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

function planRollback(root, targetReleaseId, options) {
  const settings = options || {};
  const state = loadVersionState(root, settings.now);
  ensure(typeof targetReleaseId === "string" && targetReleaseId, "invalid_argument", "Target release ID is required");
  ensure(targetReleaseId !== state.active.releaseId, "same_release", `Release ${targetReleaseId} is already active`);
  const target = state.manifest.releases.find((release) => release.id === targetReleaseId);
  ensure(target, "unknown_release", `Target release ${targetReleaseId} is not in the manifest`);
  assertReleaseEligible(target, state.notices, "rollback");
  const snapshot = verifySnapshot(root, target);
  let currentVerification;
  try {
    currentVerification = verifyWorkspace(root, { now: settings.now });
  } catch (error) {
    currentVerification = { ok: false, code: error.code || "error", message: error.message };
  }
  const planBody = {
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: state.manifest.manifestVersion,
    noticesVersion: state.notices.noticesVersion,
    fromReleaseId: state.active.releaseId,
    targetReleaseId: target.id,
    targetReleaseDigest: sha256Value(target),
    targetSnapshotSha256: target.snapshot.sha256,
    artifacts: target.artifacts.map((artifact) => ({
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes
    }))
  };
  return {
    ...planBody,
    planDigest: sha256Value(planBody),
    currentVerification,
    snapshotArtifactCount: snapshot.artifacts.length,
    requiresConfirmation: {
      releaseId: target.id,
      planDigest: sha256Value(planBody)
    }
  };
}

function recoveryPayload(root, state, targetReleaseId, createdAt) {
  const artifacts = ARTIFACT_PATHS.map((relative) => {
    const file = ensureWritableTarget(root, relative, (item) => ARTIFACT_PATHS.includes(item), `recovery source ${relative}`);
    if (!fs.existsSync(file)) return { path: relative, existed: false, sha256: null, bytes: 0, contentBase64: null };
    const bytes = fs.readFileSync(file);
    return {
      path: relative,
      existed: true,
      sha256: sha256Buffer(bytes),
      bytes: bytes.length,
      contentBase64: bytes.toString("base64")
    };
  });
  const activeFile = ensureWritableTarget(root, ACTIVE_PATH, (item) => item === ACTIVE_PATH, "recovery active state");
  const activeBytes = fs.readFileSync(activeFile);
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    fromReleaseId: state.active.releaseId,
    targetReleaseId,
    activeState: {
      path: ACTIVE_PATH,
      sha256: sha256Buffer(activeBytes),
      bytes: activeBytes.length,
      contentBase64: activeBytes.toString("base64")
    },
    artifacts
  };
}

function recoveryPath(fromReleaseId, targetReleaseId, createdAt) {
  const stamp = createdAt.replace(/[-:.]/g, "");
  const nonce = crypto.randomBytes(4).toString("hex");
  return `${RECOVERY_PREFIX}${stamp}-${fromReleaseId}-to-${targetReleaseId}-${nonce}.json`;
}

function writeStagedFile(target, bytes, nonce) {
  const temporary = `${target}.version-tmp-${nonce}`;
  ensure(!fs.existsSync(temporary), "file_exists", `Temporary path already exists: ${temporary}`);
  const handle = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return temporary;
}

function transactionalReplace(root, replacements, verify) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const targets = replacements.map((replacement) => {
    const allowed = replacement.relative === ACTIVE_PATH
      ? (item) => item === ACTIVE_PATH
      : (item) => ARTIFACT_PATHS.includes(item) || item === VERSION_RUNTIME_PATH || item === CONFIG_RUNTIME_PATH;
    const target = ensureWritableTarget(root, replacement.relative, allowed, `rollback target ${replacement.relative}`);
    return {
      ...replacement,
      target,
      temporary: `${target}.version-tmp-${nonce}`,
      backup: `${target}.version-backup-${nonce}`,
      hadOriginal: fs.existsSync(target),
      installed: false
    };
  });
  ensure(new Set(targets.map((item) => item.target)).size === targets.length, "duplicate_target", "Transaction targets must be unique");
  const staged = [];
  try {
    for (const item of targets) {
      ensure(!fs.existsSync(item.backup), "file_exists", `Backup path already exists: ${item.backup}`);
      writeStagedFile(item.target, item.bytes, nonce);
      staged.push(item);
    }
    for (const item of staged) {
      ensure(!fs.existsSync(item.backup), "file_exists", `Backup path already exists: ${item.backup}`);
      if (item.hadOriginal) fs.renameSync(item.target, item.backup);
      fs.renameSync(item.temporary, item.target);
      item.installed = true;
    }
    const verification = verify();
    const cleanupWarnings = [];
    for (const item of staged) {
      if (item.hadOriginal && fs.existsSync(item.backup)) {
        try {
          fs.unlinkSync(item.backup);
        } catch (cleanupError) {
          cleanupWarnings.push({ path: item.backup, message: cleanupError.message });
        }
      }
    }
    return { verification, cleanupWarnings };
  } catch (error) {
    for (const item of [...staged].reverse()) {
      try {
        if (item.installed && fs.existsSync(item.target)) fs.unlinkSync(item.target);
        if (item.hadOriginal && fs.existsSync(item.backup)) fs.renameSync(item.backup, item.target);
        if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
      } catch (restoreError) {
        error.message += `; restore failed for ${item.relative}: ${restoreError.message}`;
      }
    }
    throw error;
  } finally {
    for (const item of staged) {
      if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    }
  }
}

function applyRollback(root, targetReleaseId, confirmation, options) {
  const settings = options || {};
  const plan = planRollback(root, targetReleaseId, settings);
  const approval = confirmation || {};
  ensure(approval.releaseId === targetReleaseId, "confirmation_mismatch", "--confirm-release must exactly match the target release ID");
  ensure(approval.planDigest === plan.planDigest, "confirmation_mismatch", "--confirm-plan must exactly match the current rollback plan digest");
  const state = loadVersionState(root, settings.now);
  const target = state.manifest.releases.find((release) => release.id === targetReleaseId);
  const snapshot = verifySnapshot(root, target);
  const createdAt = settings.now || new Date().toISOString();
  const recovery = recoveryPayload(root, state, target.id, createdAt);
  const recoveryBytes = Buffer.from(renderJson(recovery), "utf8");
  const recoveryRelative = recoveryPath(state.active.releaseId, target.id, createdAt);
  writeNewFile(root, recoveryRelative, recoveryBytes, (relative) => relative.startsWith(RECOVERY_PREFIX));
  const recoveryReference = { path: recoveryRelative, sha256: sha256Buffer(recoveryBytes) };
  const nextActive = activeStateFor(target, state.manifest, state.notices, {
    mode: "rollback",
    previousReleaseId: state.active.releaseId,
    activatedAt: createdAt,
    recoverySnapshot: recoveryReference
  });
  const replacements = snapshot.artifacts.map((artifact) => ({
    relative: artifact.path,
    bytes: Buffer.from(artifact.contentBase64, "base64")
  }));
  replacements.push({ relative: ACTIVE_PATH, bytes: Buffer.from(renderJson(nextActive), "utf8") });
  const runtime = versionRuntimeReplacement(nextActive);
  replacements.push(runtime);
  const transaction = transactionalReplace(root, replacements, () => {
    ensure(fs.readFileSync(path.join(root, runtime.relative)).equals(runtime.bytes), "runtime_projection_mismatch", "Rollback runtime projection differs from active state");
    return verifyWorkspace(root, { now: createdAt });
  });
  return {
    ok: true,
    fromReleaseId: state.active.releaseId,
    releaseId: target.id,
    planDigest: plan.planDigest,
    recoverySnapshot: recoveryReference,
    verification: transaction.verification,
    cleanupWarnings: transaction.cleanupWarnings
  };
}

function main(argv) {
  const args = parseArgs(argv);
  ensure(args.command === "plan" || args.command === "apply", "invalid_argument", "Usage: version-rollback.js <plan|apply> --release ID [--confirm-release ID --confirm-plan SHA256] [--root PATH]");
  const root = args.root ? path.resolve(args.root) : DEFAULT_ROOT;
  ensure(typeof args.release === "string" && args.release, "invalid_argument", "--release is required");
  if (args.command === "plan") {
    console.log(JSON.stringify(planRollback(root, args.release), null, 2));
    return;
  }
  const result = applyRollback(root, args.release, {
    releaseId: args.confirmRelease,
    planDigest: args.confirmPlan
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[version-rollback] ${error.code || "error"}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  applyRollback,
  main,
  parseArgs,
  planRollback,
  recoveryPayload,
  transactionalReplace
};
