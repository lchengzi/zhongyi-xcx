import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildComparison, findIngredient, parseCatalog, searchCatalog } from "../src/index.js";
import type { Ingredient } from "../src/index.js";

function ingredient(id = "bai-he", name = "百合"): Ingredient {
  return {
    id, name, pinyin: "bai he", aliases: ["百合鳞茎"], latinName: "Lilium brownii",
    partText: "鳞茎", partReview: "source_checked", processingForms: ["干制品"],
    processingNote: "加工形态待逐项复核", riskNotes: ["专业审校待完成，未收录风险不代表没有风险"],
    restriction: "仅提供资料，不作个体食用建议",
    sources: [{ id: "source-2002", title: "官方目录", publisher: "国家卫生健康委", url: "https://www.nhc.gov.cn/catalog.html", checkedAt: "2026-08-09" }],
    sourceCheckedAt: "2026-08-09", professionalReview: "pending", image: null,
    safety: {
      sourceState: 'checked', regulatoryStatus: 'listed',
      population: { pregnancy: 'unknown', breastfeeding: 'unknown', infantsToddlers: 'unknown', children: 'unknown', olderAdults: 'unknown' },
      allergenKeys: ['百合'], avoidConditions: [], cautionConditions: [], drugInteractions: [], preparationWarnings: [],
      reviews: { allergen: 'pending', condition: 'pending', interaction: 'pending', preparation: 'pending', foodUse: 'pending', catalog: 'pending' }
    }
  };
}

function input() {
  return {
    schemaVersion: "1.1.0", rulesVersion: '1.6.0', contentVersion: "historical-2026-08", catalogAsOf: "2026-08-10",
    boundaryNotice: "非医疗食养教育资料", ingredients: [ingredient(), {
      ...ingredient("shan-yao", "山药"), pinyin: "shan yao", aliases: ["薯蓣"],
      partText: "根茎", latinName: "Dioscorea polystachya", partReview: "pending"
    }]
  };
}

test("parses immutable public fields without granting review or images", () => {
  const result = parseCatalog(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = findIngredient(result.catalog, "bai-he");
  assert.ok(item);
  assert.equal(item.professionalReview, "pending");
  assert.equal(item.image, null);
  assert.equal(result.catalog.catalogAsOf, "2026-08-10");
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.sources));
  assert.ok(Object.isFrozen(item.sources[0]));
  assert.ok(Object.isFrozen(result.catalog.ingredients));
});

test("rejects malformed nested content, private fields and unsupported approval", () => {
  const variations = [
    { ...input(), internalApproval: "private" },
    { ...input(), ingredients: [{ ...ingredient(), privateExcerpt: "private" }] },
    { ...input(), ingredients: [{ ...ingredient(), professionalReview: "approved" }] },
    { ...input(), ingredients: [{ ...ingredient(), image: "candidate.jpg" }] },
    { ...input(), rulesVersion: 'unrecognized' },
    { ...input(), ingredients: [{ ...ingredient(), safety: { ...ingredient().safety, privateNotes: 'private' } }] },
    { ...input(), ingredients: [{ ...ingredient(), safety: { ...ingredient().safety, population: { ...ingredient().safety.population, pregnancy: 'yes' } } }] },
    { ...input(), ingredients: [{ ...ingredient(), safety: { ...ingredient().safety, drugInteractions: [42] } }] },
    { ...input(), ingredients: [{ ...ingredient(), riskNotes: [] }] },
    { ...input(), ingredients: [{ ...ingredient(), aliases: [42] }] },
    { ...input(), ingredients: [{ ...ingredient(), aliases: new Array<unknown>(1) }] },
    { ...input(), ingredients: [{ ...ingredient(), sources: [{ ...ingredient().sources[0], secret: "not public" }] }] }
  ];
  for (const value of variations) assert.equal(parseCatalog(value).ok, false);
});

test("rejects duplicate identity, impossible dates and unsafe source addresses", () => {
  assert.equal(parseCatalog({ ...input(), ingredients: [ingredient(), ingredient()] }).ok, false);
  assert.equal(parseCatalog({ ...input(), catalogAsOf: "2026-02-30" }).ok, false);
  assert.equal(parseCatalog({ ...input(), schemaVersion: "2.0.0" }).ok, false);
  for (const url of ["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/\nprivate"]) {
    assert.equal(parseCatalog({ ...input(), ingredients: [{ ...ingredient(), sources: [{ id: "source", title: "title", publisher: "publisher", url, checkedAt: "2026-08-09" }] }] }).ok, false);
  }
});

test("searches names, aliases, pinyin, Latin identity and multiple identity terms", () => {
  const result = parseCatalog(input());
  assert.ok(result.ok);
  for (const query of ["百合", "百合鳞茎", "baihe", "BAI HE", "bai-he", "Ｌｉｌｉｕｍ", "百合 干制品"]) {
    assert.deepEqual(searchCatalog(result.catalog, query).map((item) => item.id), ["bai-he"], query);
  }
  assert.equal(searchCatalog(result.catalog, "  ").length, 2);
  assert.equal(searchCatalog(result.catalog, "无此条目").length, 0);
  assert.equal(findIngredient(result.catalog, "missing"), undefined);
  assert.equal(searchCatalog(result.catalog, "专业审校").length, 0);
});

test("common mulberry spelling finds the existing public record without changing its identity or review", () => {
  const result = parseCatalog(JSON.parse(readFileSync(new URL('../../../apps/miniprogram/src/data/catalog.json', import.meta.url), 'utf8')) as unknown);
  assert.ok(result.ok);
  const snapshot = JSON.stringify(result.catalog), target = findIngredient(result.catalog, 'sang-shen'); assert.ok(target);
  for (const query of ['桑葚', ' 桑葚 ', '桑葚 sang shen', '桑椹', 'sangshen', 'SANG SHEN']) {
    const found = searchCatalog(result.catalog, query);
    assert.deepEqual(found.map(item => item.id), ['sang-shen'], query);
    assert.equal(found[0], target); assert.equal(found[0]?.name, '桑椹'); assert.equal(found[0]?.professionalReview, 'pending'); assert.equal(found[0]?.image, null);
  }
  assert.equal(searchCatalog(result.catalog, '桑葚 百合').length, 0);
  assert.equal(searchCatalog(result.catalog, '桑葚 桑叶').length, 0);
  assert.deepEqual(searchCatalog(result.catalog, '桑叶').map(item => item.id), ['sang-ye']);
  assert.equal(JSON.stringify(result.catalog), snapshot, 'search must not inject aliases, sources or approval into catalog data');
});

test("a discovery spelling is bound to both the expected record ID and catalog name", () => {
  for (const [id, name] of [['sang-ye', '桑椹'], ['sang-shen', '桑叶'], ['other-mulberry', '其他桑果']]) {
    const result = parseCatalog({...input(), ingredients: [{...ingredient(id, name), aliases: [], pinyin: 'placeholder', latinName: null, partText: '未知', processingForms: []}]}); assert.ok(result.ok);
    assert.equal(searchCatalog(result.catalog, '桑葚').length, 0, `${id}/${name}`);
  }
});

test("comparison keeps ordering, visible uncertainty and actual field differences", () => {
  const first = ingredient();
  const second = { ...ingredient("shan-yao", "山药"), partText: "根茎", latinName: null };
  const rows = buildComparison([second, first]);
  assert.deepEqual(rows.find((row) => row.id === "name")?.values, ["山药", "百合"]);
  assert.deepEqual(rows.find((row) => row.id === "latin-name")?.values, ["待确认", "Lilium brownii"]);
  assert.deepEqual(rows.find((row) => row.id === "review")?.values, ["待完成", "待完成"]);
  const different = buildComparison([second, first], { differencesOnly: true });
  assert.ok(different.some((row) => row.id === "part"));
  assert.ok(!different.some((row) => row.id === "review"));
  assert.ok(different.every((row) => row.different));
  assert.deepEqual(buildComparison([]), []);
  assert.throws(() => buildComparison([first, first]), /重复/);
  assert.throws(() => buildComparison(["a", "b", "c", "d", "e"].map((id) => ingredient(id))), /4/);
});
