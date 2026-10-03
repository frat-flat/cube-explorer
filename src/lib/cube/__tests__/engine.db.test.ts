// ローカルDB(npm run db:start)に対して、エンジンの結果を素のSQLと突き合わせる。
// DATABASE_URL が無いときは飛ばす
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getFace } from "../engine";
import { faceRequest } from "./fixtures";
import type { CellValue } from "../types";

const num = (c: CellValue | null) => (c?.type === "number" ? c.value : null);

describe.skipIf(!process.env.DATABASE_URL)("getFace(DB)", () => {
  afterAll(() => sql.end());

  it("店舗 × 月(奥行き:商品カテゴリを集約)の売上合計が素のSQLと一致する", async () => {
    const face = await getFace(faceRequest());
    expect(face.rows.map((r) => r.label).slice(0, 2)).toEqual(["A店", "B店"]);
    expect(face.cols[0]).toEqual({ key: "2025-10", label: "2025年10月" });
    expect(face.cols).toHaveLength(12);
    expect(face.meta.depthMembers.map((m) => m.key)).toEqual(["日用品", "菓子", "雑貨", "食品", "飲料"]);

    const [expected] = await sql`
      select sum(amount)::int as v from sales
      where store_id = 'S001' and to_char(sold_at at time zone 'Asia/Tokyo', 'YYYY-MM') = '2025-10'`;
    expect(num(face.cells[0][0])).toBe(expected.v);
  });

  it("集約の平均は、明細全体の平均になる(平均の平均にならない)", async () => {
    const req = faceRequest();
    req.spec.measure = { key: "amount", agg: "avg" };
    const face = await getFace(req);
    const [expected] = await sql`
      select avg(amount)::float8 as v from sales
      where store_id = 'S001' and to_char(sold_at at time zone 'Asia/Tokyo', 'YYYY-MM') = '2025-10'`;
    expect(num(face.cells[0][0])).toBeCloseTo(expected.v, 6);
  });

  it("断面:商品カテゴリ × 月 を A店で切る", async () => {
    const face = await getFace(faceRequest({ view: { rows: 2, cols: 1 }, depth: { mode: "slice", member: "S001" } }));
    expect(face.rows.map((r) => r.key)).toEqual(["日用品", "菓子", "雑貨", "食品", "飲料"]);
    expect(face.meta.depthMembers[0]).toEqual({ key: "S001", label: "A店" });
    const [expected] = await sql`
      select sum(s.amount)::int as v from sales s join products p on p.id = s.product_id
      where s.store_id = 'S001' and p.category = '飲料'
        and to_char(s.sold_at at time zone 'Asia/Tokyo', 'YYYY-MM') = '2026-09'`;
    expect(num(face.cells[4][11])).toBe(expected.v);
  });

  it("目盛りが上限を超えると切り詰めて truncated を立てる", async () => {
    const req = faceRequest();
    req.spec.limits = { perAxis: 3 };
    const face = await getFace(req);
    expect(face.rows).toHaveLength(3);
    expect(face.meta.truncated).toBe(true);
    expect(face.meta.totalMembers.store).toBe(10);
  });
});
