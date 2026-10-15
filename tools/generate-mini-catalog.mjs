import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { projectIngredientSafety } from './public-safety-projection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = createRequire(path.join(root, 'zhongyi', 'package.json'));
const source = legacy('./data/ingredients.js');
const { foodIdentityDisplay, PART_SCOPE_NOTICE } = legacy('./utils/food-display.js');
const { USAGE_TEXT } = legacy('./utils/format.js');
const { evaluateIngredient, rulesVersion } = legacy('./utils/safety.js');
const { verifyWorkspace } = legacy('./tools/version-core.js');
const { checkRuntimeJsonProjections } = legacy('./tools/runtime-projections.js');
const verified = verifyWorkspace(path.join(root, 'zhongyi'));
checkRuntimeJsonProjections();
const active = legacy('./data/version-runtime.js');
if (verified.releaseId !== active.releaseId || verified.catalogContentVersion !== source.contentVersion || verified.rulesContentVersion !== rulesVersion) {
  throw new Error('Historical catalog does not match its verified release identity.');
}
const output = path.join(root, 'apps', 'miniprogram', 'src', 'data', 'catalog.json');
const releaseOutput = path.join(path.dirname(output), 'catalog-release.json');
const releaseSerialized = `${JSON.stringify({ protocolVersion: 1, releaseId: active.releaseId, releaseDigest: active.releaseDigest, contentVersion: source.contentVersion }, null, 2)}\n`;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const snapshot = {
  schemaVersion: '1.1.0',
  rulesVersion,
  contentVersion: source.contentVersion,
  catalogAsOf: source.catalogCoverage.asOf,
  boundaryNotice: `食材知识供学习参考，不用于诊断、治疗或处方指导。${PART_SCOPE_NOTICE}`,
  ingredients: source.ingredients.map((item) => {
    if (item.audit?.professionalReviewState !== 'pending') {
      throw new Error('A changed review state requires an explicit projection review.');
    }
    if (!(item.sources || []).length || item.sources.some(value => value.status !== 'published')) {
      throw new Error('Unpublished sources require explicit public projection handling.');
    }
    const display = foodIdentityDisplay(item);
    const assessment = evaluateIngredient(item, {});
    if (assessment.blocked) throw new Error('A newly blocked item requires explicit catalog projection handling.');
    return {
      id: item.id, name: item.name, pinyin: text(item.pinyin), aliases: (item.aliases || []).map(text),
      latinName: text(item.identity?.latinName) || null,
      partText: display.partText,
      partReview: item.identity?.partReviewState === 'source_checked' ? 'source_checked' : 'pending',
      processingForms: (item.usageTypes || []).map((value) => USAGE_TEXT[value] || value),
      processingNote: text(item.foodUse?.note),
      riskNotes: [...new Set([
        ...(item.safety?.preparationWarnings || []),
        ...(item.safety?.avoidConditions || []).map(value => `基础疾病资料：${value}`),
        ...(item.safety?.drugInteractions || []).map(value => `相互作用资料：${value}`),
        '风险资料尚待专业审校，未记录不代表没有风险。'
      ].map(text).filter(Boolean))],
      restriction: text(item.regulatory?.restriction),
      sources: (item.sources || []).map(value => ({
        id: value.id, title: value.title, publisher: value.publisher,
        url: value.url, checkedAt: value.checkedAt
      })),
      sourceCheckedAt: text(item.audit?.sourceCheckedAt) || null,
      professionalReview: 'pending',
      image: null,
      safety: projectIngredientSafety(item)
    };
  })
};
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== serialized || !fs.existsSync(releaseOutput) || fs.readFileSync(releaseOutput, 'utf8') !== releaseSerialized) {
    throw new Error('Mini catalog differs from its explicit historical-source projection. Run catalog:generate.');
  }
  console.log(`Catalog projection unchanged: ${snapshot.ingredients.length} items; historical date ${snapshot.catalogAsOf}.`);
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized);
  fs.writeFileSync(releaseOutput, releaseSerialized);
  console.log(`Generated ${snapshot.ingredients.length} historical entries; no private records or photos exported.`);
}
