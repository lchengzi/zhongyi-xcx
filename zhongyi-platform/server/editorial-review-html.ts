import type { EditorialReviewPack } from './editorial-review-pack.js';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Read-only private handoff; never part of the web static root or mini bundle. */
export function editorialReviewHtml(pack: EditorialReviewPack): string {
  const sources = new Map(pack.sources.map(source => [source.key, source]));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>食养资料 · 私有待审稿</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f8f3;color:#263d30;font:16px/1.85 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}
main{max-width:820px;margin:auto;padding:32px 20px 56px}header{padding:16px 0 24px}h1{font-size:30px;margin:8px 0}h2{font-size:22px;margin:0 0 18px}h3{font-size:18px;margin:0 0 12px}
.eyebrow{color:#617558;letter-spacing:3px}.notice{padding:16px 20px;background:#fbf2e2;border:1px solid #eadfc6;border-radius:16px}.notice p{margin:4px 0}
article,section{padding:24px;margin-top:20px;background:#fff;border:1px solid #e3e8da;border-radius:20px}section section{padding:18px;border-radius:14px}p{margin:8px 0;white-space:pre-line;overflow-wrap:anywhere}
.label,small{color:#66775d}.label{font-weight:600;margin-top:18px}a{color:#315b41;overflow-wrap:anywhere}.source{border-top:1px solid #edf0e7;margin-top:18px;padding-top:18px}.source:first-of-type{border:0;margin:0;padding:0}
@media(max-width:420px){main{padding:20px 14px 40px}article,section{padding:18px}h1{font-size:26px}}
@media print{body{background:#fff}main{max-width:none;padding:0}article,section{break-inside:avoid}a{color:#263d30}}
</style></head><body><main><header><div class="eyebrow">食养资料工作台</div><h1>私有待审稿</h1><p>导入时资料快照，不随工作台后续修改自动更新。</p></header>
<div class="notice"><p>尚未完成专业审校，未获发布批准。</p><p>供编辑与审核人员核对来源、适用范围和内容缺口；不作为食用、诊疗或用药建议。</p></div>
${pack.drafts.map(draft => `<article><h2>${escape(draft.ingredientId)} · 编辑稿</h2>
<p class="label">候选部位说明</p><p>${escape(draft.content.ediblePart || '待核对')}</p>
<p class="label">学名</p><p>${escape(draft.content.latinName || '未填入单一学名，待核对具体基原')}</p>
<section><h3>教育说明</h3><p>${escape(draft.content.educationText)}</p></section>
<section><h3>安全边界与待审问题</h3><p>${escape(draft.content.safetyText)}</p></section>
<section><h3>对应来源与定位</h3>${draft.content.sourceRefs.map(ref => {
    const source = sources.get(ref.id); if (!source) throw new Error('Missing private review source');
    return `<div class="source"><h3>${escape(source.input.title)}</h3><small>${escape(source.input.publisher)} · 资料访问 ${escape(source.accessedOn)}</small>
<p><a href="${escape(source.input.url)}" target="_blank" rel="noopener noreferrer">打开原始出处</a></p>
<p class="label">原文定位</p><p>${escape(ref.locator)}</p><p class="label">范围与限制</p><p>${escape(source.evidenceNote)}</p></div>`;
  }).join('')}</section></article>`).join('')}
<section><h2>审核衔接</h2><p>来源登记不等于正式来源核验；编辑稿保存不等于专业意见。应在工作台分别记录真实核验与具名审校，再按既有流程决定是否发布。此文件不能写入批准状态。</p></section>
</main></body></html>`;
}
