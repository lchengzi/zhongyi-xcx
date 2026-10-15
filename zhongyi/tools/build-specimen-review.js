'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateManifest } = require('./specimen-candidate-core');

const projectRoot = path.resolve(__dirname, '..');
const candidateRoot = path.join(projectRoot, 'content-private', 'media-candidates', 'specimens');
const manifestPath = path.join(candidateRoot, 'manifest.json');
const outputPath = path.join(candidateRoot, 'review-index.html');

function fail(message) {
  throw new Error(`[specimen-review] ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function requiredString(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label} must be a non-empty string`);
  return value.trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${path.relative(projectRoot, manifestPath)}; no review page was generated`);
  }

  let raw;
  let manifest;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (error) {
    fail(`cannot read manifest.json: ${error.message}`);
  }

  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'manifest root must be an object');
  validateManifest(manifest, projectRoot);
  const records = Array.isArray(manifest.records)
    ? manifest.records
    : (Array.isArray(manifest.candidates) ? manifest.candidates : null);
  assert(records, 'manifest must contain a records or candidates array');
  if (manifest.count !== undefined) {
    assert(Number.isInteger(manifest.count) && manifest.count === records.length, 'manifest count does not match records');
  }
  if (manifest.scope !== undefined) {
    const scope = requiredString(manifest.scope, 'manifest.scope').toLowerCase();
    assert(scope.includes('private') && !scope.includes('public'), 'manifest scope must remain private');
  }
  if (manifest.policy !== undefined) {
    assert(manifest.policy && typeof manifest.policy === 'object' && !Array.isArray(manifest.policy), 'manifest policy must be an object');
    assert(manifest.policy.clientUploadAllowed === false, 'client upload must be explicitly prohibited');
    assert(manifest.policy.runtimeReferenceAllowed === false, 'runtime references must be explicitly prohibited');
    assert(manifest.policy.identificationUse === 'prohibited', 'identification use must be prohibited');
    assert(manifest.policy.medicalUse === 'prohibited', 'medical use must be prohibited');
  }

  return {
    digest: crypto.createHash('sha256').update(raw).digest('hex'),
    manifest,
    records,
  };
}

function normalizeDisplayValue(value) {
  if (value === null || value === undefined || value === '') return '未提供';
  if (Array.isArray(value)) return value.length ? value.map(normalizeDisplayValue).join('；') : '无';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function normalizeRiskNotes(value, label) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    const notes = value.map((note, index) => requiredString(note, `${label}[${index}]`));
    assert(notes.length > 0, `${label} must not be empty`);
    return notes;
  }
  fail(`${label} must be a non-empty string or array of strings`);
}

function flattenSource(value, prefix = '', rows = []) {
  if (value === null || value === undefined) {
    if (prefix) rows.push([prefix, '未提供']);
    return rows;
  }

  if (Array.isArray(value)) {
    rows.push([prefix, normalizeDisplayValue(value)]);
    return rows;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b, 'en'));
    if (keys.length === 0 && prefix) rows.push([prefix, '无']);
    for (const key of keys) {
      flattenSource(value[key], prefix ? `${prefix}.${key}` : key, rows);
    }
    return rows;
  }

  rows.push([prefix, normalizeDisplayValue(value)]);
  return rows;
}

const SOURCE_LABELS = {
  'gbif.id': 'GBIF ID',
  'gbif.key': 'GBIF key',
  'gbif.url': 'GBIF 记录地址（文本）',
  gbifKey: 'GBIF key',
  gbifOccurrenceId: 'GBIF occurrence ID',
  gbifUrl: 'GBIF 记录地址（文本）',
  provider: '数据提供链路',
  occurrenceUrl: 'GBIF occurrence 地址（文本）',
  occurrenceID: 'Occurrence ID',
  occurrenceId: 'Occurrence ID',
  scientificName: 'GBIF 原始物种名',
  catalogScientificName: '目录拉丁名',
  scientificNameMatch: '名称绑定方式',
  taxonReferenceId: '稳定分类名称 ID',
  taxonKey: 'GBIF taxonKey',
  acceptedTaxonKey: 'GBIF acceptedTaxonKey',
  acceptedScientificName: 'GBIF 接受名',
  datasetKey: 'GBIF datasetKey',
  basisOfRecord: '记录类型',
  gbifIssues: 'GBIF issues',
  institutionCode: '馆藏机构代码',
  institutionName: '馆藏机构',
  collectionCode: '馆藏集合代码',
  collectionName: '馆藏集合',
  catalogNumber: '馆藏号',
  specimenId: '标本 ID',
  occurrenceLicense: 'Occurrence 许可',
  occurrenceRightsHolder: 'Occurrence 权利人',
  publishingOrgKey: 'GBIF 发布机构 key',
  mediaType: '媒体类型',
  mediaIdentifier: '媒体原始地址（文本）',
  mediaLicense: '媒体许可',
  mediaCreator: '媒体创建者',
  mediaRightsHolder: '媒体权利人',
  mediaPublisher: '媒体发布者',
  mediaReferences: '媒体馆藏页（文本）',
  sourceCheckedAt: '来源核对日期',
  rightsReviewState: '权利审核状态',
  sourceMetadataDigest: '来源元数据 SHA-256',
  license: '许可',
  licenseName: '许可名称',
  licenseUrl: '许可地址（文本）',
  rightsHolder: '权利人',
  attribution: '署名',
  sourcePage: '来源页（文本）',
};

function sourceLabel(fieldPath) {
  if (SOURCE_LABELS[fieldPath]) return SOURCE_LABELS[fieldPath];
  const leaf = fieldPath.split('.').pop();
  return SOURCE_LABELS[leaf] || fieldPath;
}

function resolveReviewAsset(asset, label) {
  assert(asset && typeof asset === 'object' && !Array.isArray(asset), `${label} metadata is missing`);
  const manifestRelativePath = requiredString(asset.path, `${label}.path`);
  assert(!path.isAbsolute(manifestRelativePath), `${label}.path must be project-relative`);
  assert(asset.mimeType === 'image/webp', `${label} must be a WebP review derivative`);

  if (asset.width !== undefined || asset.height !== undefined) {
    assert(Number.isInteger(asset.width) && asset.width > 0, `${label}.width must be a positive integer`);
    assert(Number.isInteger(asset.height) && asset.height > 0, `${label}.height must be a positive integer`);
  }
  if (asset.bytes !== undefined) {
    assert(Number.isInteger(asset.bytes) && asset.bytes > 0, `${label}.bytes must be a positive integer`);
  }
  if (asset.sha256 !== undefined) {
    assert(/^sha256:[a-f0-9]{64}$/i.test(asset.sha256), `${label}.sha256 is invalid`);
  }

  const candidatePath = path.resolve(projectRoot, manifestRelativePath);
  assert(isWithin(candidateRoot, candidatePath), `${label}.path escapes content-private/media-candidates/specimens`);
  assert(fs.existsSync(candidatePath), `${label} file does not exist: ${manifestRelativePath}`);
  const stat = fs.statSync(candidatePath);
  assert(stat.isFile(), `${label} is not a regular file: ${manifestRelativePath}`);

  const realRoot = fs.realpathSync(candidateRoot);
  const realCandidatePath = fs.realpathSync(candidatePath);
  assert(isWithin(realRoot, realCandidatePath), `${label} resolves outside the private specimens directory`);
  if (asset.bytes !== undefined) {
    assert(stat.size === asset.bytes, `${label} byte count differs from manifest`);
  }
  if (asset.sha256 !== undefined) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(realCandidatePath)).digest('hex');
    assert(`sha256:${digest}`.toLowerCase() === asset.sha256.toLowerCase(), `${label} SHA-256 differs from manifest`);
  }

  const relativeUrl = path.relative(candidateRoot, candidatePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');

  return {
    bytes: asset.bytes === undefined ? stat.size : asset.bytes,
    height: asset.height,
    url: `./${relativeUrl}`,
    width: asset.width,
  };
}

function normalizeRecord(record, index, seenIds) {
  const label = `records[${index}]`;
  assert(record && typeof record === 'object' && !Array.isArray(record), `${label} must be an object`);
  const id = requiredString(record.id, `${label}.id`);
  assert(!seenIds.has(id), `duplicate record id: ${id}`);
  seenIds.add(id);
  assert(record.status === 'candidate', `${id} must remain a candidate`);
  assert(record.role === 'origin_specimen_reference', `${id} must remain an origin specimen reference`);
  assert(record.publicationEligible === false, `${id} must not be publication eligible`);
  assert(Array.isArray(record.placements) && record.placements.length === 0, `${id} must not have runtime placements`);

  assert(record.depiction && typeof record.depiction === 'object' && !Array.isArray(record.depiction), `${id}.depiction is missing`);
  const depiction = record.depiction;
  const canonicalName = requiredString(depiction.canonicalName, `${id}.depiction.canonicalName`);
  const latinName = requiredString(depiction.latinName, `${id}.depiction.latinName`);
  const catalogPart = requiredString(depiction.catalogPart, `${id}.depiction.catalogPart`);
  const shownMaterial = requiredString(depiction.shownMaterial, `${id}.depiction.shownMaterial`);
  const catalogPartVisibility = normalizeDisplayValue(depiction.catalogPartVisibility);
  const visualUsability = normalizeDisplayValue(depiction.visualUsability);
  const riskNotes = normalizeRiskNotes(depiction.riskNotes, `${id}.depiction.riskNotes`);
  assert(depiction.identificationUse === 'prohibited', `${id} must prohibit identification use`);
  assert(depiction.medicalUse === 'prohibited', `${id} must prohibit medical use`);

  assert(record.source && typeof record.source === 'object' && !Array.isArray(record.source), `${id}.source is missing`);
  const sourceRows = flattenSource(record.source);
  assert(sourceRows.length > 0, `${id}.source must contain GBIF, collection, or licence metadata`);
  const sourceKeyText = sourceRows.map(([key]) => key).join(' ').toLowerCase();
  assert(/gbif|occurrence/.test(sourceKeyText), `${id}.source must include GBIF or occurrence metadata`);
  assert(/institution|collection|catalog|specimen|herbarium|museum/.test(sourceKeyText), `${id}.source must include collection metadata`);
  assert(/licen[cs]e|rights|attribution/.test(sourceKeyText), `${id}.source must include licence or rights metadata`);

  const asset = resolveReviewAsset(record.assets && record.assets.review, `${id}.assets.review`);
  return {
    asset,
    canonicalName,
    catalogPart,
    catalogPartVisibility,
    id,
    latinName,
    riskNotes,
    shownMaterial,
    sourceRows,
    visualUsability,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function renderSourceRows(rows) {
  return rows.map(([fieldPath, value]) => `
              <div>
                <dt>${escapeHtml(sourceLabel(fieldPath))}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>`).join('');
}

function renderRiskNotes(notes) {
  return notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
}

function renderCard(record, index) {
  const width = record.asset.width || 768;
  const height = record.asset.height || 768;
  const alt = `${record.canonicalName}馆藏来源植物参考候选，所示材料：${record.shownMaterial}；不可用于食材部位判断或鉴别`;
  return `
      <article class="card" aria-labelledby="candidate-${index}">
        <p class="card__ban">私有候选 · 不可发布 · 不可进入客户端包</p>
        <div class="card__body">
          <section class="identity">
            <p class="eyebrow">候选 ${String(index + 1).padStart(2, '0')}</p>
            <h2 id="candidate-${index}">${escapeHtml(record.canonicalName)}</h2>
            <p class="latin" lang="la">${escapeHtml(record.latinName)}</p>
            <dl class="facts">
              <div><dt>候选记录</dt><dd><code>${escapeHtml(record.id)}</code></dd></div>
              <div><dt>目录目标部位</dt><dd>${escapeHtml(record.catalogPart)}</dd></div>
              <div><dt>画面所示材料</dt><dd>${escapeHtml(record.shownMaterial)}</dd></div>
              <div><dt>目录部位可见性</dt><dd>${escapeHtml(record.catalogPartVisibility)}</dd></div>
              <div><dt>视觉可用性</dt><dd>${escapeHtml(record.visualUsability)}</dd></div>
            </dl>
            <section class="risk" aria-label="候选风险">
              <h3>风险与限制</h3>
              <ul>${renderRiskNotes(record.riskNotes)}</ul>
            </section>
          </section>
          <figure class="preview">
            <a href="${escapeHtml(record.asset.url)}" target="_blank" rel="noopener" aria-label="在本机打开 ${escapeHtml(record.canonicalName)} 馆藏候选审阅图">
              <img src="${escapeHtml(record.asset.url)}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${escapeHtml(alt)}">
            </a>
            <figcaption>本地 WebP 审阅衍生图 · ${escapeHtml(formatBytes(record.asset.bytes))} · 点击仅在本机查看</figcaption>
          </figure>
        </div>
        <section class="source" aria-label="GBIF、馆藏与许可元数据">
          <h3>GBIF / 馆藏 / 许可来源记录</h3>
          <p>以下内容来自私有候选 manifest，仅用于人工核对；地址以文本呈现，不会自动联网。</p>
          <dl>${renderSourceRows(record.sourceRows)}</dl>
        </section>
        <p class="card__notice">此图仅可作为物种来源背景的候选参考，不可作为食材部位或鉴别依据。画面不能证明真实身份、可食性、质量或安全性；不可用于采集、购买、食用、配伍、煎煮、诊疗或用药判断。</p>
      </article>`;
}

function renderDocument(manifest, digest, records) {
  const schemaVersion = manifest.schemaVersion === undefined ? '未提供' : normalizeDisplayValue(manifest.schemaVersion);
  const contentVersion = manifest.contentVersion === undefined ? '未提供' : normalizeDisplayValue(manifest.contentVersion);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,noimageindex">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'; media-src 'none'">
  <title>私有馆藏标本候选审阅｜不可发布</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #292d29; background: #edf0e8; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.58; }
    a { color: inherit; }
    .shell { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 56px; }
    .ban { position: sticky; top: 0; z-index: 10; margin: 0; padding: 14px 18px; border: 2px solid #7c1e1e; border-radius: 14px; color: #fff; background: #7c1e1e; box-shadow: 0 7px 24px rgba(66, 19, 19, .2); text-align: center; font-weight: 900; letter-spacing: .04em; }
    header { padding: 36px 4px 24px; }
    header h1 { max-width: 850px; margin: 8px 0 12px; font-size: clamp(30px, 6vw, 54px); line-height: 1.13; }
    header p { max-width: 880px; margin: 8px 0; color: #535c52; }
    .eyebrow { margin: 0; color: #285642; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .meta span { padding: 6px 10px; border: 1px solid #c5cec0; border-radius: 999px; background: rgba(255,255,255,.6); font-size: 12px; }
    .grid { display: grid; gap: 24px; }
    .card { overflow: hidden; border: 1px solid #c7cec1; border-radius: 20px; background: #fffefa; box-shadow: 0 8px 28px rgba(45, 59, 45, .08); }
    .card__ban { margin: 0; padding: 9px 18px; color: #681919; background: #f6dcdc; text-align: center; font-size: 13px; font-weight: 900; letter-spacing: .05em; }
    .card__body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 46%); gap: 24px; padding: 24px; }
    h2 { margin: 3px 0 0; font-size: 30px; line-height: 1.25; }
    .latin { margin: 4px 0 18px; color: #657064; font-size: 14px; font-style: italic; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin: 0; }
    .facts div { min-width: 0; padding: 11px 12px; border-radius: 11px; background: #f0f3ec; }
    dt { color: #687066; font-size: 12px; font-weight: 800; }
    dd { margin: 3px 0 0; overflow-wrap: anywhere; font-weight: 700; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    .risk { margin-top: 14px; padding: 13px 15px; border-left: 4px solid #a76924; background: #fff4e1; }
    .risk h3, .source h3 { margin: 0 0 5px; font-size: 15px; }
    .risk ul { margin: 4px 0 0; padding-left: 20px; }
    .preview { margin: 0; }
    .preview a { display: block; width: fit-content; max-width: 100%; overflow: hidden; border: 1px solid #c9d0c3; border-radius: 14px; background: #e6eadf; }
    .preview a:focus-visible { outline: 4px solid #1d6871; outline-offset: 3px; }
    .preview img { display: block; width: auto; max-width: 100%; max-height: 680px; height: auto; object-fit: contain; }
    figcaption { margin-top: 6px; color: #687066; font-size: 12px; }
    .source { margin: 0 24px 22px; padding: 16px; border: 1px solid #d7dcd1; border-radius: 13px; background: #f7f8f3; }
    .source > p { margin: 0 0 12px; color: #5d665b; font-size: 13px; }
    .source dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .source dl div { min-width: 0; padding: 9px 10px; border-radius: 9px; background: #fff; }
    .source dd { font-size: 12px; font-weight: 600; }
    .card__notice { margin: 0; padding: 15px 24px; color: #681919; background: #fff0ef; font-size: 13px; font-weight: 800; }
    .final-ban { margin-top: 26px; padding: 18px; border: 2px dashed #7c1e1e; border-radius: 14px; color: #681919; background: #fff7f5; text-align: center; font-weight: 900; }
    @media (max-width: 760px) {
      .shell { width: min(100% - 20px, 1160px); padding-top: 10px; }
      .ban { top: 6px; }
      .card__body, .facts, .source dl { grid-template-columns: 1fr; }
      .card__body { padding: 18px 16px; }
      .source { margin: 0 16px 18px; }
    }
    @media print {
      .ban { position: static; }
      .card { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <p class="ban" role="alert">⛔ 私有馆藏候选｜仅供本地人工审阅｜不可发布</p>
    <header>
      <p class="eyebrow">Private specimen candidate review</p>
      <h1>馆藏来源植物参考候选</h1>
      <p>本页只展示本地馆藏标本候选的审阅衍生图与来源元数据。馆藏图最多用于理解物种来源背景，不可作为食材部位或鉴别依据，也不能证明现实样品的身份、可食性、质量或安全性。</p>
      <p><strong>禁止：</strong>发布或进入微信小程序包；用于食材/药材鉴别、采集、购买、食用、配伍、煎煮、诊疗或用药判断。</p>
      <div class="meta" aria-label="候选 manifest 元数据">
        <span>内容版本：${escapeHtml(contentVersion)}</span>
        <span>Schema：${escapeHtml(schemaVersion)}</span>
        <span>候选数：${records.length}</span>
        <span>Manifest SHA-256：${escapeHtml(digest.slice(0, 16))}…</span>
      </div>
    </header>
    <section class="grid" aria-label="馆藏标本候选列表">
${records.map(renderCard).join('\n')}
    </section>
    <footer class="final-ban">本地审阅结束后请关闭页面。任何候选在另行完成专业、权利、合规与发布审核前，均不可发布。</footer>
  </main>
</body>
</html>
`;
}

function buildReviewHtml() {
  assert(fs.existsSync(candidateRoot) && fs.statSync(candidateRoot).isDirectory(), 'private specimens directory does not exist');
  const { digest, manifest, records: rawRecords } = readManifest();
  const seenIds = new Set();
  const records = rawRecords.map((record, index) => normalizeRecord(record, index, seenIds));
  return renderDocument(manifest, digest, records);
}

function main() {
  const html = buildReviewHtml();
  fs.writeFileSync(outputPath, html, { encoding: 'utf8', mode: 0o600 });
  const recordCount = (html.match(/<article\b/g) || []).length;
  console.log(`[specimen-review] wrote ${path.relative(projectRoot, outputPath)} (${recordCount} private candidates)`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildReviewHtml, main };
