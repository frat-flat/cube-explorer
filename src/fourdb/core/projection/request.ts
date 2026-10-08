// 画面から届いた集計の指定(JSON)を、形を確かめてから ProjectionRequest にする。形が違えば理由を返す。
import type { AxisSpec, ProjectionFn, ProjectionRequest } from "./types";

const FNS: ProjectionFn[] = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
/** 絞り込みで選べる軸の値の数(すべての絞り込みの合計)。重い集計と大きな定義を防ぐ */
export const MAX_FILTER_MEMBERS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
const isLevel = (x: unknown): x is number | null => x === null || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 20);

function axis(x: unknown, where: string, allowSubtotal: boolean): AxisSpec | null | string {
  if (x === null || x === undefined) return null;
  if (typeof x !== "object") return `${where}の形が違います`;
  const a = x as Record<string, unknown>;
  if (!isId(a.dimensionId)) return `${where}の軸が違います`;
  if (!isLevel(a.level)) return `${where}の段が違います`;
  const sub = a.subtotalLevel ?? null;
  if (!isLevel(sub)) return `${where}の小計の段が違います`;
  if (sub !== null) {
    if (!allowSubtotal) return `${where}には小計を入れられません`;
    if (a.level === null || sub >= (a.level as number)) return `${where}の小計は、並べる段より上の段にしてください`;
  }
  return { dimensionId: a.dimensionId, level: a.level as number | null, subtotalLevel: sub };
}

export function parseProjectionRequest(x: unknown): ProjectionRequest | string {
  if (!x || typeof x !== "object") return "集計の指定がありません";
  const r = x as Record<string, unknown>;
  if (!isId(r.measureId)) return "数値のカラムを選んでください";
  if (!FNS.includes(r.fn as ProjectionFn)) return "集計のしかたが違います";
  const rows = axis(r.rows, "行", true);
  if (typeof rows === "string") return rows;
  const columns = axis(r.columns, "列", false);
  if (typeof columns === "string") return columns;
  if (rows && columns && rows.dimensionId === columns.dimensionId) return "行と列には別の軸を選んでください";
  if (!Array.isArray(r.filters) || r.filters.length > 20) return "絞り込みの形が違います";
  const filters: ProjectionRequest["filters"] = [];
  for (const f of r.filters) {
    const o = f as Record<string, unknown>;
    if (!isId(o?.dimensionId) || !Array.isArray(o.memberIds) || o.memberIds.length === 0 || o.memberIds.length > 500 || !o.memberIds.every(isId)) {
      return "絞り込みの形が違います";
    }
    if (filters.some((x) => x.dimensionId === o.dimensionId)) return "同じ軸の絞り込みが2つあります。1つにまとめてください";
    filters.push({ dimensionId: o.dimensionId, memberIds: o.memberIds as string[] });
  }
  if (filters.reduce((n, x) => n + x.memberIds.length, 0) > MAX_FILTER_MEMBERS) return `絞り込みで選べる軸の値は、合わせて ${MAX_FILTER_MEMBERS} 個までです`;
  let sheetIds: string[] | null = null;
  if (r.sheetIds !== null && r.sheetIds !== undefined) {
    if (!Array.isArray(r.sheetIds) || r.sheetIds.length > 500 || !r.sheetIds.every(isId)) return "対象の表の形が違います";
    sheetIds = r.sheetIds as string[];
  }
  return { measureId: r.measureId, fn: r.fn as ProjectionFn, rows, columns, filters, sheetIds };
}
