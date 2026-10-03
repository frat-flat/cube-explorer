// 設計書 2. 用語定義「軸(Axis)」・5.2 cube_meta.axes
export type AxisKind = "entity" | "attribute" | "time" | "columns";
export type TimeGrain = "day" | "week" | "month" | "year";

export type Axis = {
  key: string;
  label: string;
  kind: AxisKind;
  sourceTable: string | null;
  sourceColumn: string | null;
  labelColumn: string | null;
  timeGrain: TimeGrain | null;
  masterKey: string | null;
};

export type AxisRow = {
  key: string;
  label: string;
  kind: string;
  source_table: string | null;
  source_column: string | null;
  label_column: string | null;
  time_grain: string | null;
  master_key: string | null;
};

export function toAxis(row: AxisRow): Axis {
  return {
    key: row.key,
    label: row.label,
    kind: row.kind as AxisKind,
    sourceTable: row.source_table,
    sourceColumn: row.source_column,
    labelColumn: row.label_column,
    timeGrain: row.time_grain as TimeGrain | null,
    masterKey: row.master_key,
  };
}
