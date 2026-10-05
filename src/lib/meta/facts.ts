// 設計書 5.2 cube_meta.facts
export type MeasureType = "number" | "text" | "datetime";
export type Agg = "sum" | "avg" | "count" | "min" | "max" | "latest" | "list";

export type Measure = {
  key: string;
  label: string;
  column: string;
  type: MeasureType;
  aggs: Agg[];
};

export type Fact = {
  key: string;
  label: string;
  sourceTable: string;
  axisColumns: Record<string, string>;
  measures: Measure[];
};

export type FactRow = {
  key: string;
  label: string;
  source_table: string;
  axis_columns: Record<string, string>;
  measures: Measure[];
};

export function toFact(row: FactRow): Fact {
  return {
    key: row.key,
    label: row.label,
    sourceTable: row.source_table,
    axisColumns: row.axis_columns,
    measures: row.measures,
  };
}
