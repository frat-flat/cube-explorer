import { describe, expect, it } from "vitest";
import { buildDepthMembersQuery, buildFaceQuery, buildLabelsQuery, ident } from "../sql";
import { faceRequest, meta } from "./fixtures";

describe("buildFaceQuery", () => {
  it("集約:行・列の2軸だけで group by し、奥行きの結合は付けない", () => {
    const q = buildFaceQuery(faceRequest(), meta);
    expect(q.text).toBe(
      [
        `select f."store_id"::text as r, to_char(date_trunc('month', f."sold_at" at time zone 'Asia/Tokyo'), 'YYYY-MM') as c, sum(f."amount") as v`,
        `from "sales" f`,
        "group by 1, 2",
      ].join("\n"),
    );
    expect(q.params).toEqual([]);
  });

  it("商品カテゴリを行にすると、key_column で商品マスタを結合する", () => {
    const q = buildFaceQuery(faceRequest({ view: { rows: 2, cols: 1 } }), meta);
    expect(q.text).toContain(`left join "products" "j_product_category" on "j_product_category"."id" = f."product_id"`);
    expect(q.text).toContain(`select "j_product_category"."category"::text as r`);
  });

  it("断面:奥行きの値を条件に加え、値はパラメータで渡す", () => {
    const q = buildFaceQuery(faceRequest({ depth: { mode: "slice", member: "飲料" } }), meta);
    expect(q.text).toContain(`where "j_product_category"."category"::text = $1`);
    expect(q.text).toContain(`left join "products"`);
    expect(q.params).toEqual(["飲料"]);
  });

  it("条件の値はSQL文字列に入らない", () => {
    const evil = "S001' or '1'='1";
    const req = faceRequest();
    req.spec.filters = [
      { axis: "store", op: "eq", value: evil },
      { axis: "month", op: "between", value: ["2026-01", "2026-03"] },
      { axis: "product", op: "in", value: ["P001", "P002"] },
    ];
    const q = buildFaceQuery(req, meta);
    expect(q.text).not.toContain(evil);
    expect(q.text).toContain(`where f."store_id"::text = $1`);
    expect(q.text).toContain(`between $2 and $3`);
    expect(q.text).toContain(`f."product_id"::text = any($4::text[])`);
    expect(q.params).toEqual([evil, "2026-01", "2026-03", ["P001", "P002"]]);
  });

  it("粒度の指定で時間の区切りを変える", () => {
    const req = faceRequest();
    req.spec.axes[1] = { key: "month", grain: "year" };
    expect(buildFaceQuery(req, meta).text).toContain(`date_trunc('year', f."sold_at" at time zone 'Asia/Tokyo'), 'YYYY')`);
  });

  it("source_table が事実テーブル自身の属性軸は結合しない", () => {
    const q = buildFaceQuery(
      {
        spec: {
          fact: "handover_notes",
          axes: [{ key: "store" }, { key: "note_category" }, { key: "month" }],
          measure: { key: "content", agg: "count" },
          filters: [],
        },
        view: { rows: 0, cols: 1 },
        depth: { mode: "aggregate" },
      },
      meta,
    );
    expect(q.text).toContain(`f."category"::text as c`);
    expect(q.text).not.toContain("join");
  });
});

describe("buildDepthMembersQuery", () => {
  it("断面の条件は外し、filters は効かせる", () => {
    const req = faceRequest({ depth: { mode: "slice", member: "飲料" } });
    req.spec.filters = [{ axis: "store", op: "eq", value: "S001" }];
    const q = buildDepthMembersQuery(req, meta, 100);
    expect(q.text).toContain(`select distinct "j_product_category"."category"::text as k`);
    expect(q.params).toEqual(["S001", 100]);
  });
});

describe("buildLabelsQuery / ident", () => {
  it("entity 軸の表示名を label_column から引く", () => {
    const q = buildLabelsQuery(meta.axes.get("store")!, ["S001"]);
    expect(q?.text).toBe(`select "id"::text as k, "name"::text as l from "stores" where "id"::text = any($1::text[])`);
  });

  it("メタデータの識別子に想定外の文字があれば使わない", () => {
    expect(() => ident('sales"; drop table x; --')).toThrow();
  });
});
