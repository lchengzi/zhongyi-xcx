"use strict";

// Local presentation and real page logic, not a device or clinical approval.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const catalog = require("../data/ingredients");
const safety = require("../utils/safety");
const format = require("../utils/format");
const compare = require("../utils/compare");
const populations = [
  ["pregnancy", "孕期"], ["breastfeeding", "哺乳期"],
  ["infantsToddlers", "婴幼儿"], ["children", "儿童或青少年"], ["olderAdults", "老年人"]
];
const seed = catalog.ingredients.find((item) => item.id === "huang-qi");
const clone = (value) => JSON.parse(JSON.stringify(value));
const foodDisplay = require("../utils/food-display");

test("part display preserves recorded text and separates source checking from professional approval", () => {
  for (const item of catalog.ingredients) {
    const before = JSON.stringify(item), view = foodDisplay.foodIdentityDisplay(item);
    assert.equal(view.partText, item.identity.ediblePart.trim());
    assert.equal(view.partReviewText, item.identity.partReviewState === "source_checked"
      ? "历史部位来源已核对，专业复核待完成" : "部位资料待复核");
    assert.equal(JSON.stringify(item), before);
    assert.equal(row([item], foodDisplay.PART_LABEL).values[0], view.partText);
    assert.equal(row([item], "部位资料复核").values[0], view.partReviewText);
  }
});

test("missing or invalid part data remain explicit unknown instead of disappearing", () => {
  for (const identity of [undefined, null, {}, { ediblePart: " " }, { ediblePart: [] }, { ediblePart: {} },
    { ediblePart: null, partReviewState: "source_checked" }, { ediblePart: 12 }]) {
    const item = { ...seed, identity };
    assert.deepEqual(foodDisplay.foodIdentityDisplay(item), { partText: "待确认", partReviewText: "部位资料待复核" });
    assert.equal(row([item], foodDisplay.PART_LABEL).values[0], "待确认");
  }
  assert.doesNotThrow(() => foodDisplay.foodIdentityDisplay(null));
});

test("raw reviewed or approved flags cannot manufacture a part approval", () => {
  for (const state of ["reviewed", "approved", "published", true, undefined]) {
    const item = clone(seed); item.identity.partReviewState = state; item.audit.professionalReviewState = "reviewed";
    const display = foodDisplay.foodIdentityDisplay(item);
    assert.equal(display.partText, seed.identity.ediblePart); assert.equal(display.partReviewText, "部位资料待复核");
    assert.equal(row([item], "部位资料复核").values[0], "部位资料待复核");
  }
});

test("part review differences follow final text and retain the original part in cells", () => {
  const item = clone(seed); item.id = "fictional-part-pending"; item.identity.partReviewState = "pending";
  const groups = compare.buildCompareGroups([seed, item], true);
  assert(!groups.flatMap(g => g.rows).some(r => r.label === foodDisplay.PART_LABEL));
  const review = groups.flatMap(g => g.rows).find(r => r.label === "部位资料复核");
  assert(review && review.different);
  assert.deepEqual(review.cells.map(c => c.text), review.values);
  assert.deepEqual(review.cells.map(c => c.ingredientId), [seed.id, item.id]);
});
function row(items, label, evaluations) {
  const result = compare.buildCompareGroups(items, false, evaluations).flatMap((group) => group.rows).find((entry) => entry.label === label);
  assert(result, `missing comparison row: ${label}`);
  return result;
}

for (const [field, label] of populations) {
  test(`${field}: an unsupported positive cannot become a suitability claim`, () => {
    const item = clone(seed);
    item.safety[field] = "yes";
    item.safety.sourceIds = [];
    assert.equal(row([item], label).values[0], "待确认");
  });
  test(`${field}: toggling review flags does not bypass independent review records`, () => {
    const item = clone(seed);
    item.safety[field] = "yes";
    item.audit.professionalReviewState = "reviewed";
    item.audit.reviewedAt = "2026-08-09";
    item.audit.ingredientDigest = `sha256:${"a".repeat(64)}`;
    item.audit.reviews = [];
    assert.equal(row([item], label).values[0], "待确认");
  });
  test(`${field}: a withdrawn field source leaves the state unknown`, () => {
    const item = clone(seed);
    item.safety[field] = "no";
    item.sources.forEach((source) => { if (item.safety.sourceIds.includes(source.id)) source.status = "withdrawn"; });
    assert.equal(row([item], label).values[0], "待确认");
  });
}

test("all 106 historical population cells agree with detail safety semantics", () => {
  for (const item of catalog.ingredients) {
    const detail = format.detailView(item, [], []);
    for (const [, label] of populations) {
      assert.equal(row([item], label).values[0], detail.safetyRows.find((entry) => entry.label === label).value, `${item.id}/${label}`);
    }
  }
});

test("published negative population restrictions remain visible", () => {
  for (const label of ["孕期", "哺乳期", "婴幼儿"]) assert.equal(row([seed], label).values[0], "来源明确：不推荐");
});

test("comparison includes pending mapping and the original processing explanation", () => {
  assert.equal(row([seed], "食用形态复核").values[0], "食用形态映射待逐项复核");
  assert.equal(row([seed], "加工资料说明").values[0], seed.foodUse.note);
  assert.equal(row([seed], "加工注意事项").values[0], "当前资料未收录；不代表已确认没有风险");
});

test("missing processing information remains unknown instead of becoming instructions", () => {
  const item = clone(seed);
  delete item.foodUse;
  delete item.safety.preparationWarnings;
  assert.equal(row([item], "加工资料说明").values[0], "待确认；不提供自行加工或用量建议");
  assert.equal(row([item], "食用形态复核").values[0], "食用形态映射待逐项复核");
});

test("processing notes and original source check dates are not rewritten", () => {
  const item = clone(seed);
  item.safety.preparationWarnings = ["虚构测试注意甲", "虚构测试注意乙"];
  assert.equal(row([item], "加工注意事项").values[0], "虚构测试注意甲；虚构测试注意乙");
  assert.equal(row([item], "条目来源核对日期").values[0], item.audit.sourceCheckedAt);
});

test("an evaluation belonging to another item is never substituted by array position", () => {
  const other = { ingredientId: "not-this-item", blocked: true, warnings: [] };
  assert.equal(row([seed], "本次筛选状态", [other]).values[0], "尚未评估");
  assert.equal(row([seed], "本次筛选状态", { [seed.id]: other }).values[0], "尚未评估");
});

test("out-of-order valid evaluations are matched by identity", () => {
  const items = catalog.ingredients.slice(0, 3);
  const evaluations = items.map((item, index) => ({ ingredientId: item.id, blocked: index === 0, warnings: index === 1 ? ["fixture"] : [] })).reverse();
  assert.deepEqual(row(items, "本次筛选状态", evaluations).values, ["已停止筛选", "需先确认", "未命中已知阻止项"]);
  assert.deepEqual(row([seed], "本次筛选状态", { [seed.id]: { ingredientId: seed.id, blocked: true } }).values, ["已停止筛选"]);
});

test("difference mode is based on normalized safety cells and keeps the four-item cap", () => {
  const first = clone(seed), second = clone(seed);
  second.id = "fictional-second";
  first.safety.pregnancy = "yes"; first.safety.sourceIds = [];
  second.safety.pregnancy = "unknown";
  const visible = compare.buildCompareGroups([first, second], true).flatMap((group) => group.rows);
  assert(!visible.some((entry) => entry.label === "孕期"));
  assert.equal(row([...catalog.ingredients.slice(0, 5)], "名称").values.length, 4);
});

test("comparison cells carry the exact selected ingredient identity and name in caller order", () => {
  const items = [catalog.ingredients[5], catalog.ingredients[1], catalog.ingredients[8], catalog.ingredients[2], catalog.ingredients[9]];
  for (const differencesOnly of [false, true]) {
    const groups = compare.buildCompareGroups(items, differencesOnly, safety.evaluateCatalog(items, {}));
    for (const group of groups) for (const entry of group.rows) {
      assert.deepEqual(entry.cells.map(x => x.ingredientId), items.slice(0, 4).map(x => x.id));
      assert.deepEqual(entry.cells.map(x => x.nameCn), items.slice(0, 4).map(x => x.name));
      assert.deepEqual(entry.cells.map(x => x.text), entry.values);
    }
  }
});

test("comparison is read-only and does not change source, review or runtime rules", () => {
  const before = JSON.stringify(catalog);
  compare.buildCompareGroups(catalog.ingredients.slice(0, 4), true, safety.evaluateCatalog(catalog.ingredients.slice(0, 4), {}));
  assert.equal(JSON.stringify(catalog), before);
  assert(compare.COMPARE_NOTICE.includes("不表示"));
});

test("the real comparison page renders the extra boundaries and respects red flags", () => {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  let definition, writes = 0;
  const app = { globalData: { sessionSafetyProfile: {} } };
  const memory = { zhongyi_favorites_v1: [], zhongyi_compare_v1: ["huang-qi", "gou-qi-zi"] };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = { getStorageSync: (key) => memory[key] || "", setStorageSync: () => { writes++; }, showToast() {} };
    const modulePath = require.resolve("../pages/compare/compare");
    delete require.cache[modulePath];
    require(modulePath);
    const page = { ...definition, data: clone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    page.onShow();
    assert.equal(page.data.ingredients.length, 2);
    assert(page.data.groups.flatMap((group) => group.rows).some((entry) => entry.label === "加工资料说明"));
    app.globalData.sessionSafetyProfile = { redFlags: ["sudden_severe_chest_pain"] };
    page.refresh();
    assert.equal(page.data.triageBlocked, true);
    assert.deepEqual(page.data.groups, []);
    assert.equal(writes, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});
