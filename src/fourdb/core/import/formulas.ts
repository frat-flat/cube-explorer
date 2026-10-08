// セルの関数を見分ける。合計(同じタブのセルを足しただけ)なら aggregate、それ以外は calculated。
// 合計は「どのセルを足したか」と向き(row = 同じ行の列を足す → 合計の列 / column = 同じ列の行を足す → 合計の行)を返す。
import { parseRangeRef, type CellRef } from "./a1";

export type AggregateFn = "SUM" | "COUNT" | "AVG" | "MIN" | "MAX";

export type FormulaInfo =
  /** skipsSubtotals: SUBTOTAL 関数(範囲の中の小計の行を数えない) */
  | { type: "aggregate"; fn: AggregateFn; direction: "row" | "column" | "block"; cells: CellRef[]; skipsSubtotals: boolean }
  | { type: "calculated" };

const FN: Record<string, AggregateFn> = { SUM: "SUM", AVERAGE: "AVG", COUNT: "COUNT", COUNTA: "COUNT", MIN: "MIN", MAX: "MAX" };
const REF = String.raw`\$?[A-Z]{1,3}\$?\d{1,7}`;
const RANGE = `${REF}(?::${REF})?`;
/** 足すだけの式の中身として広げてよいセルの数の上限(大きすぎる範囲は合計の判定に使わない) */
const MAX_CELLS = 5000;

function expand(args: string[]): CellRef[] | null {
  const out: CellRef[] = [];
  for (const a of args) {
    const r = parseRangeRef(a);
    if (!r) return null;
    if ((r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1) + out.length > MAX_CELLS) return null;
    for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) out.push({ col, row });
  }
  return out;
}

/** 関数のセル(row, col は 0 始まり)を見分ける。f は '=' から始まる文字列 */
export function classifyFormula(f: string, at: CellRef): FormulaInfo {
  const s = f.trim().replace(/^=/, "").replace(/\s+/g, "").toUpperCase();
  // 別のタブ・別のファイルを見る式、文字列を含む式は「計算」とする
  if (!s || s.includes("!") || s.includes('"')) return { type: "calculated" };

  let fn: AggregateFn | null = null;
  let args: string[] | null = null;
  let skipsSubtotals = false;
  const call = s.match(/^([A-Z]+)\((.*)\)$/);
  if (call) {
    const name = call[1];
    let inner = call[2];
    if (name === "SUBTOTAL") {
      skipsSubtotals = true;
      const sub = inner.match(/^(\d+),(.*)$/);
      if (!sub) return { type: "calculated" };
      const code = Number(sub[1]) % 100;   // 9 と 109 は SUM、1 と 101 は AVERAGE …
      fn = ({ 1: "AVG", 2: "COUNT", 3: "COUNT", 4: "MAX", 5: "MIN", 9: "SUM" } as Record<number, AggregateFn>)[code] ?? null;
      inner = sub[2];
    } else {
      fn = FN[name] ?? null;
    }
    if (!fn || !new RegExp(`^${RANGE}(,${RANGE})*$`).test(inner)) return { type: "calculated" };
    args = inner.split(",");
  } else if (new RegExp(`^${REF}(\\+${REF})+$`).test(s)) {
    fn = "SUM";   // =B4+C4+D4 のように、セルを足すだけの式
    args = s.split("+");
  } else {
    return { type: "calculated" };
  }

  const cells = expand(args);
  if (!cells || cells.length === 0) return { type: "calculated" };
  if (cells.some((c) => c.row === at.row && c.col === at.col)) return { type: "calculated" };   // 自分を含む(循環)
  const sameRow = cells.every((c) => c.row === at.row);
  const sameCol = cells.every((c) => c.col === at.col);
  return { type: "aggregate", fn, direction: sameRow ? "row" : sameCol ? "column" : "block", cells, skipsSubtotals };
}
