// Projection Engine(② 21章)の入力と出力。Sheet と Cube で同じものを使う(SheetとCubeで別々の計算ロジックを作らない。② 30章-7)。
// 合計・小計は軸の値ではなく、集計(Aggregation)として出す(② 30章-2)。

export type ProjectionFn = "SUM" | "COUNT" | "AVG" | "MIN" | "MAX";

/** 軸: どの Dimension を、どの段で並べるか。level が null なら、値が持っている軸の値のまま(いちばん細かい段) */
export type AxisSpec = {
  dimensionId: string;
  level: number | null;
  /** 小計を入れる上の段(行だけ)。例: 店舗(段 1)で並べ、法人(段 0)ごとに小計 */
  subtotalLevel: number | null;
};

export type ProjectionRequest = {
  /** 数値のカラム(Column Registry の measure) */
  measureId: string;
  fn: ProjectionFn;
  rows: AxisSpec | null;
  columns: AxisSpec | null;
  /** 絞り込み: その軸の値(またはその子孫)を持つ値だけ。上の段の値を選べば、その中の全部 */
  filters: { dimensionId: string; memberIds: string[] }[];
  /** 対象の表(タブ)。null ならすべて */
  sheetIds: string[] | null;
};

/** 表が大きくなりすぎないように(② 25章 Scale)。超えたら段を上げるか絞るよう知らせる */
export const PROJECTION_LIMITS = { rows: 5000, columns: 400, cells: 200_000 };

/** raw = 元の値だけ / calculated = スプシの関数で計算された値だけ / mixed = 両方 */
export type CellKind = "raw" | "calculated" | "mixed";
export type ProjCell = { v: number | null; n: number; kind: CellKind | null };

export type ProjectionResult = {
  rows: { key: string | null; name: string; group: string | null }[];
  columns: { key: string | null; name: string }[];
  /** [行][列] */
  cells: ProjCell[][];
  /** 行ごとの合計(列の軸があるとき) */
  rowTotals: ProjCell[] | null;
  /** 列ごとの合計(行の軸があるとき) */
  columnTotals: ProjCell[] | null;
  grand: ProjCell;
  /** 小計(行の並びの中で、その群の最後の行のあとに出す) */
  subtotals: { key: string | null; name: string; cells: ProjCell[]; total: ProjCell | null }[];
  /** 集計した値の数 */
  valueCount: number;
};

/** SQL の集計結果の1行(GROUPING SETS)。gr・gc・gs は 1 なら「その軸をまとめた行」 */
export type AggRow = { r: string | null; c: string | null; s: string | null; gr: number; gc: number; gs: number; v: number | null; n: number; calc: number };

export type MemberInfo = { id: string; name: string; sortOrder: number | null; periodStart: string | null };
