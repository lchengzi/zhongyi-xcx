"use strict";

const fs = require("fs");
const path = require("path");
const { renderRuntimeProjection, checkRuntimeJsonProjections } = require("./runtime-projections");
const {
  expectedIngredientReviewDigest,
  expectedIngredientSnapshotDigest,
  expectedExternalFoodSnapshotDigest,
  expectedRecipeIngredientSnapshotDigest,
  expectedRecipeBundleDigest,
  expectedRecipeSourceTextDigest
} = require("./recipe-digests");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "ingredients.js");
const RECIPES_FILE = path.join(ROOT, "data", "recipes.js");
const PUBLIC_RECIPES_FILE = path.join(ROOT, "data", "recipes-public.js");
const OPTIONS_FILE = path.join(ROOT, "data", "options.js");
const RULE_SET_FILE = path.join(ROOT, "data", "rule-set.js");
const MAIN_PAGES = [
  "pages/index/index",
  "pages/favorites/favorites",
  "pages/compare/compare",
  "pages/plan/plan",
  "pages/privacy/privacy"
];
const EXPECTED_SUBPACKAGES = [
  { root: "subpackages/catalog", pages: ["detail/detail"] },
  {
    root: "subpackages/official",
    pages: ["official-plans/official-plans", "official-plan-detail/official-plan-detail"]
  }
];
const EXPECTED_PAGES = [
  ...MAIN_PAGES,
  ...EXPECTED_SUBPACKAGES.flatMap((subpackage) => subpackage.pages.map((page) => `${subpackage.root}/${page}`))
];
const TAB_PAGES = ["pages/index/index", "pages/favorites/favorites", "pages/compare/compare", "pages/plan/plan"];
const LEGACY_PAGE_ROOTS = ["pages/detail", "pages/official-plans", "pages/official-plan-detail"];
const EXPECTED_DOCS = [
  "docs/product-boundary.md",
  "docs/data-governance.md",
  "docs/medical-safety.md",
  "docs/seed-sources.md",
  "docs/catalog-sources.md",
  "docs/recipe-sources.md",
  "docs/professional-review-handoff.md",
  "docs/release-checklist.md",
  "docs/version-lifecycle.md",
  "docs/p4-device-test-matrix.md",
  "docs/p4-acceptance-record-template.md",
  "docs/p4-acceptance-2026-08-10-automated.md",
  "docs/p5-medical-product-separation.md",
  "docs/implementation-status.md",
  "docs/media-workflow.md",
  "docs/food-form-gap-research.md",
  "docs/source-refresh-2026-10-08.md",
  "docs/detail-page-recovery.md",
  "docs/external-food-source-candidates.md",
  "docs/professional-review-packets.md",
  "docs/public-catalog-api.md"
];
const PAGE_EXTENSIONS = ["js", "json", "wxml", "wxss"];
const POPULATION_FIELDS = ["pregnancy", "breastfeeding", "infantsToddlers", "children", "olderAdults"];
const SAFETY_VALUES = new Set(["yes", "no", "unknown"]);
const REGULATORY_STATUSES = new Set([
  "listed", "ordinary_food", "restricted", "pending", "superseded", "withdrawn", "unknown"
]);
const CATALOG_REVIEW_STATES = new Set(["pending", "source_checked", "reviewed"]);
const PART_REVIEW_STATES = new Set(["pending", "source_checked", "reviewed"]);
const CONTENT_REVIEW_STATES = new Set(["pending", "reviewed"]);
const SOURCE_CHECK_STATES = new Set(["pending", "checked", "failed"]);
const PROFESSIONAL_REVIEW_STATES = new Set(["pending", "reviewed", "rejected"]);
const SAFETY_REVIEW_STATES = new Set(["pending", "identity_only", "partial", "reviewed"]);
const SOURCE_STATUSES = new Set(["published", "superseded", "withdrawn", "unreachable"]);
const RECIPE_STATUSES = new Set(["draft", "reviewed", "published", "superseded", "withdrawn"]);
const RECIPE_VISIBILITY = new Set(["withheld", "published"]);
const RECIPE_SCHEMA_VERSIONS = new Set(["1.0.0", "1.1.0"]);
const EXTERNAL_FOOD_SCHEMA_VERSIONS = new Set(["1.0.0"]);
const LEGACY_RECIPE_CONTENT_VERSIONS = new Set([
  "2026.08-official-recipe.1",
  "2026.08-official-recipe.2",
  "2026.08-official-recipe.3"
]);
const RECIPE_TARGET_AVAILABILITY = new Set(["draft_under_review", "reference_available", "withheld_pattern_required"]);
const RECIPE_REVIEW_STATES = new Set(["pending", "reviewed", "rejected"]);
const REQUIRED_RECIPE_REVIEWS = ["formulaReviewState", "medicalReviewState", "pharmacyReviewState", "complianceReviewState"];
const REQUIRED_RECIPE_REVIEW_ROLES = ["tcm_clinician", "pharmacist", "nutrition_professional", "compliance", "release_approver"];
const REQUIRED_INGREDIENT_REVIEW_ROLES = ["tcm_clinician", "pharmacist", "compliance"];
const RECIPE_SOURCE_KEYS = new Set([
  "id", "sourceId", "documentNo", "status", "type", "title", "publisher", "issuer",
  "url", "publishedAt", "checkedAt", "reviewedAt", "scope"
]);
const RECIPE_LINE_IDENTITY_REVIEW_STATES = new Set(["pending", "source_checked", "reviewed"]);
const QUANTITY_KINDS = new Set(["exact", "range", "qualitative"]);
const QUANTITY_UNITS = new Set(["g", "mL", "piece", "source_text"]);
const SOURCE_EXCLUDES = new Set(["docs", "tools", "content-private", ".local", "node_modules", ".git", "cloud-assets"]);
const UPLOAD_EXCLUDES = new Set(["README.md", "package.json", ".gitignore", path.join("data", "recipes.js")]);
const VOID_WXML_TAGS = new Set(["image", "input"]);
const PACKAGE_SOURCE_LIMIT_BYTES = 2 * 1024 * 1024;
const TOTAL_SOURCE_LIMIT_BYTES = 20 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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

function assertOnlyKeys(value, allowed, label) {
  assert(isObject(value), `${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assert(unknown.length === 0, `${label} contains unsupported fields: ${unknown.join(", ")}`);
}

function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function walk(dir, relative = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relative, entry.name);
    const topLevel = next.split(path.sep)[0];
    if (SOURCE_EXCLUDES.has(topLevel)) return [];
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute, next) : [absolute];
  });
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function relativePosix(file) {
  return toPosixPath(path.relative(ROOT, file));
}

function packageRootForFile(file) {
  const relative = relativePosix(file);
  const subpackage = EXPECTED_SUBPACKAGES.find(({ root }) => relative === root || relative.startsWith(`${root}/`));
  return subpackage ? subpackage.root : "__APP__";
}

function checkAppPackageConfig(appConfig) {
  assert(Array.isArray(appConfig.pages), "app.json pages must be an array");
  assert(
    JSON.stringify(appConfig.pages) === JSON.stringify(MAIN_PAGES),
    `Main-package pages must remain ${MAIN_PAGES.join(", ")}`
  );

  const configuredSubpackages = appConfig.subPackages;
  assert(Array.isArray(configuredSubpackages), "app.json subPackages must be an array");
  assert(configuredSubpackages.length === EXPECTED_SUBPACKAGES.length, `Expected ${EXPECTED_SUBPACKAGES.length} subpackages`);
  const configuredRoots = configuredSubpackages.map((subpackage) => subpackage && subpackage.root);
  assert(new Set(configuredRoots).size === configuredRoots.length, "Duplicate subpackage root");

  for (const expected of EXPECTED_SUBPACKAGES) {
    const configured = configuredSubpackages.find((subpackage) => subpackage && subpackage.root === expected.root);
    assert(configured, `app.json is missing subpackage ${expected.root}`);
    assert(configured.independent !== true, `${expected.root} must remain an ordinary subpackage so session safety state is shared`);
    assert(
      JSON.stringify(configured.pages) === JSON.stringify(expected.pages),
      `${expected.root} page list drifted from the reviewed package boundary`
    );
  }

  for (let index = 0; index < configuredRoots.length; index += 1) {
    for (let other = index + 1; other < configuredRoots.length; other += 1) {
      assert(
        !configuredRoots[index].startsWith(`${configuredRoots[other]}/`) &&
        !configuredRoots[other].startsWith(`${configuredRoots[index]}/`),
        `Nested subpackage roots are not allowed: ${configuredRoots[index]}, ${configuredRoots[other]}`
      );
    }
  }

  const registeredPages = [
    ...appConfig.pages,
    ...configuredSubpackages.flatMap((subpackage) => subpackage.pages.map((page) => `${subpackage.root}/${page}`))
  ];
  assert(registeredPages.length === EXPECTED_PAGES.length, `Expected ${EXPECTED_PAGES.length} registered pages`);
  assert(new Set(registeredPages).size === registeredPages.length, "Duplicate registered page route");
  for (const page of EXPECTED_PAGES) assert(registeredPages.includes(page), `app.json is missing ${page}`);

  const tabPages = ((appConfig.tabBar && appConfig.tabBar.list) || []).map((item) => item && item.pagePath);
  assert(JSON.stringify(tabPages) === JSON.stringify(TAB_PAGES), "tabBar pages or order drifted from the main package");
  assert(tabPages.every((page) => appConfig.pages.includes(page)), "Every tabBar page must remain in the main package");
  for (const legacyRoot of LEGACY_PAGE_ROOTS) {
    assert(!fs.existsSync(path.join(ROOT, legacyRoot)), `Legacy page copy must be removed after subpackaging: ${legacyRoot}`);
  }

  const preload = appConfig.preloadRule && appConfig.preloadRule["pages/index/index"];
  assert(preload && preload.network === "wifi", "Index must preload reviewed subpackages on Wi-Fi only");
  assert(
    JSON.stringify(preload.packages) === JSON.stringify(EXPECTED_SUBPACKAGES.map((subpackage) => subpackage.root)),
    "Index preloadRule must reference the reviewed subpackage roots"
  );
  return new Set(registeredPages);
}

function checkDeveloperToolsConfig(projectConfig, registeredPages) {
  assert(projectConfig.miniprogramRoot === "./", "project.config.json miniprogramRoot must remain ./");
  assert(projectConfig.compileType === "miniprogram", "project.config.json compileType must be miniprogram");
  assert(projectConfig.simulatorType === "wechat", "Developer Tools simulatorType must be wechat");
  assert(projectConfig.libVersion === "3.7.6", "Developer Tools base-library baseline must remain pinned to 3.7.6");
  const setting = projectConfig.setting || {};
  for (const key of ["urlCheck", "es6", "enhance", "postcss", "minified", "minifyWXSS", "minifyWXML", "checkInvalidKey", "checkSiteMap"]) {
    assert(setting[key] === true, `Developer Tools setting.${key} must be enabled`);
  }
  for (const key of ["ignoreDevUnusedFiles", "ignoreUploadUnusedFiles", "uploadWithSourceMap", "compileHotReLoad"]) {
    assert(setting[key] === false, `Developer Tools setting.${key} must be disabled for reproducible release checks`);
  }
  assert(projectConfig.editorSetting && projectConfig.editorSetting.tabIndent === "insertSpaces" && projectConfig.editorSetting.tabSize === 2,
    "Developer Tools editor settings must use two spaces");

  const conditions = projectConfig.condition && projectConfig.condition.miniprogram && projectConfig.condition.miniprogram.list;
  assert(Array.isArray(conditions) && conditions.length >= 5, "Developer Tools must provide the P4 compile-condition set");
  const names = conditions.map((condition) => condition && condition.name);
  assert(new Set(names).size === names.length && names.every(isNonEmptyString), "Developer Tools compile-condition names must be unique");
  for (const condition of conditions) {
    assert(registeredPages.has(condition.pathName), `Compile condition targets an unknown page: ${condition.pathName}`);
    const query = String(condition.query || "");
    assert(!/(?:allerg|condition|medication|pregnan|breastfeed|redFlags?)/i.test(query),
      `Compile condition must not persist health or triage data: ${condition.name}`);
  }
}

function resolveLocalRequire(sourceFile, request) {
  if (!(request.startsWith(".") || request.startsWith("/"))) return null;
  const unresolved = request.startsWith("/")
    ? path.join(ROOT, request.slice(1))
    : path.resolve(path.dirname(sourceFile), request);
  const candidates = [unresolved, `${unresolved}.js`, `${unresolved}.json`, path.join(unresolved, "index.js")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function checkUploadIgnoreBoundary(projectConfig) {
  const ignored = projectConfig.packOptions && projectConfig.packOptions.ignore;
  assert(Array.isArray(ignored), "Upload ignore boundary must be an array");
  for (const [type, value] of [
    ["folder", "tools"], ["folder", "docs"], ["folder", "content-private"], ["folder", ".local"],
    ["file", "data/recipes.js"], ["file", "README.md"], ["file", "package.json"], ["file", ".gitignore"]
  ]) {
    assert(ignored.some((item) => item && item.type === type && item.value === value),
      `Upload ignore boundary is missing ${value} (${type})`);
  }
}

function checkRuntimePackageImports(uploadFiles, readSource = readText) {
  const includedFiles = new Set(uploadFiles);
  const javascriptFiles = uploadFiles.filter((file) => file.endsWith(".js"));
  for (const sourceFile of javascriptFiles) {
    const sourcePackage = packageRootForFile(sourceFile);
    const source = readSource(sourceFile);
    for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      const request = match[1];
      const targetFile = resolveLocalRequire(sourceFile, request);
      assert(targetFile, `Unresolved local require ${request} in ${relativePosix(sourceFile)}`);
      assert(targetFile.endsWith(".js"), `WeChat runtime require must target JavaScript in ${relativePosix(sourceFile)}: ${request}`);
      const targetRelative = path.relative(ROOT, targetFile);
      assert(targetRelative && !targetRelative.startsWith("..") && !path.isAbsolute(targetRelative),
        `Local require escapes miniprogramRoot in ${relativePosix(sourceFile)}: ${request}`);
      assert(includedFiles.has(targetFile), `Runtime require targets an excluded file in ${relativePosix(sourceFile)}: ${request}`);
      const targetPackage = packageRootForFile(targetFile);
      if (sourcePackage === "__APP__") {
        assert(targetPackage === "__APP__", `Main package cannot synchronously require ${targetPackage}: ${relativePosix(sourceFile)}`);
      } else {
        assert(targetPackage === "__APP__" || targetPackage === sourcePackage,
          `Cross-subpackage require is not allowed: ${relativePosix(sourceFile)} -> ${relativePosix(targetFile)}`);
      }
    }
  }
}

function checkRouteReferences(uploadFiles, registeredPages) {
  const tabPages = new Set(TAB_PAGES);
  for (const file of uploadFiles.filter((candidate) => /\.(?:js|wxml)$/.test(candidate))) {
    const source = readText(file);
    for (const match of source.matchAll(/(["'`])\/((?:pages|subpackages)\/[A-Za-z0-9_/-]+)(?:\?[^"'`]*)?\1/g)) {
      assert(registeredPages.has(match[2]), `Unknown page route /${match[2]} in ${relativePosix(file)}`);
    }
    for (const match of source.matchAll(/\broute\s*===\s*["']((?:pages|subpackages)\/[A-Za-z0-9_/-]+)["']/g)) {
      assert(registeredPages.has(match[1]), `Unknown page-stack route ${match[1]} in ${relativePosix(file)}`);
    }
    for (const match of source.matchAll(/wx\.switchTab\s*\(\s*\{\s*url\s*:\s*["'`]\/((?:pages|subpackages)\/[A-Za-z0-9_/-]+)/g)) {
      assert(tabPages.has(match[1]), `wx.switchTab target must be a tabBar main page: /${match[1]}`);
    }
  }
}

function measureUploadPackages(uploadFiles) {
  const stats = new Map([
    ["__APP__", { files: 0, bytes: 0 }],
    ...EXPECTED_SUBPACKAGES.map(({ root }) => [root, { files: 0, bytes: 0 }])
  ]);
  for (const file of uploadFiles) {
    const packageRoot = packageRootForFile(file);
    const current = stats.get(packageRoot);
    assert(current, `Unable to assign upload file to a package: ${relativePosix(file)}`);
    current.files += 1;
    current.bytes += fs.statSync(file).size;
  }
  for (const [packageRoot, stat] of stats) {
    assert(stat.files > 0, `Upload package is empty: ${packageRoot}`);
    assert(stat.bytes < PACKAGE_SOURCE_LIMIT_BYTES, `Conservative package source budget exceeded for ${packageRoot}: ${stat.bytes}`);
  }
  const totalBytes = [...stats.values()].reduce((sum, stat) => sum + stat.bytes, 0);
  const preloadBytes = EXPECTED_SUBPACKAGES.reduce((sum, { root }) => sum + stats.get(root).bytes, 0);
  assert(preloadBytes < PACKAGE_SOURCE_LIMIT_BYTES, `Wi-Fi preload source budget exceeded: ${preloadBytes}`);
  assert(totalBytes < TOTAL_SOURCE_LIMIT_BYTES, `Conservative total package source budget exceeded: ${totalBytes}`);
  return {
    main: stats.get("__APP__"),
    subpackages: Object.fromEntries(EXPECTED_SUBPACKAGES.map(({ root }) => [root, stats.get(root)])),
    preloadBytes,
    totalBytes
  };
}

function checkWxml(file) {
  const source = readText(file)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<wxs\b[\s\S]*?<\/wxs>/g, "");
  const stack = [];

  for (const match of source.matchAll(/<\s*(\/?)\s*([a-zA-Z][\w-]*)\b[^>]*>/g)) {
    const closing = Boolean(match[1]);
    const tag = match[2];
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID_WXML_TAGS.has(tag);
    if (selfClosing) continue;

    if (closing) {
      const expected = stack.pop();
      assert(
        expected === tag,
        `Unbalanced WXML in ${path.relative(ROOT, file)}: expected </${expected}> but found </${tag}>`
      );
    } else {
      stack.push(tag);
    }
  }

  assert(
    stack.length === 0,
    `Unclosed WXML tags in ${path.relative(ROOT, file)}: ${stack.join(", ")}`
  );

  const jsFile = file.replace(/\.wxml$/i, ".js");
  if (fs.existsSync(jsFile)) {
    const jsSource = readText(jsFile);
    const handlers = [...source.matchAll(/\b(?:bind|catch)[\w:-]*\s*=\s*"([A-Za-z_$][\w$]*)"/g)].map((match) => match[1]);
    for (const handler of new Set(handlers)) {
      assert(new RegExp(`\\b${handler}\\s*\\(`).test(jsSource), `Missing handler ${handler} for ${path.relative(ROOT, file)}`);
    }
  }
}

function checkWxss(file) {
  const source = readText(file).replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const char of source) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    assert(depth >= 0, `Unexpected } in ${path.relative(ROOT, file)}`);
  }
  assert(depth === 0, `Unbalanced WXSS braces in ${path.relative(ROOT, file)}`);
}

function checkComponentReferences(configFile, config) {
  if (!isObject(config.usingComponents)) return;
  for (const [componentName, reference] of Object.entries(config.usingComponents)) {
    assert(isNonEmptyString(componentName), `Empty component name in ${path.relative(ROOT, configFile)}`);
    assert(isNonEmptyString(reference), `Empty component path for ${componentName}`);
    if (/^(plugin|dynamicLib):\/\//.test(reference)) continue;

    const componentBase = reference.startsWith("/")
      ? path.join(ROOT, reference.slice(1))
      : path.resolve(path.dirname(configFile), reference);
    for (const extension of PAGE_EXTENSIONS) {
      assert(
        fs.existsSync(`${componentBase}.${extension}`),
        `Missing ${path.relative(ROOT, componentBase)}.${extension} referenced by ${path.relative(ROOT, configFile)}`
      );
    }
  }
}

function loadCatalog() {
  assert(fs.existsSync(DATA_FILE), "Missing data/ingredients.js");
  let resolved;
  try {
    resolved = require.resolve(DATA_FILE);
    delete require.cache[resolved];
    return require(resolved);
  } catch (error) {
    throw new Error(`Unable to load data/ingredients.js: ${error.message}`);
  }
}

function loadRecipes() {
  assert(fs.existsSync(RECIPES_FILE), "Missing data/recipes.js");
  try {
    delete require.cache[require.resolve(RECIPES_FILE)];
    return require(RECIPES_FILE);
  } catch (error) {
    throw new Error(`Unable to load data/recipes.js: ${error.message}`);
  }
}

function loadPublicRecipes() {
  assert(fs.existsSync(PUBLIC_RECIPES_FILE), "Missing data/recipes-public.js");
  try {
    delete require.cache[require.resolve(PUBLIC_RECIPES_FILE)];
    return require(PUBLIC_RECIPES_FILE);
  } catch (error) {
    throw new Error(`Unable to load data/recipes-public.js: ${error.message}`);
  }
}

function loadRuleSet() {
  assert(fs.existsSync(RULE_SET_FILE), "Missing data/rule-set.js");
  try {
    delete require.cache[require.resolve(RULE_SET_FILE)];
    return require(RULE_SET_FILE);
  } catch (error) {
    throw new Error(`Unable to load data/rule-set.js: ${error.message}`);
  }
}

function checkRuleSet(ruleSet) {
  assert(isObject(ruleSet), "Rule set must export an object");
  assert(isNonEmptyString(ruleSet.schemaVersion), "Rule-set schemaVersion is required");
  assert(isNonEmptyString(ruleSet.contentVersion), "Rule-set contentVersion is required");
  checkDate(ruleSet.publishedAt, "Rule-set publishedAt");
  assert(Array.isArray(ruleSet.components) && ruleSet.components.length > 0, "Rule-set components are required");
  assert(Number.isInteger(ruleSet.count) && ruleSet.count === ruleSet.components.length, "Rule-set count must equal components.length");
  assert(ruleSet.components.every(isNonEmptyString), "Rule-set components must be non-empty strings");
  assert(new Set(ruleSet.components).size === ruleSet.components.length, "Rule-set components contain duplicates");
}

function checkFilterOptions() {
  assert(fs.existsSync(OPTIONS_FILE), "Missing data/options.js");
  let options;
  try {
    delete require.cache[require.resolve(OPTIONS_FILE)];
    options = require(OPTIONS_FILE);
  } catch (error) {
    throw new Error(`Unable to load data/options.js: ${error.message}`);
  }

  for (const groupName of ["GOAL_OPTIONS", "CATEGORY_OPTIONS", "USAGE_TYPE_OPTIONS", "TASTE_OPTIONS", "RED_FLAG_OPTIONS"]) {
    const group = options[groupName];
    assert(Array.isArray(group), `${groupName} must be an array`);
    const values = group.map((item, index) => {
      assert(isObject(item), `${groupName}[${index}] must be an object`);
      assert(isNonEmptyString(item.value), `${groupName}[${index}].value is required`);
      assert(isNonEmptyString(item.label), `${groupName}[${index}].label is required`);
      return item.value.trim();
    });
    assert(new Set(values).size === values.length, `${groupName} contains duplicate values`);
  }

  const redFlagValues = new Set(options.RED_FLAG_OPTIONS.map((item) => item.value));
  for (const required of [
    "breathing_difficulty", "altered_consciousness", "sudden_severe_chest_pain",
    "stroke_like_signs", "suspected_severe_allergy", "bleeding_or_black_stool",
    "persistent_vomiting_or_dehydration", "pregnancy_emergency_signs", "immediate_self_harm_risk"
  ]) {
    assert(redFlagValues.has(required), `RED_FLAG_OPTIONS is missing required triage code ${required}`);
  }
  return {
    goals: new Set(options.GOAL_OPTIONS.map((item) => item.value)),
    categories: new Set(options.CATEGORY_OPTIONS.map((item) => item.value)),
    usageTypes: new Set(options.USAGE_TYPE_OPTIONS.map((item) => item.value)),
    tastes: new Set(options.TASTE_OPTIONS.map((item) => item.value))
  };
}

function checkTriageEntryPoints() {
  const indexWxml = readText(path.join(ROOT, "pages", "index", "index.wxml"));
  assert(indexWxml.includes('bindchange="onRedFlagChange"'), "Index safety drawer is missing the red-flag handler");
  for (const page of EXPECTED_PAGES) {
    const wxml = readText(path.join(ROOT, `${page}.wxml`));
    assert(wxml.includes("120"), `${page}.wxml is missing the mainland emergency-number copy`);
  }
  for (const page of EXPECTED_PAGES.filter((item) => item !== "pages/index/index")) {
    const wxml = readText(path.join(ROOT, `${page}.wxml`));
    assert(wxml.includes("triageBlocked"), `${page}.wxml is missing the cross-page triage gate`);
  }
}

function checkP3EntryPoints() {
  const indexWxml = readText(path.join(ROOT, "pages", "index", "index.wxml"));
  assert(indexWxml.includes('bindchange="onAgeGroupChange"'), "Index safety drawer is missing the single-choice age-group handler");
  for (const key of [
    "pregnancyStatus", "breastfeedingStatus", "allergyStatus", "conditionStatus", "medicationStatus"
  ]) {
    assert(
      indexWxml.includes(`data-key="${key}"`) && indexWxml.includes('bindchange="onSafetyStatusChange"'),
      `Index safety drawer is missing the explicit tri-state field ${key}`
    );
  }

  const directoryWxml = readText(path.join(ROOT, "subpackages", "official", "official-plans", "official-plans.wxml"));
  const detailWxml = readText(path.join(ROOT, "subpackages", "official", "official-plan-detail", "official-plan-detail.wxml"));
  assert(directoryWxml.includes("publishedCards") && directoryWxml.includes("pendingCards"), "Official-plan directory must separate published and pending recipes");
  assert(detailWxml.includes("contentHidden"), "Official-plan detail must retain the withheld-content gate");
  assert(detailWxml.includes("当前不展示材料、用量和做法"), "Official-plan detail is missing draft-withholding copy");

  for (const relative of [
    "app.js",
    "subpackages/official/official-plans/official-plans.js",
    "subpackages/official/official-plan-detail/official-plan-detail.js"
  ]) {
    const source = readText(path.join(ROOT, relative));
    assert(!source.includes("setStorageSync"), `${relative} must not persist diagnosis targets or health acknowledgements`);
  }
  for (const relative of [
    "subpackages/official/official-plans/official-plans.js",
    "subpackages/official/official-plan-detail/official-plan-detail.js"
  ]) {
    const source = readText(path.join(ROOT, relative));
    assert(source.includes("recipes-public"), `${relative} must use the sanitized public recipe index`);
    assert(!/data\/recipes["']/.test(source), `${relative} must not import the excluded full review data`);
  }
}

function checkDate(value, label) {
  assert(isNonEmptyString(value), `${label} must be a non-empty date string`);
  assert(/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value), `${label} must use ISO date format`);
  assert(!Number.isNaN(Date.parse(value)), `${label} is not a valid date`);
}

function checkSourceDate(value, label) {
  assert(isNonEmptyString(value), `${label} must be a non-empty date string`);
  assert(/^\d{4}-\d{2}(?:-\d{2})?(?:T|$)/.test(value), `${label} must use ISO year-month or date format`);
  assert(!Number.isNaN(Date.parse(value)), `${label} is not a valid date`);
}

function checkSource(source, label) {
  if (typeof source === "string") {
    assert(isNonEmptyString(source), `${label} contains an empty source id`);
    return source.trim();
  }

  assert(isObject(source), `${label} must be a source id or source object`);
  const sourceId = source.id || source.sourceId || source.documentNo;
  assert(isNonEmptyString(sourceId), `${label} source object is missing id/documentNo`);
  assert(isNonEmptyString(source.title), `${label} source object is missing title`);
  assert(isNonEmptyString(source.issuer || source.publisher), `${label} source object is missing issuer/publisher`);
  assert(isNonEmptyString(source.url) && /^https:\/\//i.test(source.url), `${label} source URL must use HTTPS`);
  assert(SOURCE_STATUSES.has(source.status), `${label}.status is missing or invalid`);
  checkSourceDate(source.publishedAt, `${label}.publishedAt`);
  if (source.reviewedAt) checkDate(source.reviewedAt, `${label}.reviewedAt`);
  checkDate(source.checkedAt, `${label}.checkedAt`);
  return sourceId.trim();
}

function checkIngredient(ingredient, index, optionSets, catalogContentVersion, ruleSet) {
  const label = `ingredients[${index}]`;
  assert(isObject(ingredient), `${label} must be an object`);
  assert(isNonEmptyString(ingredient.id), `${label}.id is required`);
  assert(isNonEmptyString(ingredient.nameCn || ingredient.name), `${label}.nameCn/name is required`);
  assert(optionSets.categories.has(ingredient.category), `${label}.category is not a controlled option`);
  for (const [field, allowed] of [["goals", optionSets.goals], ["usageTypes", optionSets.usageTypes]]) {
    assert(Array.isArray(ingredient[field]), `${label}.${field} must be an array`);
    for (const value of ingredient[field]) assert(allowed.has(value), `${label}.${field} contains unknown value ${value}`);
  }
  assert(isObject(ingredient.sensory) && Array.isArray(ingredient.sensory.tastes), `${label}.sensory.tastes must be an array`);
  for (const value of ingredient.sensory.tastes) assert(optionSets.tastes.has(value), `${label}.sensory.tastes contains unknown value ${value}`);

  assert(isObject(ingredient.regulatory), `${label}.regulatory is required`);
  assert(isNonEmptyString(ingredient.regulatory.status), `${label}.regulatory.status is required`);
  assert(
    REGULATORY_STATUSES.has(ingredient.regulatory.status),
    `${label}.regulatory.status is not a supported explicit state`
  );
  assert(isNonEmptyString(ingredient.regulatory.kind), `${label}.regulatory.kind is required`);
  assert(Array.isArray(ingredient.regulatory.sourceIds) && ingredient.regulatory.sourceIds.length > 0, `${label}.regulatory.sourceIds must cite at least one source`);
  assert(
    CATALOG_REVIEW_STATES.has(ingredient.regulatory.currentCatalogReviewState),
    `${label}.regulatory.currentCatalogReviewState is invalid`
  );
  assert(
    typeof ingredient.regulatory.restriction === "string",
    `${label}.regulatory.restriction must be an explicit string (empty is allowed only after review)`
  );
  if (ingredient.regulatory.restrictionCode === "seasoning_only") {
    assert(ingredient.regulatory.restriction.trim().length > 0, `${label} seasoning-only restriction text is required`);
    assert(JSON.stringify(ingredient.goals) === JSON.stringify(["seasoning"]), `${label} seasoning-only goals must be exactly seasoning`);
    assert(JSON.stringify(ingredient.usageTypes) === JSON.stringify(["seasoning"]), `${label} seasoning-only usageTypes must be exactly seasoning`);
  }

  assert(isObject(ingredient.identity), `${label}.identity is required`);
  assert(Array.isArray(ingredient.identity.plantNames), `${label}.identity.plantNames must be an array`);
  assert(isNonEmptyString(ingredient.identity.ediblePart), `${label}.identity.ediblePart is required`);
  assert(PART_REVIEW_STATES.has(ingredient.identity.partReviewState), `${label}.identity.partReviewState is invalid`);
  if (ingredient.identity.partReviewState !== "pending") {
    assert(ingredient.identity.plantNames.length > 0, `${label}.identity.plantNames is required after source review`);
    assert(isNonEmptyString(ingredient.identity.latinName), `${label}.identity.latinName is required after source review`);
  }

  assert(isObject(ingredient.safety), `${label}.safety is required`);
  assert(Array.isArray(ingredient.safety.sourceIds), `${label}.safety.sourceIds must be an array`);
  for (const field of POPULATION_FIELDS) {
    const raw = ingredient.safety[field];
    assert(typeof raw === "string", `${label}.safety.${field} must be an explicit string; preserve unknown`);
    assert(
      SAFETY_VALUES.has(raw),
      `${label}.safety.${field} must be one of ${Array.from(SAFETY_VALUES).join("/")}`
    );
  }

  for (const field of ["allergenKeys", "avoidConditions", "cautionConditions", "drugInteractions", "preparationWarnings"]) {
    assert(Array.isArray(ingredient.safety[field]), `${label}.safety.${field} must be an array`);
  }
  for (const field of [
    "allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"
  ]) {
    assert(SAFETY_REVIEW_STATES.has(ingredient.safety[field]), `${label}.safety.${field} is invalid`);
  }

  assert(isObject(ingredient.traditional), `${label}.traditional is required`);
  assert(CONTENT_REVIEW_STATES.has(ingredient.traditional.reviewState), `${label}.traditional.reviewState is invalid`);
  assert(isObject(ingredient.foodUse), `${label}.foodUse is required`);
  assert(CONTENT_REVIEW_STATES.has(ingredient.foodUse.mappingReviewState), `${label}.foodUse.mappingReviewState is invalid`);
  assert(Array.isArray(ingredient.foodUse.sourceIds), `${label}.foodUse.sourceIds must be an array`);

  assert(isObject(ingredient.audit), `${label}.audit is required`);
  assert(SOURCE_CHECK_STATES.has(ingredient.audit.sourceCheckState), `${label}.audit.sourceCheckState is invalid`);
  assert(
    PROFESSIONAL_REVIEW_STATES.has(ingredient.audit.professionalReviewState),
    `${label}.audit.professionalReviewState is invalid`
  );
  if (ingredient.audit.sourceCheckState === "checked") {
    checkDate(ingredient.audit.sourceCheckedAt, `${label}.audit.sourceCheckedAt`);
  }
  assert(Array.isArray(ingredient.audit.reviewedBy), `${label}.audit.reviewedBy must be an array`);
  assert(Array.isArray(ingredient.audit.reviews), `${label}.audit.reviews must be an array`);
  assert(ingredient.audit.ingredientDigest === null || /^sha256:[a-f0-9]{64}$/.test(ingredient.audit.ingredientDigest), `${label}.audit.ingredientDigest must be null or a sha256 digest`);
  ingredient.audit.reviews.forEach((review, reviewIndex) => {
    const reviewLabel = `${label}.audit.reviews[${reviewIndex}]`;
    assert(isObject(review), `${reviewLabel} must be an object`);
    assert(isNonEmptyString(review.reviewId) && isNonEmptyString(review.role), `${reviewLabel} identity fields are required`);
    assert(RECIPE_REVIEW_STATES.has(review.state), `${reviewLabel}.state is invalid`);
    checkDate(review.reviewedAt, `${reviewLabel}.reviewedAt`);
    assert(isNonEmptyString(review.contentVersion) && isNonEmptyString(review.rulesVersion), `${reviewLabel} version bindings are required`);
    assert(/^sha256:[a-f0-9]{64}$/.test(review.ingredientDigest || ""), `${reviewLabel}.ingredientDigest is invalid`);
  });
  assert(new Set(ingredient.audit.reviews.map((review) => review.reviewId)).size === ingredient.audit.reviews.length, `${label}.audit.reviews must use unique review IDs`);
  if (ingredient.audit.professionalReviewState === "reviewed") {
    assert(ingredient.audit.reviewedBy.every(isNonEmptyString), `${label}.audit.reviewedBy must contain non-empty review roles`);
    checkDate(ingredient.audit.reviewedAt, `${label}.audit.reviewedAt`);
    assert(Date.parse(ingredient.audit.reviewedAt) <= Date.now(), `${label}.audit.reviewedAt cannot be in the future`);
    assert(ingredient.audit.sourceCheckState === "checked", `${label}.professional review requires checked sources`);
    assert(ingredient.audit.ingredientDigest === expectedIngredientReviewDigest(ingredient), `${label}.audit.ingredientDigest does not match current ingredient content`);
    const requiredReviews = REQUIRED_INGREDIENT_REVIEW_ROLES.map((role) => {
      const review = ingredient.audit.reviews.find((item) => item && item.role === role && item.state === "reviewed");
      assert(review, `${label} is missing a completed ${role} ingredient review`);
      assert(Date.parse(review.reviewedAt) <= Date.parse(ingredient.audit.reviewedAt) && Date.parse(review.reviewedAt) <= Date.now(), `${label} ${role} review date is later than final/current time`);
      assert(review.contentVersion === catalogContentVersion, `${label} ${role} review is bound to a stale catalog version`);
      assert(review.rulesVersion === ruleSet.contentVersion, `${label} ${role} review is bound to a stale rules version`);
      assert(review.ingredientDigest === ingredient.audit.ingredientDigest, `${label} ${role} review is not bound to the current ingredient digest`);
      assert(ingredient.audit.reviewedBy.includes(role), `${label}.audit.reviewedBy is missing ${role}`);
      return review;
    });
    assert(new Set(requiredReviews.map((review) => review.reviewId)).size === REQUIRED_INGREDIENT_REVIEW_ROLES.length, `${label} required ingredient reviews must use independent review IDs`);
  }
  if (ingredient.traditional.reviewState === "reviewed") {
    assert(ingredient.audit.professionalReviewState === "reviewed", `${label}.traditional cannot be reviewed before professional audit`);
  }
  if (ingredient.foodUse.mappingReviewState === "reviewed") {
    assert(ingredient.audit.sourceCheckState === "checked", `${label}.foodUse mapping review requires checked sources`);
    assert(ingredient.foodUse.sourceIds.length > 0, `${label}.reviewed foodUse mapping requires field-level sourceIds`);
  }
  if (ingredient.regulatory.currentCatalogReviewState === "reviewed") {
    assert(ingredient.identity.partReviewState === "reviewed", `${label}.catalog review requires reviewed identity part`);
    assert(ingredient.audit.sourceCheckState === "checked", `${label}.catalog review requires checked sources`);
  }

  const embeddedSources = Array.isArray(ingredient.sources) ? ingredient.sources : [];
  const directSourceIds = Array.isArray(ingredient.sourceIds) ? ingredient.sourceIds : [];
  const regulatorySourceIds = Array.isArray(ingredient.regulatory.sourceIds)
    ? ingredient.regulatory.sourceIds
    : [];
  assert(embeddedSources.length > 0, `${label}.sources must embed the cited source records`);
  const embeddedSourceIds = new Set(
    embeddedSources.map((source, sourceIndex) => checkSource(source, `${label}.sources[${sourceIndex}]`))
  );
  const publishedSourceIds = new Set(embeddedSources.filter((source) => isObject(source) && source.status === "published").map((source) =>
    String(source.id || source.sourceId || source.documentNo || "").trim()
  ).filter(Boolean));
  assert(embeddedSourceIds.size > 0, `${label} must have at least one usable source record`);
  for (const [field, ids] of [
    ["sourceIds", directSourceIds],
    ["regulatory.sourceIds", regulatorySourceIds],
    ["safety.sourceIds", ingredient.safety.sourceIds],
    ["foodUse.sourceIds", ingredient.foodUse.sourceIds]
  ]) {
    for (const sourceId of ids) {
      assert(isNonEmptyString(sourceId), `${label}.${field} contains an empty source id`);
      assert(embeddedSourceIds.has(sourceId), `${label}.${field} contains unresolved id ${sourceId}`);
    }
  }
  const hasExplicitSafetyRule = POPULATION_FIELDS.some((field) => ingredient.safety[field] !== "unknown") ||
    ingredient.safety.avoidConditions.length > 0 || ingredient.safety.cautionConditions.length > 0 ||
    ingredient.safety.drugInteractions.length > 0 || ingredient.safety.preparationWarnings.length > 0;
  if (hasExplicitSafetyRule) {
    assert(ingredient.safety.sourceIds.length > 0, `${label} explicit safety rules require sourceIds`);
    ingredient.safety.sourceIds.forEach((sourceId) => assert(publishedSourceIds.has(sourceId), `${label} explicit safety rule cites a source that is not published`));
  }
  if (POPULATION_FIELDS.some((field) => ingredient.safety[field] === "yes")) {
    assert(ingredient.audit.professionalReviewState === "reviewed", `${label} positive population suitability requires completed professional review`);
  }
  const hasReviewedSafetyField = [
    "allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"
  ].some((field) => ingredient.safety[field] === "reviewed");
  if (hasReviewedSafetyField) {
    assert(ingredient.audit.professionalReviewState === "reviewed", `${label} safety fields cannot be reviewed before professional audit`);
    assert(ingredient.audit.sourceCheckState === "checked", `${label} reviewed safety fields require checked sources`);
    assert(ingredient.safety.sourceIds.length > 0, `${label} reviewed safety fields require field-level sourceIds`);
  }
  if (ingredient.foodUse.mappingReviewState === "reviewed") {
    ingredient.foodUse.sourceIds.forEach((sourceId) => assert(publishedSourceIds.has(sourceId), `${label}.foodUse cites a source that is not published`));
  }
  if (ingredient.regulatory.currentCatalogReviewState === "reviewed") {
    ingredient.regulatory.sourceIds.forEach((sourceId) => assert(publishedSourceIds.has(sourceId), `${label}.regulatory cites a source that is not published`));
  }
  if (ingredient.audit.professionalReviewState === "reviewed") {
    for (const [field, ids] of [
      ["regulatory.sourceIds", ingredient.regulatory.sourceIds],
      ["foodUse.sourceIds", ingredient.foodUse.sourceIds],
      ["safety.sourceIds", ingredient.safety.sourceIds]
    ]) {
      assert(ids.length > 0, `${label}.${field} is required for a professionally reviewed ingredient`);
      ids.forEach((sourceId) => assert(publishedSourceIds.has(sourceId), `${label}.${field} cites a source that is not published`));
    }
  }

  if (ingredient.audit.professionalReviewState !== "reviewed" && isObject(ingredient.traditional)) {
    const contentFields = ["nature", "flavors", "meridians", "summary", "functions", "indications"];
    const hasUnreviewedContent = contentFields.some((field) => {
      const value = ingredient.traditional[field];
      if (Array.isArray(value)) return value.length > 0;
      if (!isNonEmptyString(value)) return false;
      return !new Set(["unknown", "pending", "待审核", "待复核"]).has(value.trim());
    });
    assert(!hasUnreviewedContent, `${label} exposes traditional content before professional review`);
  }

  return ingredient.id.trim();
}

function ingredientReadyForPublishedRecipe(ingredient) {
  if (!ingredient || !ingredient.regulatory || !ingredient.identity || !ingredient.foodUse || !ingredient.safety || !ingredient.audit) return false;
  return ["listed", "ordinary_food"].includes(ingredient.regulatory.status) &&
    ingredient.regulatory.currentCatalogReviewState === "reviewed" &&
    ingredient.identity.partReviewState === "reviewed" &&
    ingredient.foodUse.mappingReviewState === "reviewed" &&
    ingredient.audit.sourceCheckState === "checked" &&
    ingredient.audit.professionalReviewState === "reviewed" &&
    ["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"]
      .every((field) => ingredient.safety[field] === "reviewed");
}

function checkExternalFoodRegistry(recipeData, catalog, ruleSet, globalSourceSet, globalSourceById) {
  const registry = recipeData.externalFoods;
  assert(isObject(registry), "Recipe schema 1.1+ requires an externalFoods registry");
  assert(EXTERNAL_FOOD_SCHEMA_VERSIONS.has(registry.schemaVersion), `Unsupported externalFoods schemaVersion ${registry.schemaVersion}`);
  assert(isNonEmptyString(registry.contentVersion), "externalFoods contentVersion is required");
  checkDate(registry.publishedAt, "externalFoods.publishedAt");
  assert(Array.isArray(registry.items), "externalFoods.items must be an array");
  assert(Number.isInteger(registry.count) && registry.count === registry.items.length, "externalFoods.count must equal items.length");
  const recipeSafetyEngine = require(path.join(ROOT, "utils", "recipe-safety.js"));
  assert(recipeSafetyEngine.externalFoodRegistryValid(registry),
    "externalFoods contains an unsupported field, malformed record or invalid registry count");
  const catalogIds = new Set(catalog.ingredients.map((ingredient) => ingredient.id));
  const ids = [];
  const byId = new Map();
  registry.items.forEach((food, index) => {
    const label = `externalFoods.items[${index}]`;
    assert(isObject(food) && isNonEmptyString(food.id) && food.id.startsWith("external-food-"), `${label}.id must use the external-food namespace`);
    assert(!catalogIds.has(food.id), `${label}.id collides with the 106-item official catalog`);
    assert(food.recordKind === "external_food" && food.contentVersion === registry.contentVersion, `${label} registry identity/version is invalid`);
    assert(isNonEmptyString(food.name) && Array.isArray(food.aliases) && isNonEmptyString(food.occurrenceFormText), `${label} name/aliases/formula occurrence form are required`);
    assert(food.category === "ordinary_food_candidate", `${label}.category must remain an ordinary-food candidate until review`);
    assert(Array.isArray(food.occurrenceEvidence) && food.occurrenceEvidence.length > 0, `${label}.occurrenceEvidence is required`);
    const embeddedSourceIdList = (food.sources || []).map((source, sourceIndex) =>
      checkSource(source, `${label}.sources[${sourceIndex}]`));
    assert(new Set(embeddedSourceIdList).size === embeddedSourceIdList.length, `${label}.sources must use unique source IDs`);
    const embeddedSourceIds = new Set(embeddedSourceIdList);
    const embeddedSourceById = new Map(embeddedSourceIdList.map((sourceId, sourceIndex) => [sourceId, food.sources[sourceIndex]]));
    food.sources.forEach((source, sourceIndex) => {
      assertOnlyKeys(source, RECIPE_SOURCE_KEYS, `${label}.sources[${sourceIndex}]`);
      assert(globalSourceSet.has(source.id) && isObject(globalSourceById.get(source.id)) &&
        canonicalJson(source) === canonicalJson(globalSourceById.get(source.id)),
      `${label}.sources[${sourceIndex}] must equal the canonical recipe source object`);
    });
    const occurrenceSourceIds = new Set();
    food.occurrenceEvidence.forEach((evidence, evidenceIndex) => {
      const evidenceLabel = `${label}.occurrenceEvidence[${evidenceIndex}]`;
      assert(isNonEmptyString(evidence.recipeId) && isNonEmptyString(evidence.lineId), `${evidenceLabel} recipe/line binding is required`);
      assert(evidence.claimScope === "formula_occurrence_and_quantity_only", `${evidenceLabel} must not claim identity, regulation or safety`);
      assert(globalSourceSet.has(evidence.sourceId) && embeddedSourceIds.has(evidence.sourceId), `${evidenceLabel}.sourceId is unresolved`);
      assert(isObject(embeddedSourceById.get(evidence.sourceId)) && isObject(globalSourceById.get(evidence.sourceId)) &&
        canonicalJson(embeddedSourceById.get(evidence.sourceId)) === canonicalJson(globalSourceById.get(evidence.sourceId)),
      `${evidenceLabel}.sourceId must embed the canonical recipe source object without drift`);
      occurrenceSourceIds.add(evidence.sourceId);
    });
    assert(isObject(food.identity) && isNonEmptyString(food.identity.ediblePart) && !Object.prototype.hasOwnProperty.call(food.identity, "foodForm"),
      `${label}.identity must not absorb the formula occurrence form`);
    assert(PART_REVIEW_STATES.has(food.identity.partReviewState) && Array.isArray(food.identity.sourceIds), `${label}.identity review fields are invalid`);
    assert(isObject(food.regulatory) && ["ordinary_food_candidate", "ordinary_food"].includes(food.regulatory.kind) &&
      ["pending", "ordinary_food"].includes(food.regulatory.status), `${label}.regulatory identity/status is invalid`);
    assert(CATALOG_REVIEW_STATES.has(food.regulatory.currentCatalogReviewState) && Array.isArray(food.regulatory.sourceIds), `${label}.regulatory review fields are invalid`);
    assert(isObject(food.foodUse) && CONTENT_REVIEW_STATES.has(food.foodUse.mappingReviewState) && Array.isArray(food.foodUse.sourceIds), `${label}.foodUse review fields are invalid`);
    assert(isObject(food.safety) && Array.isArray(food.safety.sourceIds), `${label}.safety is invalid`);
    POPULATION_FIELDS.forEach((field) => assert(SAFETY_VALUES.has(food.safety[field]), `${label}.safety.${field} is invalid`));
    ["allergenKeys", "avoidConditions", "cautionConditions", "drugInteractions", "preparationWarnings"].forEach((field) =>
      assert(Array.isArray(food.safety[field]), `${label}.safety.${field} must be an array`));
    ["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"].forEach((field) =>
      assert(SAFETY_REVIEW_STATES.has(food.safety[field]), `${label}.safety.${field} is invalid`));
    [food.identity.sourceIds, food.regulatory.sourceIds, food.foodUse.sourceIds, food.safety.sourceIds].forEach((sourceIds) =>
      sourceIds.forEach((id) => assert(embeddedSourceIds.has(id), `${label} contains a field source not embedded in the record`)));
    assert(isObject(food.audit) && food.audit.occurrenceReviewState === "source_checked", `${label}.audit occurrence review is required`);
    assert(SOURCE_CHECK_STATES.has(food.audit.sourceCheckState) && PROFESSIONAL_REVIEW_STATES.has(food.audit.professionalReviewState), `${label}.audit states are invalid`);
    assert(Array.isArray(food.audit.reviewedBy) && Array.isArray(food.audit.reviews), `${label}.audit review arrays are required`);
    if (food.audit.professionalReviewState === "reviewed") {
      assert(food.identity.partReviewState === "reviewed" && food.regulatory.kind === "ordinary_food" && food.regulatory.status === "ordinary_food" &&
        food.regulatory.currentCatalogReviewState === "reviewed" && food.foodUse.mappingReviewState === "reviewed" &&
        food.audit.sourceCheckState === "checked", `${label} was marked reviewed before identity/regulatory/food-use review completed`);
      assert(["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"]
        .every((field) => food.safety[field] === "reviewed"), `${label} was marked reviewed before all safety domains completed`);
      assert([food.identity.sourceIds, food.regulatory.sourceIds, food.foodUse.sourceIds, food.safety.sourceIds]
        .every((sourceIds) => sourceIds.length > 0), `${label} reviewed domains require direct field sources`);
      assert([food.identity.sourceIds, food.regulatory.sourceIds, food.foodUse.sourceIds, food.safety.sourceIds]
        .every((sourceIds) => sourceIds.every((id) => !occurrenceSourceIds.has(id))),
      `${label} formula occurrence-only sources cannot be reused as direct identity/regulatory/food-use/safety evidence`);
      const publishedSources = new Set((food.sources || []).filter((source) => source.status === "published").map((source) => source.id));
      assert([food.identity.sourceIds, food.regulatory.sourceIds, food.foodUse.sourceIds, food.safety.sourceIds]
        .every((sourceIds) => sourceIds.every((id) => publishedSources.has(id))), `${label} reviewed domains cite unavailable sources`);
      checkDate(food.audit.reviewedAt, `${label}.audit.reviewedAt`);
      assert(food.audit.ingredientDigest === expectedExternalFoodSnapshotDigest(food), `${label}.audit.ingredientDigest does not match current external-food content`);
      const reviews = REQUIRED_INGREDIENT_REVIEW_ROLES.map((role) => food.audit.reviews.find((review) => review && review.role === role && review.state === "reviewed"));
      reviews.forEach((review, reviewIndex) => {
        assert(review && isNonEmptyString(review.reviewId), `${label} is missing ${REQUIRED_INGREDIENT_REVIEW_ROLES[reviewIndex]} review`);
        checkDate(review.reviewedAt, `${label}.audit.reviews[${reviewIndex}].reviewedAt`);
        assert(review.contentVersion === registry.contentVersion && review.rulesVersion === ruleSet.contentVersion &&
          review.ingredientDigest === food.audit.ingredientDigest, `${label} professional review has stale bindings`);
      });
      assert(new Set(reviews.map((review) => review.reviewId)).size === reviews.length, `${label} professional reviews must use independent IDs`);
    } else {
      assert(food.audit.ingredientDigest === null && food.audit.reviews.length === 0, `${label} pending record must not carry a release digest or review signatures`);
      assert(food.identity.sourceIds.length === 0 && food.regulatory.sourceIds.length === 0 && food.foodUse.sourceIds.length === 0 && food.safety.sourceIds.length === 0,
        `${label} formula occurrence sources must not be promoted into identity/regulatory/safety fields before review`);
    }
    ids.push(food.id);
    byId.set(food.id, food);
  });
  assert(new Set(ids).size === ids.length, "Duplicate external food id");
  return { registry, byId };
}

function checkRecipeData(recipeData, catalog, ruleSet) {
  assert(isObject(recipeData), "Recipe catalog must export an object");
  assert(RECIPE_SCHEMA_VERSIONS.has(recipeData.schemaVersion), `Unsupported recipe schemaVersion ${recipeData.schemaVersion}`);
  assert(isNonEmptyString(recipeData.contentVersion), "Recipe contentVersion is required");
  const legacySchema = recipeData.schemaVersion === "1.0.0";
  if (legacySchema) {
    assert(LEGACY_RECIPE_CONTENT_VERSIONS.has(recipeData.contentVersion),
      `Legacy recipe schema is not registered for contentVersion ${recipeData.contentVersion}`);
    assert(!Object.prototype.hasOwnProperty.call(recipeData, "externalFoods"),
      "Legacy recipe schema must not contain an externalFoods registry");
  }
  checkDate(recipeData.publishedAt, "Recipe catalog publishedAt");
  assert(Array.isArray(recipeData.sources) && recipeData.sources.length > 0, "Recipe catalog sources are required");
  const globalSourceIds = recipeData.sources.map((source, index) => checkSource(source, `recipeSources[${index}]`));
  assert(new Set(globalSourceIds).size === globalSourceIds.length, "Duplicate recipe source id");
  const globalSourceSet = new Set(globalSourceIds);
  const globalSourceById = new Map(globalSourceIds.map((sourceId, sourceIndex) => [sourceId, recipeData.sources[sourceIndex]]));
  if (!legacySchema) recipeData.sources.forEach((source, index) =>
    assertOnlyKeys(source, RECIPE_SOURCE_KEYS, `recipeSources[${index}]`));
  const external = legacySchema
    ? { registry: null, byId: new Map() }
    : checkExternalFoodRegistry(recipeData, catalog, ruleSet, globalSourceSet, globalSourceById);

  assert(Array.isArray(recipeData.targets) && recipeData.targets.length > 0, "Recipe targets are required");
  const targetIds = recipeData.targets.map((target, index) => {
    const label = `recipeTargets[${index}]`;
    assert(isObject(target), `${label} must be an object`);
    assert(isNonEmptyString(target.id), `${label}.id is required`);
    assert(isNonEmptyString(target.label) && isNonEmptyString(target.shortLabel), `${label} labels are required`);
    assert(RECIPE_TARGET_AVAILABILITY.has(target.availability), `${label}.availability is invalid`);
    assert(Array.isArray(target.sourceIds) && target.sourceIds.length > 0, `${label}.sourceIds are required`);
    target.sourceIds.forEach((id) => assert(globalSourceSet.has(id), `${label}.sourceIds contains unresolved id ${id}`));
    assert(isNonEmptyString(target.description), `${label}.description is required`);
    if (target.availability !== "reference_available") assert(isNonEmptyString(target.unavailableReason), `${label}.unavailableReason is required`);
    return target.id;
  });
  assert(new Set(targetIds).size === targetIds.length, "Duplicate recipe target id");
  const targetSet = new Set(targetIds);
  const targetById = new Map(recipeData.targets.map((target) => [target.id, target]));

  assert(Array.isArray(recipeData.recipes), "Recipe catalog recipes must be an array");
  assert(Number.isInteger(recipeData.count) && recipeData.count === recipeData.recipes.length, "Recipe count must equal recipes.length");
  if (legacySchema) {
    assert(recipeData.recipes.every((recipe) => recipe && recipe.status !== "published" && recipe.publicVisibility === "withheld"),
      "Legacy recipe snapshots are documentation-only and must contain zero published recipes");
  }
  const catalogById = new Map(catalog.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const externalLineReferences = [];
  const recipeIds = recipeData.recipes.map((recipe, index) => {
    const label = `recipes[${index}]`;
    assert(isObject(recipe), `${label} must be an object`);
    assert(isNonEmptyString(recipe.id) && isNonEmptyString(recipe.revision) && isNonEmptyString(recipe.name), `${label} identity fields are required`);
    assert(RECIPE_STATUSES.has(recipe.status), `${label}.status is invalid`);
    assert(RECIPE_VISIBILITY.has(recipe.publicVisibility), `${label}.publicVisibility is invalid`);
    assert(recipe.contentVersion === recipeData.contentVersion, `${label}.contentVersion does not match recipe catalog`);
    assert(recipe.rulesVersion === ruleSet.contentVersion, `${label}.rulesVersion is not supported by the active runtime rule set`);
    assert(targetSet.has(recipe.targetId), `${label}.targetId is invalid`);
    assert(isNonEmptyString(recipe.formulaSourceId), `${label}.formulaSourceId is required`);
    assert(Array.isArray(recipe.sources) && recipe.sources.length > 0, `${label}.sources must embed source records`);
    const embeddedIds = recipe.sources.map((source, sourceIndex) => checkSource(source, `${label}.sources[${sourceIndex}]`));
    assert(new Set(embeddedIds).size === embeddedIds.length, `${label}.sources contains duplicate source IDs`);
    if (!legacySchema) recipe.sources.forEach((source, sourceIndex) => {
      assertOnlyKeys(source, RECIPE_SOURCE_KEYS, `${label}.sources[${sourceIndex}]`);
      assert(globalSourceById.has(source.id) && canonicalJson(source) === canonicalJson(globalSourceById.get(source.id)),
        `${label}.sources[${sourceIndex}] must equal the canonical top-level source object`);
    });
    const embeddedSet = new Set(embeddedIds);
    assert(embeddedSet.has(recipe.formulaSourceId), `${label}.formulaSourceId is unresolved`);
    for (const [field, ids] of [
      ["sourceIds", recipe.sourceIds], ["safetySourceIds", recipe.safetySourceIds]
    ]) {
      assert(Array.isArray(ids), `${label}.${field} must be an array`);
      ids.forEach((id) => assert(embeddedSet.has(id), `${label}.${field} contains unresolved id ${id}`));
    }
    assert(isObject(recipe.sourceLocator), `${label}.sourceLocator is required`);
    for (const field of ["page", "section", "recipeTitle"]) assert(isNonEmptyString(recipe.sourceLocator[field]), `${label}.sourceLocator.${field} is required`);
    assert(isObject(recipe.sourceContext) && recipe.sourceContext.diagnosticUse === "forbidden", `${label}.sourceContext must forbid diagnostic use`);
    assert(Array.isArray(recipe.sourceContext.targetAgeGroups) && recipe.sourceContext.targetAgeGroups.length > 0, `${label}.targetAgeGroups are required`);
    assert(isObject(recipe.audience), `${label}.audience is required`);
    assert(recipe.audience.diagnosisConfirmationRequired === true, `${label}.audience must require an explicit diagnosis acknowledgement`);
    assert(recipe.audience.adultOnly === true && typeof recipe.audience.patternRequired === "boolean",
      `${label}.audience must remain adult-only and declare whether professional pattern confirmation is required`);
    if (recipe.audience.patternRequired) {
      assert(targetById.get(recipe.targetId).availability === "withheld_pattern_required",
        `${label} pattern-specific draft must belong to a withheld_pattern_required target`);
      assert(recipe.audience.patternConfirmationPolicy === "professional_confirmation_required" &&
        Array.isArray(recipe.audience.allowedPatterns) && recipe.audience.allowedPatterns.length > 0 &&
        recipe.audience.allowedPatterns.every(isNonEmptyString),
      `${label} pattern-specific draft must retain its source pattern and require professional confirmation`);
    } else {
      assert(!recipe.audience.allowedPatterns || recipe.audience.allowedPatterns.length === 0,
        `${label} non-pattern recipe must not carry an allowedPatterns shortcut`);
    }
    assert(JSON.stringify(recipe.sourceContext.targetAgeGroups) === JSON.stringify(["adult"]), `${label}.targetAgeGroups must be exactly adult in P3`);
    assert(Array.isArray(recipe.audience.allowedTargetConditions) && recipe.audience.allowedTargetConditions.length > 0, `${label}.audience.allowedTargetConditions are required`);

    const bundle = recipe.bundle;
    assert(isObject(bundle), `${label}.bundle is required`);
    assert(bundle.atomic === true && bundle.omissionPolicy === "forbidden" && bundle.substitutionPolicy === "forbidden" &&
      bundle.scalingPolicy === "forbidden" && bundle.orderLocked === true, `${label}.bundle must be atomic and locked`);
    assert(isNonEmptyString(bundle.servingText), `${label}.bundle.servingText is required`);
    assert(Array.isArray(bundle.ingredients) && bundle.ingredients.length > 0, `${label}.bundle.ingredients are required`);
    const lineIds = bundle.ingredients.map((line, lineIndex) => {
      const lineLabel = `${label}.bundle.ingredients[${lineIndex}]`;
      assert(isObject(line) && isNonEmptyString(line.lineId), `${lineLabel}.lineId is required`);
      assert(line.required === true, `${lineLabel} must be required`);
      for (const field of ["sourceName", "sourcePartText", "processingText", "ingredientContentVersion", "ingredientSnapshotDigest", "useRole"]) {
        assert(isNonEmptyString(line[field]), `${lineLabel}.${field} is required`);
      }
      assert(RECIPE_LINE_IDENTITY_REVIEW_STATES.has(line.identityReviewState), `${lineLabel}.identityReviewState is invalid`);
      assert(Array.isArray(line.identitySourceIds), `${lineLabel}.identitySourceIds must be an array`);
      assert(Array.isArray(line.quantitySourceIds) && line.quantitySourceIds.length > 0, `${lineLabel}.quantitySourceIds are required`);
      assert(isObject(line.quantity) && QUANTITY_KINDS.has(line.quantity.kind), `${lineLabel}.quantity.kind is invalid`);
      assert(isNonEmptyString(line.quantity.rawText), `${lineLabel}.quantity.rawText is required`);
      assert(QUANTITY_UNITS.has(line.quantity.unit), `${lineLabel}.quantity.unit is invalid`);
      assert(Array.isArray(line.sourceIds) && line.sourceIds.length > 0, `${lineLabel}.sourceIds are required`);
      line.sourceIds.forEach((id) => assert(embeddedSet.has(id), `${lineLabel}.sourceIds contains unresolved id ${id}`));
      line.identitySourceIds.forEach((id) => assert(embeddedSet.has(id), `${lineLabel}.identitySourceIds contains unresolved id ${id}`));
      line.quantitySourceIds.forEach((id) => assert(embeddedSet.has(id), `${lineLabel}.quantitySourceIds contains unresolved id ${id}`));
      assert(Array.isArray(line.allergenKeys), `${lineLabel}.allergenKeys must be an array`);
      const lineRegistry = legacySchema ? (line.ingredientRegistry || "official_catalog") : line.ingredientRegistry;
      assert(legacySchema ? lineRegistry === "official_catalog" : ["official_catalog", "external_food"].includes(lineRegistry),
        `${lineLabel}.ingredientRegistry is invalid for recipe schema ${recipeData.schemaVersion}`);
      const referencedIngredient = lineRegistry === "external_food"
        ? external.byId.get(line.ingredientId)
        : catalogById.get(line.ingredientId);
      if (isNonEmptyString(line.ingredientId)) {
        assert(referencedIngredient, `${lineLabel}.ingredientId does not resolve in its declared registry`);
        assert(!(catalogById.has(line.ingredientId) && external.byId.has(line.ingredientId)), `${lineLabel}.ingredientId is ambiguous across registries`);
        const expectedContentVersion = lineRegistry === "external_food" ? external.registry.contentVersion : catalog.contentVersion;
        assert(line.ingredientContentVersion === expectedContentVersion, `${lineLabel}.ingredientContentVersion is stale for its declared registry`);
        if (lineRegistry === "external_food") {
          externalLineReferences.push({
            recipeId: recipe.id,
            lineId: line.lineId,
            ingredientId: line.ingredientId,
            formulaSourceId: recipe.formulaSourceId,
            sourceIds: line.sourceIds,
            quantitySourceIds: line.quantitySourceIds
          });
          const materialSourceSet = new Set(referencedIngredient.sources.map((source) => source.id));
          const identitySourceSet = new Set(referencedIngredient.identity.sourceIds);
          const occurrenceSourceSet = new Set(referencedIngredient.occurrenceEvidence.map((evidence) => evidence.sourceId));
          line.identitySourceIds.forEach((id) => assert(materialSourceSet.has(id) && identitySourceSet.has(id) && !occurrenceSourceSet.has(id),
            `${lineLabel}.identitySourceIds is not direct identity evidence for this external food`));
        }
      }
      if (recipe.status === "published") {
        assert(isNonEmptyString(line.ingredientId), `${lineLabel}.ingredientId is required for publication`);
        assert(ingredientReadyForPublishedRecipe(referencedIngredient), `${lineLabel} references an ingredient that is not fully reviewed`);
        assert(line.identityReviewState === "reviewed" && line.identitySourceIds.length > 0, `${lineLabel} identity source has not completed review`);
        assert(line.ingredientSnapshotDigest === expectedRecipeIngredientSnapshotDigest(referencedIngredient, lineRegistry), `${lineLabel}.ingredientSnapshotDigest does not match the current ingredient`);
        assert(!(referencedIngredient.regulatory.restrictionCode === "seasoning_only" && line.useRole !== "seasoning"), `${lineLabel} conflicts with seasoning-only regulation`);
      }
      return line.lineId;
    });
    assert(new Set(lineIds).size === lineIds.length, `${label} has duplicate line IDs`);
    assert(Array.isArray(bundle.steps) && bundle.steps.length > 0, `${label}.bundle.steps are required`);
    const stepIds = bundle.steps.map((step, stepIndex) => {
      const stepLabel = `${label}.bundle.steps[${stepIndex}]`;
      assert(isObject(step) && isNonEmptyString(step.stepId) && Number.isInteger(step.order) && isNonEmptyString(step.text), `${stepLabel} is invalid`);
      assert(Array.isArray(step.sourceIds) && step.sourceIds.length > 0, `${stepLabel}.sourceIds are required`);
      step.sourceIds.forEach((id) => assert(embeddedSet.has(id), `${stepLabel}.sourceIds contains unresolved id ${id}`));
      return step.stepId;
    });
    assert(new Set(stepIds).size === stepIds.length, `${label} has duplicate step IDs`);

    const recipeSafety = recipe.safety;
    assert(isObject(recipeSafety), `${label}.safety is required`);
    for (const field of POPULATION_FIELDS) assert(SAFETY_VALUES.has(recipeSafety[field]), `${label}.safety.${field} is invalid`);
    for (const field of ["sourceIds", "populationSourceIds", "allergenKeys", "allergenSourceIds", "avoidConditions", "cautionConditions",
      "conditionSourceIds", "drugInteractions", "medicationCautions", "interactionSourceIds", "preparationBlocks", "preparationWarnings", "preparationSourceIds"]) {
      assert(Array.isArray(recipeSafety[field]), `${label}.safety.${field} must be an array`);
      if (field.endsWith("SourceIds") || field === "sourceIds") recipeSafety[field].forEach((id) => assert(embeddedSet.has(id), `${label}.safety.${field} contains unresolved id ${id}`));
    }
    for (const field of ["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"]) {
      assert(SAFETY_REVIEW_STATES.has(recipeSafety[field]), `${label}.safety.${field} is invalid`);
    }

    const audit = recipe.audit;
    assert(isObject(audit) && SOURCE_CHECK_STATES.has(audit.sourceCheckState), `${label}.audit.sourceCheckState is invalid`);
    if (audit.sourceCheckState === "checked") checkDate(audit.sourceCheckedAt, `${label}.audit.sourceCheckedAt`);
    REQUIRED_RECIPE_REVIEWS.forEach((field) => assert(RECIPE_REVIEW_STATES.has(audit[field]), `${label}.audit.${field} is invalid`));
    assert(Array.isArray(audit.reviews), `${label}.audit.reviews must be an array`);

    if (recipe.status === "published") {
      assert(recipe.publicVisibility === "published", `${label} published recipe must be publicly visible`);
      assert(targetById.get(recipe.targetId).availability === "reference_available", `${label} published recipe target must be reference_available`);
      assert(recipe.audience.patternRequired === false, `${label} pattern-specific recipe cannot publish without a professional pattern-confirmation workflow`);
      assert(embeddedIds.every((id) => globalSourceSet.has(id)), `${label} embeds a source missing from the global source table`);
      const embeddedPublishedSet = new Set(recipe.sources.filter((source) => source.status === "published").map((source) => source.id));
      const publishedCitationGroups = [recipe.sourceIds, recipe.safetySourceIds,
        recipeSafety.sourceIds, recipeSafety.populationSourceIds, recipeSafety.allergenSourceIds,
        recipeSafety.conditionSourceIds, recipeSafety.interactionSourceIds, recipeSafety.preparationSourceIds];
      bundle.ingredients.forEach((line) => publishedCitationGroups.push(line.sourceIds, line.identitySourceIds, line.quantitySourceIds));
      bundle.steps.forEach((step) => publishedCitationGroups.push(step.sourceIds));
      assert(publishedCitationGroups.every((ids) => ids.every((id) => embeddedPublishedSet.has(id))), `${label} cites a source that is not currently published`);
      assert(REQUIRED_RECIPE_REVIEWS.every((field) => audit[field] === "reviewed"), `${label} is missing a required professional review`);
      assert(["allergenReviewState", "conditionReviewState", "interactionReviewState", "preparationReviewState"]
        .every((field) => recipeSafety[field] === "reviewed"), `${label} is missing a reviewed whole-recipe safety domain`);
      for (const field of [
        "sourceIds", "populationSourceIds", "allergenSourceIds", "conditionSourceIds", "interactionSourceIds", "preparationSourceIds"
      ]) assert(recipeSafety[field].length > 0, `${label}.safety.${field} is required after whole-recipe safety review`);
      checkDate(audit.finalApprovedAt, `${label}.audit.finalApprovedAt`);
      checkDate(audit.nextReviewAt, `${label}.audit.nextReviewAt`);
      const finalApprovedAt = Date.parse(audit.finalApprovedAt);
      const nextReviewAt = Date.parse(audit.nextReviewAt);
      assert(finalApprovedAt <= Date.now(), `${label}.audit.finalApprovedAt cannot be in the future`);
      assert(nextReviewAt > finalApprovedAt && nextReviewAt > Date.now(), `${label}.audit.nextReviewAt must be in the future and after final approval`);
      const requiredReviewRecords = [];
      for (const role of REQUIRED_RECIPE_REVIEW_ROLES) {
        const review = audit.reviews.find((item) => item && item.role === role && item.state === "reviewed");
        assert(review && isNonEmptyString(review.reviewId), `${label} is missing a completed ${role} review record`);
        checkDate(review.reviewedAt, `${label}.audit.reviews.${role}.reviewedAt`);
        assert(Date.parse(review.reviewedAt) <= finalApprovedAt && Date.parse(review.reviewedAt) <= Date.now(), `${label} ${role} review date is later than approval/current time`);
        assert(review.contentVersion === recipe.contentVersion, `${label} ${role} review is stale`);
        assert(review.rulesVersion === recipe.rulesVersion, `${label} ${role} review is bound to a stale rules version`);
        assert(review.bundleDigest === bundle.bundleDigest, `${label} ${role} review is not bound to the current bundle digest`);
        assert(review.sourceTextDigest === bundle.sourceTextDigest, `${label} ${role} review is not bound to the current source-text digest`);
        requiredReviewRecords.push(review);
      }
      assert(new Set(requiredReviewRecords.map((review) => review.reviewId)).size === requiredReviewRecords.length, `${label} required reviews must use independent review IDs`);
      assert(bundle.sourceTextDigest === expectedRecipeSourceTextDigest(recipe), `${label}.bundle.sourceTextDigest does not match source-derived content`);
      assert(bundle.bundleDigest === expectedRecipeBundleDigest(recipe), `${label}.bundleDigest does not match the locked bundle`);
    } else {
      assert(recipe.publicVisibility === "withheld", `${label} non-published recipe must remain withheld`);
    }
    return recipe.id;
  });
  assert(new Set(recipeIds).size === recipeIds.length, "Duplicate recipe id");
  if (legacySchema) {
    return { recipeCount: recipeData.recipes.length, publishableCount: 0, schemaVersion: recipeData.schemaVersion };
  }
  const externalReferenceIds = new Set(externalLineReferences.map((reference) => reference.ingredientId));
  assert(externalReferenceIds.size === external.registry.items.length && external.registry.items.every((food) => externalReferenceIds.has(food.id)),
    "externalFoods must contain exactly the records referenced by private recipe lines");
  const externalReferenceKeys = externalLineReferences.map((reference) =>
    `${reference.ingredientId}|${reference.recipeId}|${reference.lineId}`);
  assert(new Set(externalReferenceKeys).size === externalReferenceKeys.length,
    "External recipe lines must use unique foodId|recipeId|lineId bindings");
  const externalReferenceByKey = new Map(externalLineReferences.map((reference) => [
    `${reference.ingredientId}|${reference.recipeId}|${reference.lineId}`,
    reference
  ]));
  const occurrenceEvidenceEntries = [];
  external.registry.items.forEach((food) => food.occurrenceEvidence.forEach((evidence) => {
    const key = `${food.id}|${evidence.recipeId}|${evidence.lineId}`;
    occurrenceEvidenceEntries.push({ key, food, evidence });
  }));
  const occurrenceEvidenceKeys = occurrenceEvidenceEntries.map((entry) => entry.key);
  assert(new Set(occurrenceEvidenceKeys).size === occurrenceEvidenceKeys.length,
    "externalFoods occurrenceEvidence must use unique foodId|recipeId|lineId bindings");
  assert(occurrenceEvidenceKeys.length === externalReferenceKeys.length &&
    occurrenceEvidenceKeys.every((key) => externalReferenceByKey.has(key)),
  "External recipe lines and occurrenceEvidence must have exactly matching foodId|recipeId|lineId bindings");
  occurrenceEvidenceEntries.forEach(({ key, food, evidence }) => {
    const reference = externalReferenceByKey.get(key);
    assert(reference && evidence.sourceId === reference.formulaSourceId &&
      reference.sourceIds.includes(evidence.sourceId) && reference.quantitySourceIds.includes(evidence.sourceId),
    `${food.id} occurrenceEvidence source must equal the recipe formula source and be cited by both line sourceIds and quantitySourceIds`);
  });

  const recipeSafetyEngine = require(path.join(ROOT, "utils", "recipe-safety.js"));
  assert(typeof recipeSafetyEngine.getPublishableRecipes === "function", "recipe-safety.js must export getPublishableRecipes");
  assert(recipeSafetyEngine.rulesVersion === ruleSet.contentVersion, "recipe-safety.js runtime rulesVersion drifted from data/rule-set.js");
  const publishableCount = recipeSafetyEngine.getPublishableRecipes(
    recipeData.recipes, catalog.ingredients, recipeData.targets, recipeData.externalFoods, recipeData.sources
  ).length;
  assert(publishableCount === recipeData.recipes.filter((recipe) => recipe.status === "published").length, "Published recipe status drifted from runtime release gates");
  return { recipeCount: recipeData.recipes.length, publishableCount };
}

function checkPublicRecipeData(publicData, reviewData, catalog) {
  assert(isObject(publicData), "Public recipe index must export an object");
  assert(RECIPE_SCHEMA_VERSIONS.has(publicData.schemaVersion), `Unsupported public recipe schemaVersion ${publicData.schemaVersion}`);
  assert(publicData.schemaVersion === reviewData.schemaVersion, "Public recipe schemaVersion drifted from review data");
  assert(publicData.contentVersion === reviewData.contentVersion, "Public recipe contentVersion drifted from review data");
  assert(publicData.publishedAt === reviewData.publishedAt, "Public recipe publishedAt drifted from review data");
  const legacySchema = publicData.schemaVersion === "1.0.0";
  if (legacySchema) {
    assert(LEGACY_RECIPE_CONTENT_VERSIONS.has(publicData.contentVersion),
      `Legacy public recipe schema is not registered for contentVersion ${publicData.contentVersion}`);
    assert(!Object.prototype.hasOwnProperty.call(publicData, "externalFoods") &&
      !Object.prototype.hasOwnProperty.call(reviewData, "externalFoods"),
    "Legacy recipe snapshots must not contain an externalFoods registry");
  } else {
    assert(isObject(publicData.externalFoods) && Array.isArray(publicData.externalFoods.items), "Public externalFoods registry is required");
    assert(EXTERNAL_FOOD_SCHEMA_VERSIONS.has(publicData.externalFoods.schemaVersion),
      `Unsupported public externalFoods schemaVersion ${publicData.externalFoods.schemaVersion}`);
    assert(publicData.externalFoods.schemaVersion === reviewData.externalFoods.schemaVersion &&
      publicData.externalFoods.contentVersion === reviewData.externalFoods.contentVersion &&
      publicData.externalFoods.publishedAt === reviewData.externalFoods.publishedAt,
    "Public externalFoods registry version drifted from review data");
    assert(publicData.externalFoods.count === publicData.externalFoods.items.length, "Public externalFoods count is invalid");
  }
  assert(Array.isArray(publicData.recipes) && publicData.count === publicData.recipes.length, "Public recipe count is invalid");
  assert(publicData.count === reviewData.count, "Public recipe index lost a review record");
  assert(Array.isArray(publicData.sources) && canonicalJson(publicData.sources) === canonicalJson(reviewData.sources),
    "Public recipe sources drifted from review data");
  assert(Array.isArray(publicData.targets) && canonicalJson(publicData.targets) === canonicalJson(reviewData.targets),
    "Public recipe targets drifted from review data");
  if (!legacySchema) {
    const expectedPublicData = require(path.join(ROOT, "tools", "build-public-recipes.js")).buildPublicData(reviewData, catalog);
    assert(JSON.stringify(publicData) === JSON.stringify(expectedPublicData), "Public recipe index is stale; run npm run build:recipes");
  }
  assert(JSON.stringify(publicData.targets.map((item) => [item.id, item.availability])) ===
    JSON.stringify(reviewData.targets.map((item) => [item.id, item.availability])), "Public recipe target states drifted from review data");

  const reviewById = new Map(reviewData.recipes.map((recipe) => [recipe.id, recipe]));
  assert(reviewById.size === reviewData.recipes.length, "Review recipe index contains duplicate IDs");
  const publicRecipeIds = publicData.recipes.map((recipe) => recipe && recipe.id);
  assert(new Set(publicRecipeIds).size === publicRecipeIds.length &&
    publicRecipeIds.every((id) => reviewById.has(id)), "Public recipe IDs are duplicated or incomplete");
  if (legacySchema) {
    assert(reviewData.recipes.every((recipe) => recipe.status !== "published" && recipe.publicVisibility === "withheld") &&
      publicData.recipes.every((recipe) => recipe.status !== "published" && recipe.publicVisibility === "withheld"),
    "Legacy recipe snapshots are documentation-only and must contain zero published recipes");
  }
  for (const publicRecipe of publicData.recipes) {
    const reviewRecipe = reviewById.get(publicRecipe.id);
    assert(reviewRecipe, `Public recipe ${publicRecipe.id} has no review record`);
    for (const field of ["revision", "name", "status", "contentVersion", "targetId", "publicVisibility", "formulaSourceId"]) {
      assert(publicRecipe[field] === reviewRecipe[field], `Public recipe ${publicRecipe.id}.${field} drifted from review record`);
    }
    if (publicRecipe.status === "published") {
      assert(publicRecipe.bundle && Array.isArray(publicRecipe.bundle.ingredients) && publicRecipe.bundle.ingredients.length > 0,
        `Published public recipe ${publicRecipe.id} is missing its approved bundle`);
    } else {
      const serialized = JSON.stringify(publicRecipe);
      assert(publicRecipe.publicVisibility === "withheld", `Unpublished public recipe ${publicRecipe.id} must remain withheld`);
      assert(!publicRecipe.bundle || !Array.isArray(publicRecipe.bundle.ingredients) || publicRecipe.bundle.ingredients.length === 0,
        `Unpublished public recipe ${publicRecipe.id} leaked material rows`);
      assert(!publicRecipe.bundle || !Array.isArray(publicRecipe.bundle.steps) || publicRecipe.bundle.steps.length === 0,
        `Unpublished public recipe ${publicRecipe.id} leaked preparation steps`);
      for (const forbidden of ["quantity", "rawText", "servingText", "frequencyText", "courseText", "processingText"]) {
        assert(!serialized.includes(`\"${forbidden}\"`), `Unpublished public recipe ${publicRecipe.id} leaked ${forbidden}`);
      }
    }
  }

  if (legacySchema) return { recipeCount: publicData.count, publishableCount: 0, schemaVersion: publicData.schemaVersion };

  const publishedExternalIds = new Set();
  publicData.recipes.filter((recipe) => recipe.status === "published").forEach((recipe) =>
    (recipe.bundle && recipe.bundle.ingredients || []).forEach((line) => {
      if (line.ingredientRegistry === "external_food") publishedExternalIds.add(line.ingredientId);
    }));
  assert(publicData.externalFoods.items.every((food) => publishedExternalIds.has(food.id)), "Public package contains an external food not referenced by a published recipe");
  assert(publishedExternalIds.size === publicData.externalFoods.items.length &&
    [...publishedExternalIds].every((id) => publicData.externalFoods.items.some((food) => food.id === id)),
  "Public package omitted or duplicated an external food required by a published recipe");
  assert(publicData.externalFoods.items.every((food) => food.audit && food.audit.professionalReviewState === "reviewed"),
    "Public package contains a pending external food");

  const recipeSafetyEngine = require(path.join(ROOT, "utils", "recipe-safety.js"));
  const publicPublishable = recipeSafetyEngine.getPublishableRecipes(
    publicData.recipes, catalog.ingredients, publicData.targets, publicData.externalFoods, publicData.sources
  ).length;
  const reviewPublished = reviewData.recipes.filter((recipe) => recipe.status === "published").length;
  assert(publicPublishable === reviewPublished, "Public recipe release state drifted from reviewed publication state");
  return { recipeCount: publicData.count, publishableCount: publicPublishable };
}

function checkSafetyEngine(ingredients, ruleSet) {
  const safetyFile = path.join(ROOT, "utils", "safety.js");
  assert(fs.existsSync(safetyFile), "Missing utils/safety.js");
  let safetyEngine;
  try {
    delete require.cache[require.resolve(safetyFile)];
    safetyEngine = require(safetyFile);
  } catch (error) {
    throw new Error(`Unable to load utils/safety.js: ${error.message}`);
  }

  assert(typeof safetyEngine.normalizeProfile === "function", "safety.js must export normalizeProfile");
  assert(typeof safetyEngine.evaluateIngredient === "function", "safety.js must export evaluateIngredient");
  assert(typeof safetyEngine.evaluateCatalog === "function", "safety.js must export evaluateCatalog");
  assert(safetyEngine.rulesVersion === ruleSet.contentVersion, "safety.js runtime rulesVersion drifted from data/rule-set.js");

  const emptyProfile = safetyEngine.normalizeProfile({});
  assert(emptyProfile.pregnancy === "unknown", "Missing pregnancy input must remain unknown");
  assert(emptyProfile.breastfeeding === "unknown", "Missing breastfeeding input must remain unknown");
  assert(emptyProfile.allergyStatus === "unknown", "Missing allergy input must remain unknown");
  assert(emptyProfile.conditionStatus === "unknown", "Missing condition input must remain unknown");
  assert(emptyProfile.medicationStatus === "unknown", "Missing medication input must remain unknown");

  const results = safetyEngine.evaluateCatalog(ingredients, {});
  assert(Array.isArray(results) && results.length === ingredients.length, "Safety catalog evaluation lost records");
  for (const result of results) {
    assert(isObject(result), "Safety evaluation must return result objects");
    assert(typeof result.blocked === "boolean", "Safety result blocked must be boolean");
    assert(Array.isArray(result.reasons), "Safety result reasons must be an array");
    assert(Array.isArray(result.warnings), "Safety result warnings must be an array");
  }

  const first = ingredients[0];
  const redFlagResult = safetyEngine.evaluateIngredient(first, { redFlags: ["紧急情况测试"] });
  assert(redFlagResult.blocked, "A red flag must stop ingredient selection");
  assert(redFlagResult.reasonCodes.includes("red_flag"), "Red-flag result must explain the blocking rule");

  const pregnancyUnknown = safetyEngine.evaluateIngredient(
    { ...first, safety: { ...first.safety, pregnancy: "unknown" } },
    { pregnancy: "yes" }
  );
  assert(
    pregnancyUnknown.warningCodes.includes("pregnancy_unknown"),
    "Unknown pregnancy safety must produce an explicit warning"
  );

  const pregnancyNo = safetyEngine.evaluateIngredient(
    {
      ...first,
      safety: {
        ...first.safety,
        pregnancy: "no",
        sourceIds: [first.sources.find((source) => source.status === "published").id]
      }
    },
    { pregnancy: "yes" }
  );
  assert(pregnancyNo.blocked, "A source-backed pregnancy=no rule must block selection");
  assert(
    pregnancyNo.reasonCodes.includes("pregnancy_not_suitable"),
    "Pregnancy block must explain the rule"
  );
}

function isNegated(source, start) {
  const prefix = source.slice(Math.max(0, start - 18), start);
  return /(?:不|非|未|无意|禁止|不得|不能|不会|并非|拒绝|避免|停止|严禁)(?:提供|用于|进行|支持|生成|输出|代表|等同于|宣称|把|将)?[^。！？\n]{0,16}$/.test(prefix);
}

function checkForbiddenCopy(file) {
  const source = readText(file);
  const rules = [
    {
      name: "疗效或绝对安全承诺",
      pattern: /治愈|根治|药到病除|包治|保证(?:有效|疗效)|百分百有效|快速见效|立刻见效|绝对安全|无副作用|人人适用/g
    },
    {
      name: "自动诊断或处方能力",
      pattern: /自动(?:诊断|辨证|开方|配方)|智能(?:诊断|辨证|开方|配方)|一键(?:开方|配方|合方)|生成(?:处方|方剂|药方)|开具处方|推荐方剂|药方推荐|(?:专属|个人|你的|您的)(?:药方|处方|方剂)|给(?:你|您|用户)开方/g
    },
    {
      name: "自由配伍或合煎指令",
      pattern: /(?:自由|自行|随意)(?:配伍|组合)|自动(?:配伍|组合材料)|智能配伍|加入药锅|一起(?:煎|煮|泡|服)|推荐搭配/g
    },
    {
      name: "治疗或诊断结论",
      pattern: /可(?:以)?(?:用于)?治疗|专治|确诊为|(?:诊断|辨证)(?:结果|结论)|你(?:的)?(?:是|属于|患有).{0,10}(?:证|病)/g
    },
    {
      name: "食品功效或疾病改善声称",
      pattern: /治疗(?:失眠|疼痛|炎症|肿瘤|癌症|高血压|糖尿病|高脂血症|疾病|症状)|预防(?:癌症|中风|感冒|疾病)|降血糖|降血压|降血脂|抗癌|止痛|消炎|改善(?:糖尿病|高血压|高脂血症)|缓解症状/g
    },
    {
      name: "个体剂量或疗程指令",
      pattern: /(?:建议|推荐|应当|请|需要).{0,12}(?:每日|每天|每次).{0,8}\d+(?:\.\d+)?\s*(?:克|g|毫升|ml|片|粒)|连续\s*\d+\s*(?:天|周|月)(?:为一疗程)?/gi
    }
  ];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      if (isNegated(source, match.index)) continue;
      const relative = path.relative(ROOT, file);
      throw new Error(`${rule.name} found in ${relative}: ${JSON.stringify(match[0])}`);
    }
  }
}

function checkNonMedicalRuntimeBoundary(file, candidateSource) {
  const source = candidateSource === undefined ? readText(file) : candidateSource;
  const relative = path.relative(ROOT, file);
  const prohibited = [
    [/\bwx\s*(?:\.\s*getClipboardData\b|\[\s*["']getClipboardData["']\s*\])/, "clipboard reading"],
    [/\bwx\s*(?:\.\s*(?:login|getUserProfile|getUserInfo|requestPayment|uploadFile|downloadFile|cloud)\b|\[\s*["'](?:login|getUserProfile|getUserInfo|requestPayment|uploadFile|downloadFile|cloud)["']\s*\])/, "account, upload, payment or cloud API"],
    [/open-type\s*=\s*["']getPhoneNumber["']|\bgetPhoneNumber\b/, "phone-number authorization"],
    [/"(?:cloudfunctionRoot|cloudfunctionsRoot|requiredPrivateInfos|permission)"\s*:/, "cloud or private-information project capability"]
  ];
  prohibited.forEach(([pattern, label]) => {
    assert(!pattern.test(source), `${relative} introduces ${label}; this non-medical product requires a separate privacy and capability review`);
  });
  if (/\bwx\s*(?:\.\s*setClipboardData\b|\[\s*["']setClipboardData["']\s*\])/.test(source)) {
    assert(relativePosix(file) === "utils/clipboard.js", `${relative} may not bypass the user-initiated clipboard adapter`);
    assert((source.match(/wx\.setClipboardData\s*\(/g) || []).length === 1, "Clipboard adapter must have exactly one system write call");
  }
  if (/\bwx\s*(?:\.\s*request\b|\[\s*["']request["']\s*\])/.test(source)) {
    assert(relativePosix(file) === "utils/public-catalog.js", `${relative} may not make network requests; use the public-catalog adapter`);
    assert((source.match(/wx\.request\s*\(/g) || []).length === 1 && source.includes("return wx.request(options);"),
      "Public adapter must have exactly one audited request call");
    assert(!/\bgetApp\s*\(|\b(?:getStorageSync|setStorageSync)\b|require\(["'][^"']*(?:storage|privacy|session-profile)["']\)/.test(source),
      "Public adapter must not read health sessions or persistent user data");
    assert(source.includes('method: "GET"') && source.includes('url: baseUrl + REQUEST_PATH') &&
      source.includes('const REQUEST_PATH = "/api/v1/public/catalog";') && source.includes('header: { Accept: "application/json" }'),
    "Public adapter request contract drifted");
  }
}

function main() {
  checkRuntimeJsonProjections();
  const requiredRootFiles = [
    "app.js", "app.json", "app.wxss", "project.config.json", "sitemap.json", "README.md", "package.json",
    "data/version-manifest.json", "data/version-notices.json", "data/version-active.json"
  ];
  for (const relative of [...requiredRootFiles, ...EXPECTED_DOCS]) {
    const file = path.join(ROOT, relative);
    assert(fs.existsSync(file), `Missing ${relative}`);
    assert(fs.statSync(file).size > 0, `Empty ${relative}`);
  }

  const appConfig = readJson(path.join(ROOT, "app.json"));
  const registeredPages = checkAppPackageConfig(appConfig);
  for (const page of EXPECTED_PAGES) {
    for (const extension of PAGE_EXTENSIONS) {
      const file = path.join(ROOT, `${page}.${extension}`);
      assert(fs.existsSync(file), `Missing ${page}.${extension}`);
      if (extension === "json") checkComponentReferences(file, readJson(file));
      if (extension === "wxml") checkWxml(file);
      if (extension === "wxss") checkWxss(file);
    }
  }

  const projectConfig = readJson(path.join(ROOT, "project.config.json"));
  checkDeveloperToolsConfig(projectConfig, registeredPages);
  checkUploadIgnoreBoundary(projectConfig);
  readJson(path.join(ROOT, "sitemap.json"));
  const packageConfig = readJson(path.join(ROOT, "package.json"));
  assert(packageConfig.scripts && packageConfig.scripts["build:recipes"] === "node tools/build-public-recipes.js",
    "package.json build:recipes script drifted");
  assert(packageConfig.scripts && packageConfig.scripts["build:media-drafts"] ===
    "node tools/build-media-draft-manifest.js && node tools/build-media-review.js && node tools/build-specimen-candidate-manifest.js && node tools/build-specimen-review.js && node tools/build-food-form-candidate-manifest.js && node tools/build-food-form-review.js && node tools/build-food-form-gap-research-manifest.js && node tools/build-food-form-gap-research-review.js",
  "package.json build:media-drafts must rebuild all private media manifests and review galleries");
  assert(packageConfig.scripts && packageConfig.scripts["build:evidence-drafts"] ===
    "node tools/build-external-food-source-candidate-manifest.js && node tools/build-external-food-source-review.js",
  "package.json build:evidence-drafts must rebuild the private external-food source review package");
  assert(packageConfig.scripts && packageConfig.scripts["build:professional-review"] ===
    "node tools/version-verify.js && node tools/build-professional-review-packet.js && node tools/build-professional-review.js && node tools/validate-professional-review.js",
  "package.json build:professional-review must verify the active release and rebuild/validate the private advisory review packet");
  assert(packageConfig.scripts && packageConfig.scripts["build:professional-review:first-release"] ===
    "node tools/version-verify.js && node tools/build-professional-review-packet.js --profile first-release-black-bean && node tools/build-professional-review.js --profile first-release-black-bean && node tools/validate-professional-review.js --profile first-release-black-bean",
  "package.json first-release review build must use only the closed registered scoped profile");
  assert(packageConfig.scripts && packageConfig.scripts["build:release"] === "node tools/version-build.js",
    "package.json build:release must use the fail-closed version builder");
  assert(packageConfig.scripts && packageConfig.scripts.check ===
    "node tools/version-verify.js && node tools/check-project.js && node tools/check-media-drafts.js && node tools/check-specimen-candidates.js && node tools/check-food-form-candidates.js && node tools/check-food-form-gap-research.js && node tools/check-research-refresh.js && node tools/check-external-food-source-candidates.js && node tools/check-professional-review.js",
  "package.json check must verify the active release, project, private media and source-evidence boundaries");
  assert(packageConfig.scripts && packageConfig.scripts.test ===
    "node tools/test-safety.js && node tools/test-search.js && node tools/test-compare.js && node tools/test-recipes.js && node tools/test-privacy.js && node tools/test-storage.js && node tools/test-navigation.js && node tools/test-clipboard.js && node tools/test-detail-page.js && node tools/test-list-actions.js && node tools/test-entry-actions.js && node tools/test-privacy-page.js && node tools/test-public-catalog.js && node tools/test-catalog-read-lifecycle.js && node tools/test-device-preflight.js && node tools/smoke-pages.js && node tools/test-media-drafts.js && node tools/test-specimen-candidates.js && node tools/test-food-form-candidates.js && node tools/test-food-form-gap-research.js && node tools/test-research-refresh.js && node tools/test-external-food-source-candidates.js && node tools/test-professional-review.js && node tools/test-professional-review-scoped.js && node tools/test-professional-review-legacy.js && node tools/version-test.js",
  "package.json test must retain the complete safety, search, page, privacy, storage, navigation, detail recovery, private-evidence and version mutation suites");
  assert(packageConfig.scripts["preflight:device"] === "node tools/device-preflight.js",
    "Device preparation entry must remain read-only and separate from upload or deployment");

  const publicConfig = readJson(path.join(ROOT, "config/public-api.json"));
  assert(isObject(publicConfig) && Object.keys(publicConfig).length === 1 && typeof publicConfig.baseUrl === "string",
    "Public API configuration must contain only baseUrl");
  assert(publicConfig.baseUrl === "" || require("../utils/public-catalog").validBaseUrl(publicConfig),
    "Public API baseUrl must be empty or an explicit HTTPS origin");

  const componentRoot = path.join(ROOT, "components");
  if (fs.existsSync(componentRoot)) {
    for (const file of walk(componentRoot)) {
      if (file.endsWith(".json")) checkComponentReferences(file, readJson(file));
      if (file.endsWith(".wxml")) checkWxml(file);
      if (file.endsWith(".wxss")) checkWxss(file);
    }
  }

  const catalog = loadCatalog();
  assert(isObject(catalog), "Ingredient catalog must export an object");
  assert(isNonEmptyString(catalog.schemaVersion), "Catalog schemaVersion is required");
  assert(isNonEmptyString(catalog.contentVersion), "Catalog contentVersion is required");
  checkDate(catalog.publishedAt, "Catalog publishedAt");
  assert(Array.isArray(catalog.ingredients), "Catalog ingredients must be an array");
  assert(catalog.ingredients.length > 0, "Catalog must contain at least one reviewed seed ingredient");
  assert(Number.isInteger(catalog.count), "Catalog count must be an integer");
  assert(catalog.count === catalog.ingredients.length, "Catalog count must equal ingredients.length");
  assert(isObject(catalog.catalogCoverage), "Catalog coverage metadata is required");
  checkDate(catalog.catalogCoverage.asOf, "Catalog coverage asOf");
  assert(catalog.catalogCoverage.officialCount === catalog.ingredients.length, "Catalog coverage count does not match the versioned dataset");
  assert(Array.isArray(catalog.catalogCoverage.batches) && catalog.catalogCoverage.batches.length === 4, "Catalog coverage must preserve four official batches");
  assert(
    catalog.catalogCoverage.batches.reduce((sum, batch) => sum + batch.count, 0) === catalog.catalogCoverage.officialCount,
    "Catalog coverage batch counts do not add up"
  );
  catalog.catalogCoverage.batches.forEach((batch, batchIndex) => {
    assert(isObject(batch) && isNonEmptyString(batch.id) && isNonEmptyString(batch.sourceId), `Catalog coverage batch ${batchIndex} is invalid`);
    const actual = catalog.ingredients.filter((ingredient) =>
      Array.isArray(ingredient.sources) && ingredient.sources.some((source) => source.id === batch.sourceId)
    ).length;
    assert(actual === batch.count, `Catalog coverage batch ${batch.id} expected ${batch.count}, found ${actual}`);
  });
  assert(isNonEmptyString(catalog.catalogCoverage.countConfirmationSourceId), "Catalog count confirmation source is required");
  assert(catalog.ingredients.some((ingredient) => ingredient.sources.some((source) =>
    source.id === catalog.catalogCoverage.countConfirmationSourceId
  )), "Catalog count confirmation source is unresolved");

  const ruleSet = loadRuleSet();
  checkRuleSet(ruleSet);
  const optionSets = checkFilterOptions();
  const ids = catalog.ingredients.map((ingredient, index) => checkIngredient(
    ingredient, index, optionSets, catalog.contentVersion, ruleSet
  ));
  assert(new Set(ids).size === ids.length, "Duplicate ingredient id");
  const reviewRecipeData = loadRecipes();
  checkRecipeData(reviewRecipeData, catalog, ruleSet);
  const recipeStats = checkPublicRecipeData(loadPublicRecipes(), reviewRecipeData, catalog);
  checkTriageEntryPoints();
  checkP3EntryPoints();
  checkSafetyEngine(catalog.ingredients, ruleSet);

  const sourceFiles = walk(ROOT);
  const buyerFacingFiles = sourceFiles.filter((file) => /\.(?:js|json|wxml)$/.test(file) && !UPLOAD_EXCLUDES.has(path.relative(ROOT, file)));
  for (const file of buyerFacingFiles) {
    checkForbiddenCopy(file);
    checkNonMedicalRuntimeBoundary(file);
  }

  const uploadFiles = sourceFiles.filter((file) => !UPLOAD_EXCLUDES.has(path.relative(ROOT, file)));
  assert(!uploadFiles.some((file) => relativePosix(file) === "data/recipes.js"), "Full recipe review data entered the upload set");
  checkRuntimePackageImports(uploadFiles);
  checkRouteReferences(uploadFiles, registeredPages);
  const packageStats = measureUploadPackages(uploadFiles);

  console.log(JSON.stringify({
    pages: EXPECTED_PAGES.length,
    mainPages: MAIN_PAGES.length,
    subpackageCount: EXPECTED_SUBPACKAGES.length,
    ingredients: catalog.ingredients.length,
    recipes: recipeStats.recipeCount,
    publishableRecipes: recipeStats.publishableCount,
    schemaVersion: catalog.schemaVersion,
    contentVersion: catalog.contentVersion,
    rulesVersion: ruleSet.contentVersion,
    buyerFacingFilesChecked: buyerFacingFiles.length,
    uploadFiles: uploadFiles.length,
    uploadSourceBytes: packageStats.totalBytes,
    mainPackageSourceBytes: packageStats.main.bytes,
    wifiPreloadSourceBytes: packageStats.preloadBytes,
    subpackageSourceBytes: Object.fromEntries(
      Object.entries(packageStats.subpackages).map(([root, stat]) => [root, stat.bytes])
    ),
    assertions: "passed"
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[check-project] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  renderRuntimeProjection,
  checkRuntimeJsonProjections,
  walk,
  checkUploadIgnoreBoundary,
  checkRuntimePackageImports,
  checkNonMedicalRuntimeBoundary,
  checkExternalFoodRegistry,
  checkPublicRecipeData,
  checkRecipeData,
  main
};
