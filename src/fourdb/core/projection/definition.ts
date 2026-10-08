// 表の定義(② 14章 SheetDefinition)と、集計の指定(ProjectionRequest)の行き来。保存は定義の形、集計は指定の形で行う。
import { parseProjectionRequest } from "./request";
import type { ProjectionRequest } from "./types";

export type SheetDefinitionDoc = {
  sources: string[] | null;
  rows: { dimensionId: string; level: number | null } | null;
  columns: { dimensionId: string; level: number | null } | null;
  measures: { measureId: string; fn: ProjectionRequest["fn"] }[];
  filters: ProjectionRequest["filters"];
  /** 小計: 行をどの上の段でまとめるか */
  subtotal_rules: { rows: number | null };
  /** 総計: 今は行・列とも出す(あとで出さない選択を足せるように持つ) */
  grand_total_rules: { rows: boolean; columns: boolean };
  sort_rules: unknown[];
  format_rules: Record<string, unknown>;
};

export function toDefinition(req: ProjectionRequest): SheetDefinitionDoc {
  return {
    sources: req.sheetIds,
    rows: req.rows && { dimensionId: req.rows.dimensionId, level: req.rows.level },
    columns: req.columns && { dimensionId: req.columns.dimensionId, level: req.columns.level },
    measures: [{ measureId: req.measureId, fn: req.fn }],
    filters: req.filters,
    subtotal_rules: { rows: req.rows?.subtotalLevel ?? null },
    grand_total_rules: { rows: true, columns: true },
    sort_rules: [],
    format_rules: {},
  };
}

/** 保存した定義を集計の指定に戻す(形が違えば理由) */
export function fromDefinition(def: unknown): ProjectionRequest | string {
  const d = def as Partial<SheetDefinitionDoc> | null;
  const m = d?.measures?.[0];
  return parseProjectionRequest({
    measureId: m?.measureId,
    fn: m?.fn,
    rows: d?.rows ? { ...d.rows, subtotalLevel: d.subtotal_rules?.rows ?? null } : null,
    columns: d?.columns ? { ...d.columns, subtotalLevel: null } : null,
    filters: d?.filters ?? [],
    sheetIds: d?.sources ?? null,
  });
}
