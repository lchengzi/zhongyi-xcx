import type { Ingredient } from "./catalog.js";

export const COMPARE_LIMIT = 4;
export const COMPARE_NOTICE = "对比展示各条目的单项资料，不表示这些食材可以同时食用。";

export interface ComparisonRow {
  readonly id: string;
  readonly label: string;
  readonly values: readonly string[];
  readonly different: boolean;
}

interface ComparisonField {
  readonly id: string;
  readonly label: string;
  readonly value: (ingredient: Ingredient) => string;
}

const FIELDS: readonly ComparisonField[] = [
  { id: "name", label: "名称", value: (item) => item.name },
  { id: "aliases", label: "别名", value: (item) => item.aliases.join("、") || "暂无别名" },
  { id: "latin-name", label: "拉丁学名", value: (item) => item.latinName ?? "待确认" },
  { id: "part", label: "目录记录部位", value: (item) => item.partText },
  { id: "part-review", label: "部位资料", value: (item) => item.partReview === "source_checked" ? "历史部位来源已核对，专业复核待完成" : "部位资料待复核" },
  { id: "forms", label: "加工形态", value: (item) => item.processingForms.join("、") || "待确认" },
  { id: "processing", label: "加工资料说明", value: (item) => item.processingNote },
  { id: "restriction", label: "用途边界", value: (item) => item.restriction },
  { id: "risk", label: "风险提示", value: (item) => item.riskNotes.join("\n") },
  { id: "sources", label: "资料来源", value: (item) => item.sources.map((source) => source.title).join("\n") },
  { id: "source-date", label: "来源核对日期", value: (item) => item.sourceCheckedAt ?? "待确认" },
  { id: "review", label: "专业审校", value: () => "待完成" }
];

export function buildComparison(
  items: readonly Ingredient[],
  options: { readonly differencesOnly?: boolean } = {}
): readonly ComparisonRow[] {
  if (items.length > COMPARE_LIMIT) throw new RangeError(`最多对比 ${COMPARE_LIMIT} 项资料`);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("对比条目不能重复");
  if (items.length === 0) return [];
  return FIELDS.map((field) => {
    const values = Object.freeze(items.map(field.value));
    return Object.freeze({ id: field.id, label: field.label, values, different: new Set(values).size > 1 });
  }).filter((row) => !options.differencesOnly || row.different);
}
