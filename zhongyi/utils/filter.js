"use strict";

const { evaluateIngredient } = require("./safety");

const ARRAY_FILTERS = ["goals", "categories", "usageTypes", "tastes", "tags"];

const DEFAULT_FILTERS = Object.freeze({
  query: "",
  goals: [],
  categories: [],
  usageTypes: [],
  tastes: [],
  tags: [],
  onlySourceChecked: false,
  sort: "default"
});

function uniqueStrings(value, maxItems) {
  const seen = Object.create(null);
  const result = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (typeof item !== "string" && typeof item !== "number") return;
    const text = String(item).trim().slice(0, 60);
    if (!text || seen[text] || result.length >= (maxItems || 30)) return;
    seen[text] = true;
    result.push(text);
  });
  return result;
}

function cleanFilters(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    query: typeof source.query === "string" ? source.query.trim().slice(0, 60) : "",
    goals: uniqueStrings(source.goals),
    categories: uniqueStrings(source.categories),
    usageTypes: uniqueStrings(source.usageTypes),
    tastes: uniqueStrings(source.tastes),
    tags: uniqueStrings(source.tags),
    onlySourceChecked: source.onlySourceChecked === true,
    sort: source.sort === "name" ? "name" : "default"
  };
}

function hasAny(values, selected) {
  if (!selected.length) return true;
  const source = Array.isArray(values) ? values : [];
  return selected.some((value) => source.includes(value));
}

function searchableText(ingredient) {
  const sensory = ingredient.sensory || {};
  const identity = ingredient.identity || {};
  return [
    ingredient.name,
    ingredient.pinyin,
    ...(identity.plantNames || []),
    identity.latinName,
    identity.ediblePart
  ].concat(
    ingredient.aliases || [],
    ingredient.tags || [],
    ingredient.goals || [],
    ingredient.usageTypes || [],
    sensory.tastes || []
  ).filter(Boolean).join(" ").toLocaleLowerCase();
}

function matchesFilters(ingredient, filters, profile) {
  if (!ingredient || typeof ingredient !== "object") return false;
  const query = filters.query.toLocaleLowerCase();
  if (query && !searchableText(ingredient).includes(query)) return false;
  if (!hasAny(ingredient.goals, filters.goals)) return false;
  if (!hasAny([ingredient.category], filters.categories)) return false;
  if (!hasAny(ingredient.usageTypes, filters.usageTypes)) return false;
  if (!hasAny(ingredient.sensory && ingredient.sensory.tastes, filters.tastes)) return false;
  if (!hasAny(ingredient.tags, filters.tags)) return false;
  if (filters.onlySourceChecked && (!ingredient.audit || ingredient.audit.sourceCheckState !== "checked")) return false;
  // 硬阻止规则始终先于资料筛选，调用方不能通过关闭某个开关绕过。
  if (evaluateIngredient(ingredient, profile).blocked) return false;
  return true;
}

function applyCatalogFilters(catalog, inputFilters, profile) {
  const filters = cleanFilters(inputFilters);
  const result = (Array.isArray(catalog) ? catalog : []).filter((ingredient) => matchesFilters(ingredient, filters, profile));
  if (filters.sort === "name") {
    return result.slice().sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));
  }
  return result.slice().sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function activeFilterCount(inputFilters) {
  const filters = cleanFilters(inputFilters);
  let count = filters.query ? 1 : 0;
  ARRAY_FILTERS.forEach((key) => {
    count += filters[key].length;
  });
  if (filters.onlySourceChecked) count += 1;
  return count;
}

module.exports = {
  DEFAULT_FILTERS,
  cleanFilters,
  applyCatalogFilters,
  activeFilterCount
};
