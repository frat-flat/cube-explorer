// 設計書 6. CubeSpec / 9. API設計 の型。用語は設計書「2. 用語定義」に揃える
import type { TimeGrain } from "@/lib/meta/axes";
import type { Agg } from "@/lib/meta/facts";

export type AxisRef = { key: string; grain?: TimeGrain };

export type Filter =
  | { axis: string; op: "eq"; value: string }
  | { axis: string; op: "in"; value: string[] }
  | { axis: string; op: "between"; value: [string, string] };

export type CubeSpec = {
  fact: string;
  axes: [AxisRef, AxisRef, AxisRef]; // x, y, z(奥行き)
  measure: { key: string; agg: Agg };
  filters: Filter[];
  limits?: { perAxis?: number };
};

export type AxisIndex = 0 | 1 | 2;

export type FaceRequest = {
  spec: CubeSpec;
  view: { rows: AxisIndex; cols: AxisIndex };
  depth: { mode: "aggregate" } | { mode: "slice"; member: string };
};

export type Member = { key: string; label: string };

export type CellValue =
  | { type: "number"; value: number }
  | { type: "text"; value: string; count: number }
  | { type: "list"; items: string[]; more: number };

export type FaceResponse = {
  rows: Member[];
  cols: Member[];
  cells: (CellValue | null)[][];
  meta: {
    truncated: boolean;
    totalMembers: Record<string, number>;
    depthMembers: Member[];
  };
};

export const MAX_PER_AXIS = 50;
