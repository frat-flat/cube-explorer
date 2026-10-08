// SQL の集計結果(GROUPING SETS の行)を、表の形(行・列・小計・合計)に組み立てる。データベースには触らない。
import type { AggRow, CellKind, MemberInfo, ProjCell, ProjectionRequest, ProjectionResult } from "./types";

/** 軸の値のない値(その軸を持たない値)をまとめる行・列の名前 */
export const NONE_NAME = "(なし)";

const EMPTY: ProjCell = { v: null, n: 0, kind: null };

const kindOf = (n: number, calc: number): CellKind | null => (n === 0 ? null : calc === 0 ? "raw" : calc === n ? "calculated" : "mixed");
const cellOf = (a: AggRow | undefined): ProjCell => (a ? { v: a.v, n: a.n, kind: kindOf(a.n, a.calc) } : EMPTY);

/** 並べ方: 並び順 → 期間の始まり → 名前。軸の値のないもの(null)は最後 */
export function compareMembers(a: MemberInfo | null, b: MemberInfo | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.sortOrder !== null || b.sortOrder !== null) {
    if (a.sortOrder === null) return 1;
    if (b.sortOrder === null) return -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  }
  if (a.periodStart && b.periodStart && a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? -1 : 1;
  return a.name.localeCompare(b.name, "ja");
}

export function shapeProjection(req: ProjectionRequest, agg: AggRow[], members: Map<string, MemberInfo>): ProjectionResult {
  const hasRows = req.rows !== null;
  const hasCols = req.columns !== null;
  const hasSub = hasRows && req.rows!.subtotalLevel !== null;
  const info = (id: string | null) => (id === null ? null : members.get(id) ?? { id, name: id, sortOrder: null, periodStart: null });
  const nameOf = (id: string | null) => (id === null ? NONE_NAME : info(id)!.name);
  const k = (...xs: (string | null)[]) => xs.map((x) => x ?? "\u0000").join("\u0001");

  // 明細(行 × 列)・行の合計・列の合計・小計・総計を、GROUPING の組み合わせで分ける
  const detail = new Map<string, AggRow>();
  const rowTotal = new Map<string, AggRow>();
  const colTotal = new Map<string, AggRow>();
  const subCell = new Map<string, AggRow>();
  const subTotal = new Map<string, AggRow>();
  let grand: AggRow | undefined;
  const groupOfRow = new Map<string, string | null>();
  for (const a of agg) {
    if (!a.gr && !a.gc) {
      detail.set(k(a.r, a.c), a);
      if (hasSub) groupOfRow.set(k(a.r), a.s);
    } else if (!a.gr && a.gc) rowTotal.set(k(a.r), a);
    else if (a.gr && !a.gc && (!hasSub || a.gs)) colTotal.set(k(a.c), a);
    else if (a.gr && !a.gc && hasSub && !a.gs) subCell.set(k(a.s, a.c), a);
    else if (a.gr && a.gc && hasSub && !a.gs) subTotal.set(k(a.s), a);
    else if (a.gr && a.gc && (!hasSub || a.gs)) grand = a;
  }

  // 行と列の並び
  const rowIds = hasRows ? [...new Set([...detail.values()].map((a) => a.r))] : [null];
  const colIds = hasCols ? [...new Set([...detail.values()].map((a) => a.c))] : [null];
  colIds.sort((a, b) => compareMembers(info(a), info(b)));
  if (hasSub) {
    rowIds.sort((a, b) => compareMembers(info(groupOfRow.get(k(a)) ?? null), info(groupOfRow.get(k(b)) ?? null)) || compareMembers(info(a), info(b)));
  } else {
    rowIds.sort((a, b) => compareMembers(info(a), info(b)));
  }

  const rows = rowIds.map((r) => ({ key: r, name: hasRows ? nameOf(r) : "(全体)", group: hasSub ? groupOfRow.get(k(r)) ?? null : null }));
  const columns = colIds.map((c) => ({ key: c, name: hasCols ? nameOf(c) : "値" }));
  const cells = rowIds.map((r) => colIds.map((c) => cellOf(detail.get(k(r, c)))));
  const groups = hasSub ? [...new Set(rows.map((r) => r.group))] : [];
  return {
    rows,
    columns,
    cells,
    rowTotals: hasCols ? rowIds.map((r) => cellOf(rowTotal.get(k(r)))) : null,
    columnTotals: hasRows ? colIds.map((c) => cellOf(colTotal.get(k(c)))) : null,
    grand: cellOf(grand),
    subtotals: groups.map((g) => ({
      key: g,
      name: nameOf(g),
      cells: colIds.map((c) => cellOf(subCell.get(k(g, c)))),
      total: hasCols ? cellOf(subTotal.get(k(g))) : null,
    })),
    valueCount: grand?.n ?? 0,
  };
}
