"use strict";

// Presentation only. Neither a source flag nor a label grants approval or edibility.
const PART_LABEL = "目录记录部位";
const PART_SCOPE_NOTICE = "目录记录部位不等于整株可食；名称有目录依据也不代表所有加工形态或用途均已确认。饮品、汤羹等是资料标签，不是加工步骤或个人食用建议。";

function foodIdentityDisplay(ingredient) {
  const identity = ingredient && typeof ingredient.identity === "object" && ingredient.identity || {};
  const partText = typeof identity.ediblePart === "string" && identity.ediblePart.trim()
    ? identity.ediblePart.trim() : "待确认";
  return {
    partText,
    // No public, independently signed part-review contract exists in this release.
    // A lone "reviewed"/"approved" flag must therefore remain unknown here.
    partReviewText: partText !== "待确认" && identity.partReviewState === "source_checked"
      ? "历史部位来源已核对，专业复核待完成" : "部位资料待复核"
  };
}

module.exports = { PART_LABEL, PART_SCOPE_NOTICE, foodIdentityDisplay };
