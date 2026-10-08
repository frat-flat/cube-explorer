// 承認した内容(ApprovalSpec)と元の行から、「どの行を、どの軸の値で、どの値として入れるか」を組み立てる。
// データベースには触らない(つなぎ側がこの結果を表に書く)。分割して呼んでも同じ結果になる(行ごとに決まる)。
import { rowLooksAggregate } from "./analyze";
import { classifyFormula, type AggregateFn } from "./formulas";
import { cellAt, type SourceCell } from "./types";

export type ColumnApproval =
  | { index: number; role: "ignore" }
  | { index: number; role: "dimension"; dimension: string; definition: string }
  | { index: number; role: "measure"; definition: string; month: string | null }
  | { index: number; role: "attribute"; definition: string }
  /** sums = この合計の列が足している列(照合に使う。合計の列を含んでもよい) */
  | { index: number; role: "aggregate"; fn: AggregateFn; definition: string | null; sums: number[] };

export type ApprovalSpec = {
  headerRow: number;
  groupRow: number | null;
  /** 行を見分ける列(空なら行番号) */
  rowKeyColumns: number[];
  /** 行が表す実体の列(この列の値ごとに Box を作り、属性の列をその Box の Card にする)。属性の列がなければ null */
  entityColumn: number | null;
  columns: ColumnApproval[];
  /** 合計・小計の行: auto なら見出し・関数で見分け、include / exclude で人が直す(行番号は 0 始まり) */
  aggregateRows: { auto: boolean; include: number[]; exclude: number[] };
  /** 表全体に効く軸の値(例: モール = 楽天) */
  sheetCoords: { dimension: string; member: string }[];
};

/** 横に並んだ月の列が使う、時間の軸の名前 */
export const MONTH_DIMENSION = "月";

export type PlannedValue = { col: number; kind: "raw" | "calculated"; num: number | null; txt: string | null; formula: string | null };
export type PlannedRow = {
  rowIndex: number;
  kind: "data" | "aggregate";
  rowKey: string;
  /** 行に効く軸の値(分類の列から) */
  coords: { dimension: string; member: string }[];
  /** 行が表す実体の名前(Box) */
  entity: string | null;
  /** 数値・属性の列の値(データの行だけ) */
  values: PlannedValue[];
  /** スプシに書かれていた合計(合計の列のセルと、合計の行の数値のセル) */
  totals: { col: number; num: number | null; txt: string | null; formula: string | null }[];
};

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const text = (c: SourceCell) => c.v.trim();
const isNumText = (v: string) => /^[¥￥$]?\s?-?[\d,]+(\.\d+)?%?$/.test(v.trim()) && /\d/.test(v);
function numberOf(c: SourceCell): number | null {
  if (c.n !== null && Number.isFinite(c.n)) return c.n;
  const v = c.v.trim();
  if (!isNumText(v)) return null;
  const n = Number(v.replace(/[¥￥$,%\s]/g, "")) / (v.endsWith("%") ? 100 : 1);
  return Number.isFinite(n) ? n : null;
}

/** 承認の内容の矛盾を探す(空なら問題なし) */
export function validateSpec(spec: ApprovalSpec, width: number): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const c of spec.columns) {
    if (c.index < 0 || c.index >= width) errors.push(`列の番号 ${c.index} は表の外です`);
    if (seen.has(c.index)) errors.push(`列 ${c.index} が2回あります`);
    seen.add(c.index);
  }
  for (let i = 0; i < width; i++) if (!seen.has(i)) errors.push(`列 ${i} の扱いが決まっていません`);

  const kindOf = new Map<string, string>();
  const noteDef = (name: string, kind: string, where: string) => {
    if (!name.trim()) return errors.push(`${where}: カラムの名前が空です`);
    const k = kindOf.get(name);
    if (k && k !== kind) errors.push(`カラム「${name}」が ${k} と ${kind} の両方に使われています`);
    kindOf.set(name, kind);
  };
  const dims = new Map<string, string>();   // 軸 → どこで決めるか
  const noteDim = (name: string, where: string) => {
    if (!name.trim()) return errors.push(`${where}: 軸の名前が空です`);
    const w = dims.get(name);
    if (w && w !== where) errors.push(`軸「${name}」が ${w} と ${where} の2か所で決まっています(1か所にしてください)`);
    dims.set(name, where);
  };
  spec.sheetCoords.forEach((s) => {
    noteDim(s.dimension, "表全体");
    if (!s.member.trim()) errors.push(`表全体の軸「${s.dimension}」の値が空です`);
  });
  for (const c of spec.columns) {
    const where = `列 ${c.index}`;
    if (c.role === "dimension") {
      noteDim(c.dimension, where);
      noteDef(c.definition, "dimension", where);
    } else if (c.role === "measure") {
      noteDef(c.definition, "measure", where);
      if (c.month !== null) {
        if (!MONTH.test(c.month)) errors.push(`${where}: 月は YYYY-MM の形で入れてください(${c.month})`);
        noteDim(MONTH_DIMENSION, "列ごとの月");
      }
    } else if (c.role === "attribute") {
      noteDef(c.definition, "attribute", where);
    } else if (c.role === "aggregate") {
      if (c.definition) noteDef(c.definition, "measure", where);
      if (c.sums.some((i) => i < 0 || i >= width || i === c.index)) errors.push(`${where}: 合計の列が足す列の番号が正しくありません`);
    }
  }
  const role = (i: number) => spec.columns.find((c) => c.index === i)?.role;
  if (spec.columns.some((c) => c.role === "attribute")) {
    if (spec.entityColumn === null) errors.push("属性(Card)の列があるときは、行が表す実体の列を選んでください");
    else if (role(spec.entityColumn) !== "dimension") errors.push("行が表す実体の列は、分類(軸)の列にしてください");
  }
  for (const k of spec.rowKeyColumns) {
    if (!["dimension", "attribute"].includes(role(k) ?? "")) errors.push(`行を見分ける列 ${k} は、分類か属性の列にしてください`);
  }
  if (spec.headerRow < 0) errors.push("列名の行が正しくありません");
  return errors;
}

/** 行の鍵。行を見分ける列の値をつなぐ。空なら行番号(#12) */
export function rowKeyOf(spec: ApprovalSpec, cells: SourceCell[], rowIndex: number, kind: "data" | "aggregate"): string {
  if (kind === "aggregate" || spec.rowKeyColumns.length === 0) return `#${rowIndex + 1}`;
  const parts = spec.rowKeyColumns.map((i) => text(cells[i] ?? { v: "", n: null, f: null }));
  return parts.every((p) => p === "") ? `#${rowIndex + 1}` : parts.join("|");
}

/** 元の行(rowIndex は 0 始まりの行番号)を、入れる形にする。空の行・列名より上の行は飛ばす */
export type PlanProblem = { row: number; col: number; message: string };

export function planRows(
  spec: ApprovalSpec,
  rows: { index: number; cells: SourceCell[] }[],
): { rows: PlannedRow[]; skipped: number; problems: PlanProblem[] } {
  const out: PlannedRow[] = [];
  const problems: PlanProblem[] = [];
  let skipped = 0;
  const byIndex = new Map(spec.columns.map((c) => [c.index, c]));
  const width = spec.columns.length;
  for (const { index, cells } of rows) {
    const row = Array.from({ length: width }, (_, c) => cellAt([cells], 0, c));
    if (index <= spec.headerRow || !row.some((c) => text(c) !== "" || c.f !== null)) {
      skipped++;
      continue;
    }
    const forced = spec.aggregateRows.include.includes(index);
    const excluded = spec.aggregateRows.exclude.includes(index);
    const kind: "data" | "aggregate" = forced || (spec.aggregateRows.auto && !excluded && rowLooksAggregate(row, index) !== null) ? "aggregate" : "data";

    const coords: PlannedRow["coords"] = [];
    const values: PlannedValue[] = [];
    const totals: PlannedRow["totals"] = [];
    for (let i = 0; i < width; i++) {
      const a = byIndex.get(i);
      const c = row[i];
      if (!a || a.role === "ignore") continue;
      const empty = text(c) === "" && c.f === null;
      if (a.role === "dimension") {
        if (kind === "data" && text(c) !== "") coords.push({ dimension: a.dimension, member: text(c) });
        continue;
      }
      if (empty) continue;
      if (a.role === "aggregate" || (kind === "aggregate" && a.role === "measure")) {
        const n = numberOf(c);
        if (n !== null || text(c) !== "") totals.push({ col: i, num: n, txt: n === null ? text(c) : null, formula: c.f });
        continue;
      }
      if (kind === "aggregate") continue;   // 合計の行の属性などは入れない
      const calculated = c.f !== null && classifyFormula(c.f, { row: index, col: i }).type === "calculated";
      const formulaAggregate = c.f !== null && !calculated;   // 数値の列の中に、合計の関数が混じったセル
      if (a.role === "measure") {
        const n = numberOf(c);
        if (n === null) continue;   // 数値の列の文字(「-」など)は値にしない
        if (formulaAggregate) {
          // データの行の数値の列に合計の関数がある。値にすると二重に数えるので入れずに知らせる
          problems.push({ row: index, col: i, message: `合計の関数 ${c.f} が数値の列のセルにあります(この行か列を合計にしてください)` });
          continue;
        }
        values.push({ col: i, kind: calculated ? "calculated" : "raw", num: n, txt: null, formula: calculated ? c.f : null });
      } else {
        values.push({ col: i, kind: calculated ? "calculated" : "raw", num: null, txt: text(c), formula: calculated ? c.f : null });
      }
    }
    const entityCell = spec.entityColumn === null ? null : text(row[spec.entityColumn] ?? { v: "", n: null, f: null });
    out.push({
      rowIndex: index,
      kind,
      rowKey: rowKeyOf(spec, row, index, kind),
      coords,
      entity: kind === "data" && entityCell ? entityCell : null,
      values,
      totals,
    });
  }
  return { rows: out, skipped, problems };
}
