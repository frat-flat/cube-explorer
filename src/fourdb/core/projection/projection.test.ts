import { describe, expect, it } from "vitest";
import { parseProjectionRequest } from "./request";
import { compareMembers, NONE_NAME, shapeProjection } from "./shape";
import type { AggRow, MemberInfo, ProjectionRequest } from "./types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = (n: number, name: string, extra: Partial<MemberInfo> = {}): [string, MemberInfo] => [id(n), { id: id(n), name, sortOrder: null, periodStart: null, ...extra }];

describe("集計の指定の形を確かめる", () => {
  const ok = { measureId: id(1), fn: "SUM", rows: { dimensionId: id(2), level: 1, subtotalLevel: 0 }, columns: { dimensionId: id(3), level: 2 }, filters: [{ dimensionId: id(4), memberIds: [id(5)] }], sheetIds: null };
  it("正しい形なら ProjectionRequest にする", () => {
    expect(parseProjectionRequest(ok)).toMatchObject({ fn: "SUM", rows: { level: 1, subtotalLevel: 0 }, columns: { level: 2, subtotalLevel: null } });
  });
  it("形が違えば理由を返す", () => {
    expect(parseProjectionRequest({ ...ok, measureId: "x" })).toBe("数値のカラムを選んでください");
    expect(parseProjectionRequest({ ...ok, fn: "MEDIAN" })).toBe("集計のしかたが違います");
    expect(parseProjectionRequest({ ...ok, columns: { dimensionId: id(2), level: 0 } })).toBe("行と列には別の軸を選んでください");
    expect(parseProjectionRequest({ ...ok, rows: { dimensionId: id(2), level: 1, subtotalLevel: 1 } })).toContain("上の段");
    expect(parseProjectionRequest({ ...ok, columns: { dimensionId: id(3), level: 2, subtotalLevel: 0 } })).toContain("小計を入れられません");
    expect(parseProjectionRequest({ ...ok, filters: [{ dimensionId: id(4), memberIds: [] }] })).toBe("絞り込みの形が違います");
  });
  it("同じ軸の絞り込みは2つにできず、選べる軸の値は合わせて 2000 個まで", () => {
    expect(parseProjectionRequest({ ...ok, filters: [{ dimensionId: id(4), memberIds: [id(5)] }, { dimensionId: id(4), memberIds: [id(6)] }] })).toContain("同じ軸の絞り込み");
    const many = (from: number) => Array.from({ length: 500 }, (_, i) => id(from + i));
    const filters = (n: number) => Array.from({ length: n }, (_, k) => ({ dimensionId: id(10 + k), memberIds: many(1000 + k * 500) }));
    expect(typeof parseProjectionRequest({ ...ok, filters: filters(4) })).toBe("object");
    expect(parseProjectionRequest({ ...ok, filters: filters(5) })).toContain("2000 個まで");
  });
});

describe("並べ方", () => {
  it("並び順 → 期間 → 名前。軸の値のないものは最後", () => {
    const a = M(1, "B", { sortOrder: 1 })[1], b = M(2, "A", { sortOrder: 2 })[1];
    const p = M(3, "4月", { periodStart: "2026-04-01" })[1], q = M(4, "10月", { periodStart: "2026-10-01" })[1];
    expect([b, a].sort(compareMembers).map((x) => x.name)).toEqual(["B", "A"]);
    expect([q, p].sort(compareMembers).map((x) => x.name)).toEqual(["4月", "10月"]);
    expect(compareMembers(null, a)).toBe(1);
  });
});

describe("集計結果を表の形にする", () => {
  // 行: 店舗(楽天・Yahoo、小計は法人 A社)、列: 月(4月・5月)
  const members = new Map([M(10, "楽天店", { sortOrder: 1 }), M(11, "Yahoo店", { sortOrder: 2 }), M(20, "4月", { periodStart: "2026-04-01" }), M(21, "5月", { periodStart: "2026-05-01" }), M(30, "A社")]);
  const req: ProjectionRequest = { measureId: id(1), fn: "SUM", rows: { dimensionId: id(2), level: 1, subtotalLevel: 0 }, columns: { dimensionId: id(3), level: 2, subtotalLevel: null }, filters: [], sheetIds: null };
  const A = (r: number | null, c: number | null, s: number | null, gr: number, gc: number, gs: number, v: number, n: number, calc = 0): AggRow =>
    ({ r: r === null ? null : id(r), c: c === null ? null : id(c), s: s === null ? null : id(s), gr, gc, gs, v, n, calc });
  const agg: AggRow[] = [
    A(11, 21, 30, 0, 0, 0, 6, 1), A(10, 20, 30, 0, 0, 0, 1, 1), A(10, 21, 30, 0, 0, 0, 2, 1), A(11, 20, 30, 0, 0, 0, 5, 1, 1),
    A(10, null, 30, 0, 1, 0, 3, 2), A(11, null, 30, 0, 1, 0, 11, 2, 1),          // 行の合計
    A(null, 20, 30, 1, 0, 0, 6, 2, 1), A(null, 21, 30, 1, 0, 0, 8, 2),          // 小計(A社 × 月)
    A(null, null, 30, 1, 1, 0, 14, 4, 1),                                       // 小計の合計
    A(null, 20, null, 1, 0, 1, 6, 2, 1), A(null, 21, null, 1, 0, 1, 8, 2),      // 列の合計
    A(null, null, null, 1, 1, 1, 14, 4, 1),                                     // 総計
  ];
  const p = shapeProjection(req, agg, members);
  it("行・列は並び順・期間の順", () => {
    expect(p.rows.map((r) => r.name)).toEqual(["楽天店", "Yahoo店"]);
    expect(p.columns.map((c) => c.name)).toEqual(["4月", "5月"]);
  });
  it("明細・行の合計・列の合計・総計(総計は値 4 個)", () => {
    expect(p.cells.map((r) => r.map((c) => c.v))).toEqual([[1, 2], [5, 6]]);
    expect(p.rowTotals!.map((c) => c.v)).toEqual([3, 11]);
    expect(p.columnTotals!.map((c) => c.v)).toEqual([6, 8]);
    expect(p.grand).toMatchObject({ v: 14, n: 4 });
    expect(p.valueCount).toBe(4);
  });
  it("小計は群ごと(A社)", () => {
    expect(p.subtotals).toEqual([{ key: id(30), name: "A社", cells: [{ v: 6, n: 2, kind: "mixed" }, { v: 8, n: 2, kind: "raw" }], total: { v: 14, n: 4, kind: "mixed" } }]);
    expect(p.rows.every((r) => r.group === id(30))).toBe(true);
  });
  it("計算された値の印: 元の値だけ raw、計算された値だけ calculated、両方 mixed", () => {
    expect(p.cells[1][0].kind).toBe("calculated");
    expect(p.cells[0][0].kind).toBe("raw");
    expect(p.rowTotals![1].kind).toBe("mixed");
  });
  it("軸の値のない値は「(なし)」の行にまとめる。列の軸がなければ列は1つ", () => {
    const q = shapeProjection({ ...req, rows: { ...req.rows!, subtotalLevel: null }, columns: null },
      [A(10, null, null, 0, 0, 1, 1, 1), A(null, null, null, 0, 0, 1, 9, 1), A(null, null, null, 1, 0, 1, 10, 2), A(null, null, null, 1, 1, 1, 10, 2)], members);
    expect(q.rows.map((r) => r.name)).toEqual(["楽天店", NONE_NAME]);
    expect(q.columns).toEqual([{ key: null, name: "値" }]);
    expect(q.rowTotals).toBeNull();
    expect(q.grand.v).toBe(10);
  });
});
