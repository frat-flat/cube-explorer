import type { Axis } from "@/lib/meta/axes";
import type { Fact } from "@/lib/meta/facts";
import type { Meta } from "@/lib/meta/load";
import type { FaceRequest } from "../types";

const axis = (a: Partial<Axis> & Pick<Axis, "key" | "label" | "kind">): Axis => ({
  sourceTable: null,
  sourceColumn: null,
  labelColumn: null,
  keyColumn: null,
  timeGrain: null,
  masterKey: null,
  ...a,
});

// supabase/seed.sql のサンプル定義と同じ形
export const axes: Axis[] = [
  axis({ key: "store", label: "店舗", kind: "entity", sourceTable: "stores", sourceColumn: "id", labelColumn: "name", keyColumn: "id" }),
  axis({ key: "product", label: "商品", kind: "entity", sourceTable: "products", sourceColumn: "id", labelColumn: "name", keyColumn: "id" }),
  axis({ key: "product_category", label: "商品カテゴリ", kind: "attribute", sourceTable: "products", sourceColumn: "category", keyColumn: "id" }),
  axis({ key: "note_category", label: "引き継ぎカテゴリ", kind: "attribute", sourceTable: "store_handover_notes", sourceColumn: "category" }),
  axis({ key: "month", label: "月", kind: "time", timeGrain: "month" }),
  axis({ key: "store_item", label: "項目", kind: "columns", sourceTable: "stores" }),
];

export const facts: Fact[] = [
  {
    key: "sales",
    label: "売上",
    sourceTable: "sales",
    axisColumns: { store: "store_id", product: "product_id", product_category: "product_id", month: "sold_at", store_item: "store_id" },
    measures: [
      { key: "amount", label: "売上金額", column: "amount", type: "number", aggs: ["sum", "avg", "count", "min", "max"] },
    ],
  },
  {
    key: "handover_notes",
    label: "引き継ぎメモ",
    sourceTable: "store_handover_notes",
    axisColumns: { store: "store_id", note_category: "category", month: "written_at" },
    measures: [{ key: "content", label: "内容", column: "content", type: "text", aggs: ["count", "latest", "list"] }],
  },
];

export const meta: Meta = {
  axes: new Map(axes.map((a) => [a.key, a])),
  facts: new Map(facts.map((f) => [f.key, f])),
};

/** 店舗 × 月(奥行き:商品カテゴリを集約)の売上合計 */
export function faceRequest(overrides: Partial<FaceRequest> = {}): FaceRequest {
  return {
    spec: {
      fact: "sales",
      axes: [{ key: "store" }, { key: "month" }, { key: "product_category" }],
      measure: { key: "amount", agg: "sum" },
      filters: [],
    },
    view: { rows: 0, cols: 1 },
    depth: { mode: "aggregate" },
    ...overrides,
  };
}
