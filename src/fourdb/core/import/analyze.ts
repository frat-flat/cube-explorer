// 読み取った表から、承認の候補(列の役割・合計の行と列・計算されたセル・横並びの月・行を見分ける列)を作る。
// ここで決めるのは「候補」だけ。最後に決めるのは人(① 30章「Import 前に人間が承認する」)。
import { colLetter } from "./a1";
import { classifyFormula, type AggregateFn, type FormulaInfo } from "./formulas";
import { columnHeaders, detectLayout, type ColumnHeader, type Layout } from "./layout";
import { monthColumns } from "./months";
import { cellAt, EMPTY_CELL, type Merge, type SourceCell } from "./types";

export type ColumnRole = "dimension" | "measure" | "attribute" | "aggregate" | "ignore";

export type ColumnProposal = ColumnHeader & {
  role: ColumnRole;
  reasons: string[];
  /** 横に並んだ月の列なら YYYY-MM */
  month: string | null;
  /** 合計の列なら、何を足しているか */
  aggregate: { fn: AggregateFn; sums: number[]; evidence: "formula" | "values" | "header"; matchRate: number | null } | null;
  /** 関数で計算されたセルの割合(合計の関数は除く) */
  calculatedRate: number;
  numericRate: number;
  filledRate: number;
  distinctRate: number;
  samples: string[];
};

export type RowProposal = { index: number; kind: "aggregate"; reasons: string[] };

export type SheetProposal = {
  layout: Layout;
  width: number;
  columns: ColumnProposal[];
  /** 合計・小計の行(読み取った範囲の中で) */
  aggregateRows: RowProposal[];
  /** データの行の数(読み取った範囲の中で。合計の行と空の行を除く) */
  dataRowCount: number;
  /** 行を見分ける列(読み直しても同じ行だと分かる鍵)。なければ行番号を使う */
  rowKeyColumns: number[];
  calculatedCells: { row: number; col: number; formula: string }[];
  calculatedCellCount: number;
  warnings: string[];
};

/** 合計・小計を表す見出し */
export const TOTAL_LABEL = /(合計|小計|総計|累計|年計|月計|^計$|^total$|^subtotal$|grand\s*total)/i;
/** Box の属性(Card)になりやすい見出し */
const ATTRIBUTE_LABEL = /(住所|所在地|電話|TEL|メール|mail|URL|備考|メモ|担当|日$|日付|日時|期限|区分|種別|状態|ステータス|決算|開始|終了|契約|申込)/i;

const isNumText = (v: string) => /^[¥￥$]?\s?-?[\d,]+(\.\d+)?%?$/.test(v.trim()) && /\d/.test(v);
const numberOf = (c: SourceCell): number | null => {
  if (c.n !== null && Number.isFinite(c.n)) return c.n;
  if (!isNumText(c.v)) return null;
  const n = Number(c.v.replace(/[¥￥$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const filled = (c: SourceCell) => c.v.trim() !== "" || c.f !== null;

const formulaCache = new WeakMap<SourceCell, FormulaInfo>();
function infoOf(c: SourceCell, row: number, col: number): FormulaInfo | null {
  if (!c.f) return null;
  let i = formulaCache.get(c);
  if (!i) {
    i = classifyFormula(c.f, { row, col });
    formulaCache.set(c, i);
  }
  return i;
}

/**
 * 合計・小計の行か(取り込みで全行に使う決まり)。
 * 文字のマスに「合計」「小計」などがあるか、数のマスの半分以上が「上の行を足す」関数なら合計の行。
 */
export function rowLooksAggregate(cells: SourceCell[], row: number): string | null {
  const label = cells.find((c) => c.v && !isNumText(c.v) && TOTAL_LABEL.test(c.v.trim()));
  if (label) return `「${label.v.trim()}」と書かれている`;
  const numeric = cells.map((c, col) => ({ c, col })).filter(({ c }) => numberOf(c) !== null || c.f);
  const vertical = numeric.filter(({ c, col }) => {
    const i = infoOf(c, row, col);
    return i?.type === "aggregate" && (i.direction === "column" || i.direction === "block");
  });
  if (vertical.length > 0 && vertical.length * 2 >= numeric.length) return `数のマスの ${vertical.length} 個が上の行を足す関数`;
  return null;
}

export function analyzeSheet(input: { title: string; rows: SourceCell[][]; merges?: Merge[] }): SheetProposal {
  const { title, rows } = input;
  const merges = input.merges ?? [];
  const grid = rows.map((r) => r.map((c) => c.v));
  const layout = detectLayout(grid, merges);
  let width = Math.max(0, ...rows.map((r) => r.length));
  while (width > 0 && rows.every((r) => !filled(r[width - 1] ?? EMPTY_CELL))) width--;
  const headers = columnHeaders(grid, layout, width, merges);
  const warnings: string[] = [];

  // データの行と、合計・小計の行
  const body: number[] = [];
  const aggregateRows: RowProposal[] = [];
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const cells = Array.from({ length: width }, (_, c) => cellAt(rows, r, c));
    if (!cells.some(filled)) continue;
    const why = rowLooksAggregate(cells, r);
    if (why) aggregateRows.push({ index: r, kind: "aggregate", reasons: [why] });
    else body.push(r);
  }

  const { months, missingYear } = monthColumns(headers, title);
  if (missingYear.length) warnings.push(`${missingYear.map(colLetter).join("・")} 列は月の列ですが、年が分かりません(タブ名やグループ名に年がない)`);

  // 列ごとの集計
  const stats = headers.map((h) => {
    const cells = body.map((r) => ({ r, c: cellAt(rows, r, h.index) }));
    const fill = cells.filter(({ c }) => filled(c));
    const nums = fill.filter(({ c }) => numberOf(c) !== null);
    const infos = fill.map(({ r, c }) => infoOf(c, r, h.index)).filter((i): i is FormulaInfo => i !== null);
    const rowAgg = infos.filter((i) => i.type === "aggregate" && i.direction === "row") as Extract<FormulaInfo, { type: "aggregate" }>[];
    const calculated = infos.filter((i) => i.type === "calculated").length;
    const distinct = new Set(fill.map(({ c }) => c.v.trim())).size;
    return {
      fill,
      nums,
      rowAgg,
      calculated,
      numericRate: fill.length ? nums.length / fill.length : 0,
      filledRate: body.length ? fill.length / body.length : 0,
      distinctRate: fill.length ? distinct / fill.length : 0,
    };
  });

  const columns: ColumnProposal[] = [];
  let lastAggregate = -1;
  headers.forEach((h, i) => {
    const s = stats[i];
    const reasons: string[] = [];
    let role: ColumnRole;
    let aggregate: ColumnProposal["aggregate"] = null;
    const headerTotal = TOTAL_LABEL.test(h.label);

    if (s.rowAgg.length > 0 && s.rowAgg.length >= s.fill.length * 0.6) {
      // 関数で同じ行の列を足している → 合計の列
      const count = new Map<number, number>();
      s.rowAgg.forEach((a) => new Set(a.cells.map((c) => c.col)).forEach((col) => count.set(col, (count.get(col) ?? 0) + 1)));
      const sums = [...count.entries()].filter(([, n]) => n >= s.rowAgg.length * 0.5).map(([col]) => col).sort((a, b) => a - b);
      aggregate = { fn: s.rowAgg[0].fn, sums, evidence: "formula", matchRate: null };
      role = "aggregate";
      reasons.push(`${s.rowAgg.length} 行で ${sums.map(colLetter).join("・")} 列を足す関数(${s.rowAgg[0].fn})`);
    } else if (headerTotal && s.numericRate >= 0.8) {
      // 見出しが「合計」で、関数はない(値で貼られている)。左の列を足した値と合うか確かめる
      const from = lastAggregate + 1;
      const candidates = headers.slice(from, i).map((x) => x.index).filter((c) => stats[c].numericRate >= 0.8 && !TOTAL_LABEL.test(headers[c].label));
      const matched = s.nums.filter(({ r, c }) => {
        const sum = candidates.reduce((a, col) => a + (numberOf(cellAt(rows, r, col)) ?? 0), 0);
        return Math.abs(sum - (numberOf(c) ?? NaN)) < 0.5;
      }).length;
      const matchRate = s.nums.length ? matched / s.nums.length : 0;
      if (candidates.length > 0 && matchRate >= 0.8) {
        aggregate = { fn: "SUM", sums: candidates, evidence: "values", matchRate };
        role = "aggregate";
        reasons.push(`見出しが「${h.label}」で、${candidates.map(colLetter).join("・")} 列の合計と ${Math.round(matchRate * 100)}% の行で一致`);
      } else {
        aggregate = { fn: "SUM", sums: candidates, evidence: "header", matchRate };
        role = "aggregate";
        reasons.push(`見出しが「${h.label}」(左の列の合計とは ${Math.round(matchRate * 100)}% の行でしか一致しない。確かめてください)`);
        warnings.push(`${h.letter} 列「${h.label}」は合計の見出しですが、左の列の合計と合わない行があります`);
      }
    } else if (s.filledRate < 0.05) {
      role = "ignore";
      reasons.push("ほとんど空");
    } else if (s.numericRate >= 0.8) {
      role = "measure";
      reasons.push(`${Math.round(s.numericRate * 100)}% が数`);
    } else if (ATTRIBUTE_LABEL.test(h.label)) {
      role = "attribute";
      reasons.push(`見出し「${h.label}」は属性(Card)になりやすい`);
    } else {
      role = "dimension";
      reasons.push(s.distinctRate >= 0.98 ? "行ごとに違う文字(行を見分ける列の候補)" : `同じ値がくり返す文字(${Math.round(s.distinctRate * 100)}% が別の値)`);
    }
    if (role === "aggregate") lastAggregate = i;
    if (months[i] && role !== "aggregate") reasons.push(`月の列(${months[i]})`);
    const calculatedRate = s.fill.length ? s.calculated / s.fill.length : 0;
    if (calculatedRate > 0) reasons.push(`${Math.round(calculatedRate * 100)}% のセルが関数で計算された値`);
    columns.push({
      ...h,
      role,
      reasons,
      month: role === "aggregate" ? null : months[i],
      aggregate,
      calculatedRate,
      numericRate: s.numericRate,
      filledRate: s.filledRate,
      distinctRate: s.distinctRate,
      samples: s.fill.slice(0, 3).map(({ c }) => c.v),
    });
  });

  // 行を見分ける列: 行ごとに違う文字の分類の列(左から最初)
  const key = columns.find((c) => c.role === "dimension" && c.distinctRate >= 0.98 && c.filledRate >= 0.98);
  // 計算されたセル(合計の列・行は除く)
  const calculatedCells: SheetProposal["calculatedCells"] = [];
  let calculatedCellCount = 0;
  for (const r of body) {
    for (const col of columns) {
      if (col.role === "aggregate") continue;
      const c = cellAt(rows, r, col.index);
      if (infoOf(c, r, col.index)?.type === "calculated") {
        calculatedCellCount++;
        if (calculatedCells.length < 20) calculatedCells.push({ row: r, col: col.index, formula: c.f! });
      }
    }
  }
  if (rows.some((r) => r.some((c) => c.f?.includes("!")))) warnings.push("別のタブや別のファイルを見る関数があります(計算された値として扱います)");

  return {
    layout,
    width,
    columns,
    aggregateRows,
    dataRowCount: body.length,
    rowKeyColumns: key ? [key.index] : [],
    calculatedCells,
    calculatedCellCount,
    warnings,
  };
}
