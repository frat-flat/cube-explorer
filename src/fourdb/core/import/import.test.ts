import { describe, expect, it } from "vitest";
import { a1Range, colIndex, colLetter, parseRangeRef } from "./a1";
import { analyzeSheet, rowLooksAggregate } from "./analyze";
import { classifyFormula } from "./formulas";
import { detectLayout, columnHeaders } from "./layout";
import { monthColumns, parseMonthLabel } from "./months";
import type { SourceCell } from "./types";

/** 試験用: 文字・数・関数(= から始まる)を SourceCell にする。関数の値は n に入れて渡す */
const C = (v: string | number, f?: string): SourceCell =>
  typeof v === "number" ? { v: v.toLocaleString("en-US"), n: v, f: f ?? null } : { v, n: null, f: f ?? null };

describe("列記号と番地", () => {
  it("Z の次は AA、27 列目以降も正しい(今の画面の不具合の再発防止)", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    expect(["A", "Z", "AA", "AM", "ZZ", "AAA"].map(colIndex)).toEqual([0, 25, 26, 38, 701, 702]);
  });
  it("範囲を読み、タブ名つきの範囲に戻せる", () => {
    expect(parseRangeRef("$AB$4:AM4")).toEqual({ c0: 27, r0: 3, c1: 38, r1: 3 });
    expect(a1Range("店舗's 売上", { c0: 0, r0: 0, c1: 38, r1: 1999 })).toBe("'店舗''s 売上'!A1:AM2000");
  });
});

describe("関数の見分け", () => {
  it("同じ行の列を足す関数は合計の列の候補(向き row)", () => {
    const i = classifyFormula("=SUM(AB4:AM4)", { row: 3, col: 39 });
    expect(i).toMatchObject({ type: "aggregate", fn: "SUM", direction: "row" });
    expect(i.type === "aggregate" && i.cells.length).toBe(12);
  });
  it("セルを足すだけの式(A+B)も合計", () => {
    expect(classifyFormula("=B2+C2", { row: 1, col: 3 })).toMatchObject({ type: "aggregate", fn: "SUM", direction: "row" });
  });
  it("同じ列の上の行を足す関数は合計の行の候補(向き column)", () => {
    expect(classifyFormula("=SUBTOTAL(9,B2:B10)", { row: 10, col: 1 })).toMatchObject({ type: "aggregate", fn: "SUM", direction: "column" });
    expect(classifyFormula("=AVERAGE(C2:C5)", { row: 5, col: 2 })).toMatchObject({ type: "aggregate", fn: "AVG", direction: "column" });
  });
  it("引き算・掛け算・別のタブを見る式・自分を含む式は計算", () => {
    expect(classifyFormula("=B2-C2", { row: 1, col: 3 }).type).toBe("calculated");
    expect(classifyFormula("=ROUND(B2*0.1,-1)", { row: 1, col: 3 }).type).toBe("calculated");
    expect(classifyFormula("=SUM('集計'!B2:B9)", { row: 1, col: 3 }).type).toBe("calculated");
    expect(classifyFormula("=SUMIFS(B:B,A:A,A2)", { row: 1, col: 3 }).type).toBe("calculated");
    expect(classifyFormula("=SUM(B2:D2)", { row: 1, col: 2 }).type).toBe("calculated");
  });
});

describe("表の読み方", () => {
  it("文字のいちばん多い行を列名、その上をグループ名とみなす", () => {
    const grid = [["売上表"], ["", "2026年", "", ""], ["店舗", "1月", "2月", "3月"], ["楽天店", "100", "200", "300"]];
    const layout = detectLayout(grid);
    expect(layout).toEqual({ headerRow: 2, groupRow: 1 });
    expect(columnHeaders(grid, layout, 4).map((h) => [h.label, h.group])).toEqual([["店舗", null], ["1月", "2026年"], ["2月", "2026年"], ["3月", "2026年"]]);
  });
});

describe("横に並んだ月", () => {
  it("色々な書き方を読む", () => {
    expect(["2026-01", "2026年3月", "202612", "4月", "Apr", "合計"].map(parseMonthLabel)).toEqual([
      { year: 2026, month: 1 }, { year: 2026, month: 3 }, { year: 2026, month: 12 }, { year: null, month: 4 }, { year: null, month: 4 }, null,
    ]);
  });
  it("年度(4月〜3月)は 1月 から翌年。年はタブ名から", () => {
    const hs = ["4月", "5月", "12月", "1月", "3月"].map((label) => ({ label, group: null }));
    expect(monthColumns(hs, "2025年度").months).toEqual(["2025-04", "2025-05", "2025-12", "2026-01", "2026-03"]);
  });
  it("年が分からなければ要確認に回す", () => {
    expect(monthColumns([{ label: "1月", group: null }], "売上").missingYear).toEqual([0]);
  });
});

describe("合計の行・列と計算されたセルの候補", () => {
  // 店舗 | 1月 | 2月 | 3月 | Q1計 | 4月 | 5月 | 6月 | Q2計 | 年合計 | 精算額
  const row = (r: number, name: string, v: number[]) => {
    const q1 = v[0] + v[1] + v[2], q2 = v[3] + v[4] + v[5];
    return [
      C(name), C(v[0]), C(v[1]), C(v[2]), C(q1, `=SUM(B${r}:D${r})`), C(v[3]), C(v[4]), C(v[5]), C(q2, `=SUM(F${r}:H${r})`),
      C(q1 + q2, `=E${r}+I${r}`), C(q1 + q2 - 10, `=J${r}-10`),
    ];
  };
  const rows: SourceCell[][] = [
    [C("2026年 店舗別売上")],
    ["店舗", "1月", "2月", "3月", "Q1計", "4月", "5月", "6月", "Q2計", "年合計", "精算額"].map((v) => C(v)),
    row(3, "楽天店", [10, 20, 30, 40, 50, 60]),
    row(4, "Yahoo店", [1, 2, 3, 4, 5, 6]),
    [C("合計"), ...Array.from({ length: 10 }, (_, i) => C(0, `=SUM(${String.fromCharCode(66 + i)}3:${String.fromCharCode(66 + i)}4)`))],
  ];
  const p = analyzeSheet({ title: "2026年", rows });
  const role = (letter: string) => p.columns.find((c) => c.letter === letter)!;

  it("列名の行は 2 行目(0 始まりで 1)", () => {
    expect(p.layout.headerRow).toBe(1);
  });
  it("月の列は数値(measure)で、年はタブ名から", () => {
    expect(["B", "C", "D", "F", "G", "H"].map((l) => [role(l).role, role(l).month])).toEqual([
      ["measure", "2026-01"], ["measure", "2026-02"], ["measure", "2026-03"], ["measure", "2026-04"], ["measure", "2026-05"], ["measure", "2026-06"],
    ]);
  });
  it("Q1計・Q2計・年合計は合計の列で、足している列が分かる", () => {
    expect(role("E").aggregate).toMatchObject({ fn: "SUM", sums: [1, 2, 3], evidence: "formula" });
    expect(role("I").aggregate).toMatchObject({ fn: "SUM", sums: [5, 6, 7], evidence: "formula" });
    expect(role("J")).toMatchObject({ role: "aggregate", aggregate: { sums: [4, 8] } });
  });
  it("合計の行は値にしない候補、データは 2 行", () => {
    expect(p.aggregateRows.map((r) => r.index)).toEqual([4]);
    expect(p.dataRowCount).toBe(2);
  });
  it("精算額は計算された値の列(Raw として扱わない)", () => {
    expect(role("K")).toMatchObject({ role: "measure", calculatedRate: 1 });
    expect(p.calculatedCellCount).toBe(2);
  });
  it("店舗の列は行を見分ける列の候補", () => {
    expect(role("A").role).toBe("dimension");
    expect(p.rowKeyColumns).toEqual([0]);
  });

  it("関数のない「合計」の列も、左の列の合計と合えば合計の列の候補", () => {
    const q = analyzeSheet({
      title: "2026",
      rows: [
        ["店舗", "1月", "2月", "合計"].map((v) => C(v)),
        [C("A"), C(1), C(2), C(3)],
        [C("B"), C(5), C(5), C(10)],
      ],
    });
    expect(q.columns[3]).toMatchObject({ role: "aggregate", aggregate: { evidence: "values", sums: [1, 2], matchRate: 1 } });
  });
  it("合計の見出しでも、合わなければ要確認として知らせる", () => {
    const q = analyzeSheet({ title: "2026", rows: [["店舗", "1月", "合計"].map((v) => C(v)), [C("A"), C(1), C(99)]] });
    expect(q.columns[2].aggregate?.evidence).toBe("header");
    expect(q.warnings.join()).toContain("合わない行");
  });
  it("合計の行は、文字か、上の行を足す関数で見分ける", () => {
    expect(rowLooksAggregate([C("小計"), C(5)], 9)).toContain("小計");
    expect(rowLooksAggregate([C(""), C(5, "=SUM(B2:B9)")], 9)).toContain("上の行を足す");
    expect(rowLooksAggregate([C("楽天店"), C(5)], 9)).toBeNull();
  });
});
