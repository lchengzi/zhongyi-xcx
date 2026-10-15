'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const mediaRoot = path.join(projectRoot, 'content-private', 'media-drafts');
const manifestPath = path.join(mediaRoot, 'manifest.json');
const outputPath = path.join(mediaRoot, 'review-index.html');

function fail(message) {
  throw new Error(`[media-review] ${message}`);
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
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read manifest.json: ${error.message}`);
  }

  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'manifest root must be an object');
  assert(parsed.scope === 'private_review_only', 'manifest scope must remain private_review_only');
  assert(parsed.policy && typeof parsed.policy === 'object', 'manifest policy is missing');
  assert(parsed.policy.clientUploadAllowed === false, 'client upload must remain prohibited');
  assert(parsed.policy.runtimeReferenceAllowed === false, 'runtime references must remain prohibited');
  assert(parsed.policy.identityUse === 'prohibited', 'identity use must remain prohibited');
  assert(parsed.policy.medicalUse === 'prohibited', 'medical use must remain prohibited');
  assert(Array.isArray(parsed.records), 'manifest records must be an array');
  assert(Number.isInteger(parsed.count) && parsed.count === parsed.records.length, 'manifest count does not match records');
  return parsed;
}

function resolveReviewAsset(asset, expectedSize, label) {
  assert(asset && typeof asset === 'object' && !Array.isArray(asset), `${label} metadata is missing`);
  const manifestRelativePath = requiredString(asset.path, `${label}.path`);
  assert(!path.isAbsolute(manifestRelativePath), `${label}.path must be project-relative`);
  assert(asset.mimeType === 'image/webp', `${label} must be a WebP review derivative`);
  assert(asset.width === expectedSize && asset.height === expectedSize, `${label} must be ${expectedSize} x ${expectedSize}`);
  assert(Number.isInteger(asset.bytes) && asset.bytes > 0, `${label}.bytes must be a positive integer`);
  assert(/^sha256:[a-f0-9]{64}$/i.test(asset.sha256 || ''), `${label}.sha256 is invalid`);

  const candidatePath = path.resolve(projectRoot, manifestRelativePath);
  assert(isWithin(mediaRoot, candidatePath), `${label}.path escapes content-private/media-drafts`);
  assert(fs.existsSync(candidatePath), `${label} file does not exist: ${manifestRelativePath}`);
  const stat = fs.statSync(candidatePath);
  assert(stat.isFile(), `${label} is not a regular file: ${manifestRelativePath}`);

  const realMediaRoot = fs.realpathSync(mediaRoot);
  const realCandidatePath = fs.realpathSync(candidatePath);
  assert(isWithin(realMediaRoot, realCandidatePath), `${label} resolves outside content-private/media-drafts`);
  assert(stat.size === asset.bytes, `${label} byte count differs from manifest`);

  const digest = crypto.createHash('sha256').update(fs.readFileSync(realCandidatePath)).digest('hex');
  assert(`sha256:${digest}`.toLowerCase() === asset.sha256.toLowerCase(), `${label} SHA-256 differs from manifest`);

  const relativeUrl = path.relative(mediaRoot, candidatePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');

  return {
    bytes: asset.bytes,
    height: asset.height,
    url: `./${relativeUrl}`,
    width: asset.width,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function normalizeRecord(record, index, seenIds) {
  const label = `records[${index}]`;
  assert(record && typeof record === 'object' && !Array.isArray(record), `${label} must be an object`);
  const id = requiredString(record.id, `${label}.id`);
  assert(!seenIds.has(id), `duplicate record id: ${id}`);
  seenIds.add(id);

  assert(record.status === 'draft', `${id} must remain a draft`);
  assert(record.publicationEligible === false, `${id} must not be publication eligible`);
  assert(Array.isArray(record.placements) && record.placements.length === 0, `${id} must not have runtime placements`);
  assert(record.depiction && typeof record.depiction === 'object', `${id}.depiction is missing`);
  assert(record.depiction.state === 'unverified_ai_interpretation', `${id} must remain an unverified AI interpretation`);
  assert(record.depiction.identificationUse === 'prohibited', `${id} must prohibit identification use`);
  assert(record.depiction.medicalUse === 'prohibited', `${id} must prohibit medical use`);

  const canonicalName = requiredString(record.depiction.canonicalName, `${id}.depiction.canonicalName`);
  const latinName = requiredString(record.depiction.latinName, `${id}.depiction.latinName`);
  const depictedPart = requiredString(record.depiction.depictedPart, `${id}.depiction.depictedPart`);
  const ingredientId = requiredString(record.ingredientId, `${id}.ingredientId`);
  const thumbnail = resolveReviewAsset(record.assets && record.assets.thumbnailReview, 320, `${id}.assets.thumbnailReview`);
  const review = resolveReviewAsset(record.assets && record.assets.review, 768, `${id}.assets.review`);

  return {
    canonicalName,
    depictedPart,
    id,
    ingredientId,
    latinName,
    review,
    summary: `AI 生成的${canonicalName}（展示部位：${depictedPart}）情境插画草稿；manifest 标记为“未验证 AI 解释”，禁止用于身份鉴别或医疗判断。`,
    thumbnail,
  };
}

function renderPreview(asset, size, canonicalName, depictedPart, modifier) {
  const alt = `${canonicalName}${depictedPart}的 AI 生成未核验插画，${size} 像素本地审阅预览，不可用于鉴别`;
  return `
            <figure class="preview preview--${modifier}">
              <div class="preview__label">${size} × ${size} 审阅预览</div>
              <a class="preview__link" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener" aria-label="打开 ${escapeHtml(canonicalName)} ${size} 像素本地预览原图">
                <img src="${escapeHtml(asset.url)}" width="${asset.width}" height="${asset.height}" loading="lazy" decoding="async" alt="${escapeHtml(alt)}">
              </a>
              <figcaption>WebP · ${escapeHtml(formatBytes(asset.bytes))} · 点击仅在本机查看</figcaption>
            </figure>`;
}

function renderCard(record, index) {
  return `
      <article class="card" aria-labelledby="record-${index}">
        <div class="card__warning" role="note">不可发布 · AI 生成 · 尚未核验</div>
        <div class="card__heading">
          <div>
            <p class="eyebrow">条目 ${String(index + 1).padStart(2, '0')}</p>
            <h2 id="record-${index}">${escapeHtml(record.canonicalName)}</h2>
            <p class="latin" lang="la">${escapeHtml(record.latinName)}</p>
          </div>
          <span class="status">草稿</span>
        </div>
        <dl class="facts">
          <div><dt>条目 ID</dt><dd><code>${escapeHtml(record.ingredientId)}</code></dd></div>
          <div><dt>展示部位</dt><dd>${escapeHtml(record.depictedPart)}</dd></div>
          <div><dt>媒体记录</dt><dd><code>${escapeHtml(record.id)}</code></dd></div>
        </dl>
        <section class="summary" aria-label="条目摘要">
          <h3>摘要</h3>
          <p>${escapeHtml(record.summary)}</p>
        </section>
        <div class="previews">
${renderPreview(record.thumbnail, 320, record.canonicalName, record.depictedPart, 'thumbnail')}
${renderPreview(record.review, 768, record.canonicalName, record.depictedPart, 'review')}
        </div>
        <p class="card__footer">禁止发布、上传至客户端包或接入运行时；禁止用于鉴别、采集、购买、食用、配伍、煎煮或用药判断。</p>
      </article>`;
}

function renderDocument(manifest, records) {
  const contentVersion = requiredString(manifest.contentVersion, 'manifest.contentVersion');
  const schemaVersion = requiredString(manifest.schemaVersion, 'manifest.schemaVersion');
  const disclosure = requiredString(manifest.policy.futureVisibleDisclosure, 'manifest.policy.futureVisibleDisclosure');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,noimageindex">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
  <title>私有媒体草稿人工审阅画廊｜不可发布</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #302d28; background: #f4f0e8; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.6; }
    a { color: inherit; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    .alert { position: sticky; top: 0; z-index: 10; margin: 0; padding: 14px 18px; border: 2px solid #8b2020; border-radius: 14px; color: #fff; background: #8b2020; box-shadow: 0 8px 24px rgba(66, 19, 19, .18); font-weight: 800; letter-spacing: .04em; text-align: center; }
    header { padding: 38px 4px 24px; }
    header h1 { max-width: 800px; margin: 8px 0 12px; font-size: clamp(30px, 6vw, 56px); line-height: 1.14; }
    header p { max-width: 850px; margin: 8px 0; color: #5e584e; }
    .eyebrow { margin: 0; color: #8b2020; font-size: 13px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .manifest-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .manifest-meta span { padding: 6px 10px; border: 1px solid #d5cabb; border-radius: 999px; background: rgba(255,255,255,.55); font-size: 13px; }
    .grid { display: grid; gap: 24px; }
    .card { overflow: hidden; border: 1px solid #d8cdbd; border-radius: 20px; background: #fffdf9; box-shadow: 0 8px 28px rgba(67, 56, 40, .07); }
    .card__warning { padding: 9px 20px; color: #6d1818; background: #f7dddd; font-size: 13px; font-weight: 800; letter-spacing: .06em; text-align: center; }
    .card__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 24px 24px 8px; }
    .card h2 { margin: 2px 0 0; font-size: 30px; line-height: 1.25; }
    .latin { margin: 4px 0 0; color: #716b61; font-size: 14px; font-style: italic; }
    .status { flex: 0 0 auto; padding: 5px 10px; border: 1px solid #b56d28; border-radius: 999px; color: #7a4213; background: #fff0d8; font-size: 13px; font-weight: 800; }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 24px 18px; }
    .facts div { min-width: 0; padding: 12px; border-radius: 12px; background: #f5f1e9; }
    dt { color: #746c61; font-size: 12px; font-weight: 700; }
    dd { margin: 3px 0 0; overflow-wrap: anywhere; font-weight: 700; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    .summary { margin: 0 24px 22px; padding: 14px 16px; border-left: 4px solid #80785e; background: #f7f5ef; }
    .summary h3 { margin: 0 0 2px; font-size: 15px; }
    .summary p { margin: 0; color: #555046; }
    .previews { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); align-items: start; gap: 20px; padding: 0 24px 24px; }
    .preview { margin: 0; }
    .preview__label { margin-bottom: 7px; color: #514a40; font-size: 13px; font-weight: 800; }
    .preview__link { display: block; width: fit-content; max-width: 100%; border: 1px solid #d7ccbc; border-radius: 14px; background: #eee7dc; overflow: hidden; }
    .preview__link:focus-visible { outline: 4px solid #286c75; outline-offset: 3px; }
    .preview img { display: block; width: auto; max-width: 100%; height: auto; object-fit: contain; }
    .preview--thumbnail img { width: min(320px, 100%); }
    .preview--review img { width: min(768px, 100%); }
    figcaption { margin-top: 6px; color: #746d63; font-size: 12px; }
    .card__footer { margin: 0; padding: 15px 24px; color: #6d1818; background: #fff1f0; font-size: 13px; font-weight: 700; }
    .page-footer { margin-top: 28px; padding: 20px; border: 2px dashed #8b2020; border-radius: 14px; color: #6d1818; background: #fff6f5; text-align: center; font-weight: 800; }
    @media (max-width: 720px) {
      .shell { width: min(100% - 20px, 1180px); padding-top: 10px; }
      .alert { top: 6px; }
      .facts, .previews { grid-template-columns: 1fr; }
      .card__heading, .facts, .summary, .previews { margin-left: 16px; margin-right: 16px; padding-left: 0; padding-right: 0; }
      .facts { margin-top: 12px; }
      .summary { padding: 12px 14px; }
    }
    @media print {
      .alert { position: static; }
      .card { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <p class="alert" role="alert">⛔ 私有草稿｜仅供本地人工审阅｜不可发布</p>
    <header>
      <p class="eyebrow">Private local review gallery</p>
      <h1>媒体草稿人工审阅画廊</h1>
      <p>本页只读取私有 manifest 的审阅衍生图，供本机比较 320 与 768 像素效果。不得将本页或任何图片加入微信小程序包、上传为客户端素材或建立运行时引用。</p>
      <p><strong>未来如获准可见仍须展示：</strong>${escapeHtml(disclosure)}</p>
      <div class="manifest-meta" aria-label="manifest 元数据">
        <span>内容版本：${escapeHtml(contentVersion)}</span>
        <span>Schema：${escapeHtml(schemaVersion)}</span>
        <span>记录数：${records.length}</span>
        <span>发布资格：全部 false</span>
      </div>
    </header>
    <section class="grid" aria-label="待审阅媒体草稿">
${records.map(renderCard).join('\n')}
    </section>
    <footer class="page-footer">审阅结束后请关闭本地页面。图片不可用于药材或食材鉴别，也不可用于任何诊疗、剂量或用药判断。</footer>
  </main>
</body>
</html>
`;
}

function main() {
  assert(fs.existsSync(mediaRoot) && fs.statSync(mediaRoot).isDirectory(), 'private media directory does not exist');
  const manifest = readManifest();
  const seenIds = new Set();
  const records = manifest.records.map((record, index) => normalizeRecord(record, index, seenIds));
  const html = renderDocument(manifest, records);
  fs.writeFileSync(outputPath, html, { encoding: 'utf8', mode: 0o600 });
  console.log(`[media-review] wrote ${path.relative(projectRoot, outputPath)} (${records.length} private drafts)`);
}

main();
