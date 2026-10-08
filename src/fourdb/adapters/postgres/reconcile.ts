// 照合: スプシに書かれていた合計と、4D Base が元の値から計算した合計を見比べる(完了条件 4)。
// 合計の列(行ごと): その列が足している列(さらに合計の列なら、その中身)の値を、同じ行で足す。
// 合計の行(列ごと): 関数があれば関数が指す行(小計の行はその中身に開く。SUBTOTAL は小計を数えない)を、
//                   なければ前の合計の行の次から今の行までのデータの行を足す。
import { colLetter } from "@/fourdb/core/import/a1";
import { classifyFormula } from "@/fourdb/core/import/formulas";
import type { Tx } from "./db";
import { ImportError } from "./import-store";

const EPS = 0.005;
const MAX_LIST = 50;

export type Mismatch = { where: string; sheet: number; computed: number };
export type ReconcileGroup = { label: string; checked: number; matched: number; mismatches: Mismatch[] };
export type ReconcileResult = {
  sheet: { id: string; title: string };
  columns: ReconcileGroup[];
  rows: ReconcileGroup[];
  summary: { checked: number; matched: number };
};

type Col = { id: string; col_index: number; header: string; role: string; detail: { sums?: number[] | null } | null };

const rowLabel = (key: string, index: number) => (key.startsWith("#") ? `${index + 1} 行目` : `${index + 1} 行目(${key})`);

/** つながった・重なった範囲をまとめる */
function mergeRanges(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export async function reconcile(tx: Tx, sheetId: string): Promise<ReconcileResult> {
  const [sheet] = await tx<{ id: string; title: string }[]>`select id, title from fourdb.source_sheet where id = ${sheetId} and deleted_at is null`;
  if (!sheet) throw new ImportError("表が見つかりません", 404);
  const cols = await tx<Col[]>`select id, col_index, header, role, detail from fourdb.source_column where sheet_id = ${sheetId} and system_to is null order by col_index`;
  const byIndex = new Map(cols.map((c) => [c.col_index, c]));
  const colById = new Map(cols.map((c) => [Number(c.id), c]));

  /** 合計の列を、元の数値の列の集まりに開く(合計の合計も開く) */
  const leaves = (index: number, seen = new Set<number>()): number[] => {
    const c = byIndex.get(index);
    if (!c || seen.has(index)) return [];
    seen.add(index);
    if (c.role === "measure") return [index];
    if (c.role === "aggregate") return [...new Set((c.detail?.sums ?? []).flatMap((i) => leaves(i, seen)))];
    return [];
  };
  const idsOf = (indexes: number[]) => indexes.map((i) => Number(byIndex.get(i)!.id));

  // ---------- 合計の列(行ごと) ----------
  const columns: ReconcileGroup[] = [];
  for (const c of cols.filter((x) => x.role === "aggregate")) {
    const leafIds = idsOf(leaves(c.col_index));
    const rows = await tx<{ row_key: string; row_index: number; sheet: string; computed: string }[]>`
      select r.row_key, r.row_index, t.num as sheet, coalesce(sum(v.num), 0) as computed
        from fourdb.source_total t
        join fourdb.record r on r.id = t.record_id and r.kind = 'data' and r.system_to is null
        left join fourdb.value v on v.record_id = t.record_id and v.system_to is null and v.column_id = any(${leafIds}::bigint[])
       where t.column_id = ${c.id} and t.system_to is null and t.num is not null
       group by r.row_key, r.row_index, t.num
       order by r.row_index`;
    const g: ReconcileGroup = { label: `${colLetter(c.col_index)} 列「${c.header}」`, checked: rows.length, matched: 0, mismatches: [] };
    for (const r of rows) {
      const s = Number(r.sheet), k = Number(r.computed);
      if (Math.abs(s - k) < EPS) g.matched++;
      else if (g.mismatches.length < MAX_LIST) g.mismatches.push({ where: rowLabel(r.row_key, r.row_index), sheet: s, computed: k });
    }
    columns.push(g);
  }

  // ---------- 合計の行(列ごと) ----------
  const aggRows = await tx<{ id: string; row_key: string; row_index: number }[]>`
    select id, row_key, row_index from fourdb.record where sheet_id = ${sheetId} and kind = 'aggregate' and system_to is null order by row_index`;
  const totals = await tx<{ record_id: string; column_id: string; num: string | null; formula: string | null }[]>`
    select record_id, column_id, num, formula from fourdb.source_total
     where sheet_id = ${sheetId} and system_to is null and num is not null and record_id = any(${aggRows.map((r) => Number(r.id))}::bigint[])`;
  const recById = new Map(aggRows.map((r) => [Number(r.id), r]));
  const formulaAt = new Map<string, string | null>();   // "行:列" → 関数
  for (const t of totals) {
    const r = recById.get(Number(t.record_id));
    const c = colById.get(Number(t.column_id));
    if (r && c) formulaAt.set(`${r.row_index}:${c.col_index}`, t.formula);
  }
  const aggIndexes = new Set(aggRows.map((r) => r.row_index));
  const prevAgg = new Map<number, number>();
  aggRows.forEach((r, i) => prevAgg.set(r.row_index, i ? aggRows[i - 1].row_index : -1));

  const rangesFor = (row: number, col: number, seen = new Set<string>()): [number, number][] => {
    const key = `${row}:${col}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const formula = formulaAt.get(key);
    const f = formula ? classifyFormula(formula, { row, col }) : null;
    if (!f || f.type !== "aggregate" || f.direction !== "column") return [[(prevAgg.get(row) ?? -1) + 1, row - 1]];
    const out: [number, number][] = [];
    for (const r of new Set(f.cells.map((x) => x.row))) {
      if (!aggIndexes.has(r)) out.push([r, r]);
      else if (!f.skipsSubtotals) out.push(...rangesFor(r, col, seen));
    }
    return mergeRanges(out);
  };

  // 合計の行のセルごとに「足す行の範囲」と「足す列」を作り、まとめて1本の SQL で計算する(合計の行が多くても SQL は1本)
  type Item = { record: number; col: Col; sheet: number };
  const items: Item[] = [];
  const rg = { item: [] as number[], a: [] as number[], b: [] as number[] };
  const lc = { item: [] as number[], col: [] as number[] };
  for (const t of totals) {
    const col = colById.get(Number(t.column_id));
    const ar = recById.get(Number(t.record_id));
    if (!col || !ar) continue;
    const ranges = rangesFor(ar.row_index, col.col_index).filter(([a, b]) => a <= b);
    const leafIds = idsOf(leaves(col.col_index));
    if (!ranges.length || !leafIds.length) continue;
    const i = items.push({ record: Number(t.record_id), col, sheet: Number(t.num) }) - 1;
    for (const [a, b] of ranges) { rg.item.push(i); rg.a.push(a); rg.b.push(b); }
    for (const c of leafIds) { lc.item.push(i); lc.col.push(c); }
  }
  const sums = new Map<number, number>();
  if (items.length) {
    const res = await tx<{ item: number; computed: string }[]>`
      with rg as (select * from unnest(${rg.item}::int[], ${rg.a}::int[], ${rg.b}::int[]) as x(item, a, b)),
           lc as (select * from unnest(${lc.item}::int[], ${lc.col}::bigint[]) as y(item, col))
      select rg.item, coalesce(sum(v.num), 0) as computed
        from rg
        join fourdb.record r on r.sheet_id = ${sheetId} and r.kind = 'data' and r.system_to is null and r.row_index between rg.a and rg.b
        join lc on lc.item = rg.item
        join fourdb.value v on v.record_id = r.id and v.column_id = lc.col and v.system_to is null
       group by rg.item`;
    for (const r of res) sums.set(r.item, Number(r.computed));
  }
  const rows: ReconcileGroup[] = aggRows.map((ar) => ({ label: rowLabel(ar.row_key, ar.row_index), checked: 0, matched: 0, mismatches: [] }));
  const groupOf = new Map(aggRows.map((ar, i) => [Number(ar.id), rows[i]]));
  items.forEach((it, i) => {
    const g = groupOf.get(it.record)!;
    const k = sums.get(i) ?? 0;
    g.checked++;
    if (Math.abs(it.sheet - k) < EPS) g.matched++;
    else if (g.mismatches.length < MAX_LIST) g.mismatches.push({ where: `${colLetter(it.col.col_index)} 列「${it.col.header}」`, sheet: it.sheet, computed: k });
  });

  const all = [...columns, ...rows];
  return { sheet, columns, rows, summary: { checked: all.reduce((a, g) => a + g.checked, 0), matched: all.reduce((a, g) => a + g.matched, 0) } };
}
