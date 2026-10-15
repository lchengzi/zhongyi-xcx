"use strict";

// 这是运行时安全规则契约的唯一版本标识。任何红旗、画像归一化、
// 单味/整方门禁、筛选顺序或摘要语义变化，都必须提升 contentVersion，
// 重新完成专业审校并建立新的 P4 release，不能只改实现代码。
const schemaVersion = "1.0.0";
const contentVersion = "1.6.0";
const publishedAt = "2026-08-13";

const components = Object.freeze([
  "red-flag-and-controlled-options",
  "session-profile-normalization",
  "catalog-filter-order",
  "ingredient-safety-evaluation",
  "published-source-and-population-claim-gates",
  "ingredient-professional-review-binding",
  "whole-recipe-release-and-safety-gates",
  "recipe-review-digest-semantics",
  "public-recipe-fail-closed-builder",
  "external-food-material-registry-gates",
  "canonical-source-and-public-projection-gates",
  "unpublished-recipe-strict-public-projection",
  "whole-public-recipe-artifact-strict-projection",
  "withheld-bundle-and-registry-header-type-gates"
]);

module.exports = {
  schemaVersion,
  contentVersion,
  publishedAt,
  count: components.length,
  components
};
