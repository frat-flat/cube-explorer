// 画面から届いた承認の内容(JSON)を、形を確かめてから ApprovalSpec にする。形が違えば理由を返す。
// 中身の矛盾(同じ軸を2か所で決める など)は validateSpec で確かめる。
import type { AggregateFn } from "./formulas";
import type { ApprovalSpec, ColumnApproval } from "./plan";

const MAX_COLUMNS = 2000;
const MAX_NAME = 100;
const FNS: AggregateFn[] = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

const isInt = (x: unknown, max = 10_000_000): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;
const isName = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= MAX_NAME;
const ints = (x: unknown, max?: number): number[] | null => (Array.isArray(x) && x.length <= MAX_COLUMNS && x.every((v) => isInt(v, max)) ? (x as number[]) : null);

function column(x: unknown): ColumnApproval | string {
  if (!x || typeof x !== "object") return "列の形が違います";
  const c = x as Record<string, unknown>;
  if (!isInt(c.index, MAX_COLUMNS)) return "列の番号が違います";
  const index = c.index;
  switch (c.role) {
    case "ignore":
      return { index, role: "ignore" };
    case "dimension":
      return isName(c.dimension) && isName(c.definition) ? { index, role: "dimension", dimension: c.dimension.trim(), definition: c.definition.trim() } : `列 ${index}: 軸とカラムの名前を入れてください`;
    case "measure":
      if (!isName(c.definition)) return `列 ${index}: カラムの名前を入れてください`;
      if (c.month !== null && typeof c.month !== "string") return `列 ${index}: 月の形が違います`;
      return { index, role: "measure", definition: c.definition.trim(), month: (c.month as string | null) || null };
    case "attribute":
      return isName(c.definition) ? { index, role: "attribute", definition: c.definition.trim() } : `列 ${index}: カラムの名前を入れてください`;
    case "aggregate": {
      const sums = ints(c.sums, MAX_COLUMNS);
      if (!FNS.includes(c.fn as AggregateFn) || !sums) return `列 ${index}: 合計の形が違います`;
      if (c.definition !== null && !isName(c.definition)) return `列 ${index}: カラムの名前が違います`;
      return { index, role: "aggregate", fn: c.fn as AggregateFn, definition: (c.definition as string | null)?.trim() ?? null, sums };
    }
    default:
      return `列 ${index}: 扱いが違います`;
  }
}

export function parseSpec(x: unknown): ApprovalSpec | string {
  if (!x || typeof x !== "object") return "承認の内容がありません";
  const s = x as Record<string, unknown>;
  if (!isInt(s.headerRow, 1000)) return "列名の行が違います";
  if (s.groupRow !== null && !isInt(s.groupRow, 1000)) return "グループ名の行が違います";
  const rowKeyColumns = ints(s.rowKeyColumns, MAX_COLUMNS);
  if (!rowKeyColumns) return "行を見分ける列が違います";
  if (s.entityColumn !== null && !isInt(s.entityColumn, MAX_COLUMNS)) return "行が表す実体の列が違います";
  if (!Array.isArray(s.columns) || s.columns.length > MAX_COLUMNS) return "列の一覧が違います";
  const columns: ColumnApproval[] = [];
  for (const c of s.columns) {
    const r = column(c);
    if (typeof r === "string") return r;
    columns.push(r);
  }
  const a = s.aggregateRows as Record<string, unknown> | undefined;
  const include = ints(a?.include);
  const exclude = ints(a?.exclude);
  if (!a || typeof a.auto !== "boolean" || !include || !exclude) return "合計の行の指定が違います";
  if (!Array.isArray(s.sheetCoords) || s.sheetCoords.length > 50) return "表全体の軸の値が違います";
  const sheetCoords: ApprovalSpec["sheetCoords"] = [];
  for (const c of s.sheetCoords) {
    const o = c as Record<string, unknown>;
    if (!isName(o?.dimension) || !isName(o?.member)) return "表全体の軸の値には、軸と値の両方を入れてください";
    sheetCoords.push({ dimension: o.dimension.trim(), member: o.member.trim() });
  }
  return {
    headerRow: s.headerRow as number,
    groupRow: s.groupRow as number | null,
    rowKeyColumns,
    entityColumn: s.entityColumn as number | null,
    columns,
    aggregateRows: { auto: a.auto, include, exclude },
    sheetCoords,
  };
}
