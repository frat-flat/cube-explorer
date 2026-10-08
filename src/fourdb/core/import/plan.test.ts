import { describe, expect, it } from "vitest";
import { planRows, validateSpec, type ApprovalSpec } from "./plan";
import type { SourceCell } from "./types";

const C = (v: string | number, f?: string): SourceCell =>
  typeof v === "number" ? { v: v.toLocaleString("en-US"), n: v, f: f ?? null } : { v, n: null, f: f ?? null };

// 店舗 | 課税区分 | 1月 | 2月 | 合計 | 精算額
const spec: ApprovalSpec = {
  headerRow: 0,
  groupRow: null,
  rowKeyColumns: [0],
  entityColumn: 0,
  columns: [
    { index: 0, role: "dimension", dimension: "店舗", definition: "店舗" },
    { index: 1, role: "attribute", definition: "課税区分" },
    { index: 2, role: "measure", definition: "売上", month: "2026-01" },
    { index: 3, role: "measure", definition: "売上", month: "2026-02" },
    { index: 4, role: "aggregate", fn: "SUM", definition: "売上", sums: [2, 3] },
    { index: 5, role: "measure", definition: "精算額", month: null },
  ],
  aggregateRows: { auto: true, include: [], exclude: [] },
  sheetCoords: [{ dimension: "モール", member: "楽天" }],
};
const rows = [
  { index: 0, cells: ["店舗", "課税区分", "1月", "2月", "合計", "精算額"].map((v) => C(v)) },
  { index: 1, cells: [C("A店"), C("課税"), C(100), C(200), C(300, "=C2+D2"), C(290, "=E2-10")] },
  { index: 2, cells: [C(""), C(""), C(""), C(""), C(""), C("")] },
  { index: 3, cells: [C("B店"), C("免税"), C("¥1,000"), C("-"), C(1000, "=SUM(C4:D4)"), C(990, "=E4-10")] },
  { index: 4, cells: [C("合計"), C(""), C(1100, "=SUM(C2:C4)"), C(200, "=SUM(D2:D4)"), C(1300, "=SUM(E2:E4)"), C(1280)] },
];

describe("承認の内容の確かめ", () => {
  it("正しい内容なら問題なし", () => {
    expect(validateSpec(spec, 6)).toEqual([]);
  });
  it("扱いの決まっていない列・同じカラムを別の種類で使う・同じ軸を2か所で決める・実体の列なしの属性は問題", () => {
    const bad: ApprovalSpec = {
      ...spec,
      entityColumn: null,
      columns: [
        { index: 0, role: "dimension", dimension: "月", definition: "売上" },
        { index: 1, role: "attribute", definition: "課税区分" },
        { index: 2, role: "measure", definition: "売上", month: "2026-1" },
      ],
    };
    const e = validateSpec(bad, 4).join("\n");
    expect(e).toContain("列 3 の扱いが決まっていません");
    expect(e).toContain("カラム「売上」が dimension と measure");
    expect(e).toContain("軸「月」が");
    expect(e).toContain("YYYY-MM");
    expect(e).toContain("実体の列を選んでください");
  });
});

describe("行を入れる形にする", () => {
  const p = planRows(spec, rows);
  it("列名の行と空の行は飛ばし、合計の行は aggregate", () => {
    expect(p.skipped).toBe(2);
    expect(p.rows.map((r) => [r.rowIndex, r.kind, r.rowKey])).toEqual([[1, "data", "A店"], [3, "data", "B店"], [4, "aggregate", "#5"]]);
  });
  it("分類の列は行の軸の値、実体は Box の名前", () => {
    expect(p.rows[0]).toMatchObject({ coords: [{ dimension: "店舗", member: "A店" }], entity: "A店" });
  });
  it("数値は Raw、関数で計算された値は calculated(関数つき)、属性は文字。数値の列の「-」は値にしない", () => {
    expect(p.rows[0].values).toEqual([
      { col: 1, kind: "raw", num: null, txt: "課税", formula: null },
      { col: 2, kind: "raw", num: 100, txt: null, formula: null },
      { col: 3, kind: "raw", num: 200, txt: null, formula: null },
      { col: 5, kind: "calculated", num: 290, txt: null, formula: "=E2-10" },
    ]);
    expect(p.rows[1].values.map((v) => [v.col, v.num ?? v.txt])).toEqual([[1, "免税"], [2, 1000], [5, 990]]);
  });
  it("合計の列と合計の行の数字は、値ではなくスプシの合計として残す", () => {
    expect(p.rows[0].totals).toEqual([{ col: 4, num: 300, txt: null, formula: "=C2+D2" }]);
    expect(p.rows[2].values).toEqual([]);
    expect(p.rows[2].totals.map((t) => [t.col, t.num, t.formula])).toEqual([
      [2, 1100, "=SUM(C2:C4)"], [3, 200, "=SUM(D2:D4)"], [4, 1300, "=SUM(E2:E4)"], [5, 1280, null],
    ]);
  });
  it("データの行の数値の列に合計の関数があれば、入れずに知らせる", () => {
    const q = planRows(spec, [{ index: 1, cells: [C("A店"), C("課税"), C(5, "=SUM(D2:D2)"), C(5), C(10), C(1)] }]);
    expect(q.rows[0].values.map((v) => v.col)).toEqual([1, 3, 5]);
    expect(q.problems[0]).toMatchObject({ row: 1, col: 2 });
  });
  it("人が合計の行を外したり足したりできる", () => {
    const q = planRows({ ...spec, aggregateRows: { auto: true, include: [1], exclude: [4] } }, rows);
    expect(q.rows.map((r) => [r.rowIndex, r.kind])).toEqual([[1, "aggregate"], [3, "data"], [4, "data"]]);
  });
});
