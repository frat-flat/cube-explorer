import { describe, expect, it } from "vitest";
import { parseSpec } from "./spec-parse";

const ok = {
  headerRow: 2,
  groupRow: 1,
  rowKeyColumns: [0],
  entityColumn: 0,
  columns: [
    { index: 0, role: "dimension", dimension: " 店舗 ", definition: "店舗" },
    { index: 1, role: "attribute", definition: "課税区分" },
    { index: 2, role: "measure", definition: "売上", month: "2026-04" },
    { index: 3, role: "aggregate", fn: "SUM", definition: null, sums: [2] },
    { index: 4, role: "ignore" },
  ],
  aggregateRows: { auto: true, include: [], exclude: [6] },
  sheetCoords: [{ dimension: "モール", member: "楽天" }],
};

describe("画面から届いた承認の内容の形を確かめる", () => {
  it("正しい形なら ApprovalSpec にする(名前の前後の空白は取る)", () => {
    const s = parseSpec(ok);
    expect(typeof s).toBe("object");
    expect(s).toMatchObject({ headerRow: 2, columns: [{ dimension: "店舗" }, {}, { month: "2026-04" }, { sums: [2] }, { role: "ignore" }] });
  });
  it("形が違えば理由を返す(データベースに渡さない)", () => {
    expect(parseSpec(null)).toBe("承認の内容がありません");
    expect(parseSpec({ ...ok, headerRow: -1 })).toBe("列名の行が違います");
    expect(parseSpec({ ...ok, columns: [{ index: 0, role: "drop table" }] })).toContain("扱いが違います");
    expect(parseSpec({ ...ok, columns: [{ index: 0, role: "dimension", dimension: "", definition: "x" }] })).toContain("軸とカラムの名前");
    expect(parseSpec({ ...ok, columns: [{ index: 0, role: "aggregate", fn: "MEDIAN", definition: null, sums: [] }] })).toContain("合計の形");
    expect(parseSpec({ ...ok, columns: [{ index: 0, role: "measure", definition: "x".repeat(101), month: null }] })).toContain("カラムの名前");
    expect(parseSpec({ ...ok, aggregateRows: { auto: "yes", include: [], exclude: [] } })).toBe("合計の行の指定が違います");
    expect(parseSpec({ ...ok, sheetCoords: [{ dimension: "モール" }] })).toContain("軸と値の両方");
  });
});
