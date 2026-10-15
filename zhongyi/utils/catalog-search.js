"use strict";

const filterUtils = require("./filter");

function normalizeSearchText(value) {
  const text = String(value || "");
  const compatible = typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  return compatible.toLowerCase().replace(/\s+/g, " ").trim();
}

function compactPinyin(value) {
  // Spelling equivalence only: do not strip spaces/accents from Latin taxon names.
  // Preserve ü as v before removing tone marks; lu and lü are not equivalent.
  const compact = normalizeSearchText(value)
    .replace(/[ǖǘǚǜü]/g, "v")
    .replace(/[āáǎà]/g, "a").replace(/[ēéěè]/g, "e")
    .replace(/[īíǐì]/g, "i").replace(/[ōóǒò]/g, "o")
    .replace(/[ūúǔù]/g, "u")
    .replace(/u[\u0300\u0301\u0304\u030c]*\u0308/g, "v")
    .replace(/u:/g, "v")
    .replace(/[\u0300\u0301\u0304\u030c]/g, "")
    .replace(/[\s'’\-]/g, "");
  return /^[a-z]+$/.test(compact) ? compact : "";
}

function searchFields(ingredient) {
  const sensory = ingredient.sensory || {};
  const identity = ingredient.identity || {};
  const fields = [
    ["名称", ingredient.name], ["拼音", ingredient.pinyin],
    ["拉丁名", identity.latinName], ["目录记录部位", identity.ediblePart]
  ];
  for (const [label, values] of [
    ["原植物名称", identity.plantNames], ["别名", ingredient.aliases],
    ["资料标签", ingredient.tags], ["资料主题", ingredient.goals],
    ["食用形式标签", ingredient.usageTypes], ["感官标签", sensory.tastes]
  ]) {
    if (Array.isArray(values)) values.forEach(value => fields.push([label, value]));
  }
  return fields.filter(([, value]) => typeof value === "string" && value)
    .map(([label, value]) => ({ label, value, normalized: normalizeSearchText(value) }));
}

function findSearchMatch(ingredient, query) {
  const fields = searchFields(ingredient);
  const literal = normalizeSearchText(query);
  // Keep field boundaries: a name followed by a pinyin field is not one phrase.
  const direct = fields.find(field => field.normalized.includes(literal));
  if (direct) return direct;
  if (/^[\u3400-\u9fff\s]+$/.test(literal)) {
    const chinese = literal.replace(/\s/g, "");
    const spaced = chinese && fields.find(field => field.normalized.replace(/\s/g, "").includes(chinese));
    if (spaced) return spaced;
  }
  const pinyinQuery = compactPinyin(literal);
  const pinyin = compactPinyin(ingredient.pinyin);
  return pinyinQuery && pinyin && pinyin.includes(pinyinQuery)
    ? fields.find(field => field.label === "拼音") : null;
}

function searchMatchDisplay(ingredient, query) {
  const text = typeof query === "string" ? query.trim().slice(0, 60) : "";
  const match = text && ingredient && typeof ingredient === "object" && findSearchMatch(ingredient, text);
  return {
    searchMatchText: match ? `${match.label}命中：${match.value}` : "",
    searchMatchNote: match && match.label === "别名"
      ? "别名仅用于检索，不表示不同部位或加工形态相同、可替代；请继续核对详情与来源。" : ""
  };
}

// Text only: callers still own safety evaluation and action restrictions.
// Preserve the caller's saved order; restricted favorites must remain removable.
function filterCatalogText(catalog, query) {
  const text = typeof query === "string" ? query.trim().slice(0, 60) : "";
  return (Array.isArray(catalog) ? catalog : []).filter(item =>
    item && typeof item === "object" && (!text || Boolean(findSearchMatch(item, text)))
  );
}

function searchCatalog(catalog, inputFilters, profile) {
  const filters = filterUtils.cleanFilters(inputFilters);
  const matching = filterCatalogText(catalog, filters.query);
  // Narrow candidates first, then retain the original versioned filtering and
  // safety rules. Only the already-applied text query is cleared; no risk flag is.
  return filterUtils.applyCatalogFilters(matching, { ...filters, query: "" }, profile);
}

module.exports = { searchCatalog, filterCatalogText, searchMatchDisplay };
