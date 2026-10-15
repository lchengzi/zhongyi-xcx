import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRoots = [path.join(workspace, 'apps/miniprogram/src'), path.join(workspace, 'packages/catalog-core/src')];
const external = /^(react(?:\/jsx-runtime)?|@tarojs\/(taro|components)|@food-education\/catalog-core)$/;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const expectedMainPages = ['pages/catalog/index', 'pages/favorites/index', 'pages/compare/index', 'pages/safety/index', 'pages/about/index'];
const expectedCatalogRoot = 'subpackages/catalog';
const expectedDetailPage = 'detail/index';

export function isClientSource(filename) {
  return sourceExtension.test(filename);
}

function sourceKind(filename) {
  if (/\.tsx$/i.test(filename)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filename)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(filename)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function moduleLoader(expression) {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(expression)) return expression.text === 'require';
  if (ts.isPropertyAccessExpression(expression)) {
    return (ts.isIdentifier(expression.expression) && expression.expression.text === 'module' && expression.name.text === 'require')
      || (ts.isIdentifier(expression.expression) && expression.expression.text === 'require' && expression.name.text === 'resolve');
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)) {
    return (ts.isIdentifier(expression.expression) && expression.expression.text === 'module' && expression.argumentExpression.text === 'require')
      || (ts.isIdentifier(expression.expression) && expression.expression.text === 'require' && expression.argumentExpression.text === 'resolve');
  }
  return false;
}

export function validateClientImports(source, filename, roots = clientRoots) {
  const ownerIndex = roots.findIndex(root => inside(root, filename));
  if (ownerIndex === -1) throw new Error('Inspected source is outside the public client roots');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, sourceKind(filename));
  const check = (specifier) => {
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filename), specifier);
      if (!inside(roots[ownerIndex], resolved)) throw new Error(`Client import escapes its public package: ${specifier}`);
    } else if (ownerIndex !== 0 || !external.test(specifier)) throw new Error(`Client dependency is not permitted: ${specifier}`);
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('Nonliteral module specifier');
      check(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.moduleReference.expression || !ts.isStringLiteral(node.moduleReference.expression)) throw new Error('Nonliteral import assignment');
      check(node.moduleReference.expression.text);
    }
    if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteral(node.argument.literal)) throw new Error('Nonliteral import type');
      check(node.argument.literal.text);
    }
    if (ts.isCallExpression(node) && moduleLoader(node.expression)) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('Computed client module loading is not allowed');
      check(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

function walk(root) {
  const rootInfo = fs.lstatSync(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`Expected a real inspected directory: ${root}`);
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in inspected tree: ${filename}`);
    if (entry.isDirectory()) files.push(...walk(filename));
    else if (entry.isFile()) files.push(filename);
    else throw new Error('Unsupported build entry');
  }
  return files;
}

export function inspectSources(roots = clientRoots) {
  let count = 0;
  for (const root of roots) {
    for (const filename of walk(root).filter(isClientSource)) {
      validateClientImports(fs.readFileSync(filename, 'utf8'), filename, roots);
      count++;
    }
  }
  return count;
}

export function validateAppRoutes(app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error('Invalid compiled app configuration');
  if (app.subPackages !== undefined && app.subpackages !== undefined) throw new Error('Duplicate subpackage configuration forms');
  const mainPages = app.pages;
  const subpackages = app.subPackages ?? app.subpackages;
  if (!Array.isArray(mainPages) || mainPages.length !== expectedMainPages.length
    || mainPages.some((page, index) => page !== expectedMainPages[index])) {
    throw new Error('Compiled main routes differ from the approved user flow');
  }
  if (!Array.isArray(subpackages) || subpackages.length !== 1) throw new Error('Expected exactly one catalog subpackage');
  const catalog = subpackages[0];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)
    || catalog.root !== expectedCatalogRoot || !Array.isArray(catalog.pages)
    || catalog.pages.length !== 1 || catalog.pages[0] !== expectedDetailPage) {
    throw new Error('Compiled catalog detail route differs from the phase A user flow');
  }
  return { routes: [...mainPages, `${expectedCatalogRoot}/${expectedDetailPage}`], subpackages };
}

export function validateCompiledEntries(entries, routes) {
  const available = new Map(entries.map(entry => [entry.path, entry.bytes]));
  for (const name of ['app.js', 'app.json', 'app.wxss']) {
    if (!available.has(name)) throw new Error(`Missing compiled application entry: ${name}`);
  }
  if (!Number.isSafeInteger(available.get('app.wxss')) || available.get('app.wxss') <= 0) {
    throw new Error('Compiled global app.wxss must not be empty');
  }
  for (const route of routes) {
    // Taro 4.3 emits the shared styles in app.wxss. Main-page WXSS can be absent
    // and the detail WXSS can be empty; neither indicates a missing page.
    for (const extension of ['.js', '.json', '.wxml']) {
      if (!available.has(`${route}${extension}`)) throw new Error(`Missing compiled page: ${route}${extension}`);
    }
  }
}

/** Inspect the emitted artifact, not the invoking shell's current environment.
 * A configured address is not evidence of ownership, TLS or device success. */
export function validatePublicContentBuild(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'mode,origin,protocolVersion,schemaVersion'
    || value.schemaVersion !== 1 || value.protocolVersion !== 1) throw new Error('Invalid public content build manifest');
  if (value.mode === 'disabled' && value.origin === null) return { ...value };
  if (value.mode !== 'configured' || typeof value.origin !== 'string' || value.origin.length > 253
    || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(value.origin)) throw new Error('Invalid public content build origin');
  let url;
  try { url = new URL(value.origin); } catch { throw new Error('Invalid public content build origin'); }
  const host = url.hostname;
  if (url.origin !== value.origin || !host.includes('.') || /^[0-9.]+$/.test(host)
    || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(host)
    || /(?:^|\.)example\.(?:com|net|org)$/.test(host)) throw new Error('Invalid public content build origin');
  return { ...value };
}

export function inspectPackage(root = path.join(workspace, 'apps/miniprogram/dist')) {
  const sourceFilesChecked = inspectSources();
  const filenames = walk(root);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const { routes, subpackages } = validateAppRoutes(app);
  const publicContentBuild = validatePublicContentBuild(JSON.parse(fs.readFileSync(path.join(root, 'public-content-build.json'), 'utf8')));
  const entries = filenames.map(filename => {
    const relativePath = path.relative(root, filename).replaceAll('\\', '/');
    if (/(^|\/)(content-private|node_modules|server|tools|\.local)(\/|$)|\.(map|ts|tsx|db|sqlite|pem|key)$|(^|\/)\.env/.test(relativePath)) {
      throw new Error(`Nonpublic or source file in mini build: ${relativePath}`);
    }
    const bytes = fs.readFileSync(filename);
    if (/\.(js|json|wxml)$/.test(relativePath) && /OPENAI_API_KEY|AI_EXTERNAL_ENABLED|reviewer-registry|qualificationHistory|api\.openai\.com/.test(bytes.toString('utf8'))) {
      throw new Error(`Unexpected server/private reference in compiled file: ${relativePath}`);
    }
    return { path: relativePath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  validateCompiledEntries(entries, routes);
  const groups = [{ name: 'main', bytes: 0 }, ...subpackages.map(item => ({ name: item.root, bytes: 0 }))];
  for (const file of entries) {
    const group = groups.slice(1).find(item => file.path.startsWith(`${item.name}/`)) || groups[0];
    group.bytes += file.bytes;
  }
  for (const group of groups) if (group.bytes > 2 * 1024 * 1024) throw new Error(`Build exceeds the project's conservative 2 MiB package budget: ${group.name}`);
  return {
    schemaVersion: 1, recordedAt: new Date().toISOString(), status: 'passed',
    scope: 'local_compiled_structure_size_and_static_source_import_checks',
    detectionCoverage: {
      sourceExtensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
      checks: ['declared imports/exports', 'literal import and require calls', 'app routes and required files',
        'forbidden artifact names', 'selected server/private text markers', 'per-package byte budget'],
      limitations: ['not a complete private-content or credential detector',
        'stylesheet imports/URLs and renamed binary assets are not origin-verified',
        'aliased loaders, build plugins and transitive installed dependencies are not fully traced',
        'does not establish that artifacts were produced from the current source in this invocation'],
      completePrivacyAudit: false,
      pageStylePolicy: 'page WXSS optional; nonempty global app.wxss required'
    },
    sourceFilesChecked, pages: routes, packages: groups, publicContentBuild,
    totalCompiledBytes: entries.reduce((sum, item) => sum + item.bytes, 0), files: entries,
    wechatCompiledPackageSize: null,
    actualWeChatRuntimeVerified: false, actualDeviceVerified: false
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectPackage();
  const directory = path.join(workspace, '.refactor/reports');
  fs.mkdirSync(directory, { recursive: true });
  const reportPath = path.join(directory, `mini-build-${crypto.randomUUID()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, reportPath, sourceFilesChecked: report.sourceFilesChecked, pages: report.pages, packages: report.packages, totalCompiledBytes: report.totalCompiledBytes }, null, 2));
}
