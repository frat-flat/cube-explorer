import { describe, expect, it } from "vitest";
import { CubeError, validateFaceRequest } from "../validate";
import { faceRequest, meta } from "./fixtures";

const withSpec = (spec: Record<string, unknown>) => {
  const req = faceRequest();
  return { ...req, spec: { ...req.spec, ...spec } };
};
const expectReject = (input: unknown, message: RegExp) => {
  expect(() => validateFaceRequest(input, meta)).toThrowError(CubeError);
  expect(() => validateFaceRequest(input, meta)).toThrowError(message);
};

describe("validateFaceRequest", () => {
  it("正しいリクエストを受け付け、既定の上限 50 を補う", () => {
    const req = validateFaceRequest(faceRequest(), meta);
    expect(req.spec.axes.map((a) => a.key)).toEqual(["store", "month", "product_category"]);
    expect(req.spec.limits).toEqual({ perAxis: 50 });
  });

  it("定義されていない事実テーブルを拒否する", () => {
    expectReject(withSpec({ fact: "users" }), /定義されていません/);
  });

  it("その事実テーブルに無い軸を拒否する", () => {
    expectReject(
      withSpec({ axes: [{ key: "store" }, { key: "month" }, { key: "note_category" }] }),
      /note_category/,
    );
  });

  it("SQL断片のような軸名を拒否する", () => {
    expectReject(
      withSpec({ axes: [{ key: "store; drop table sales" }, { key: "month" }, { key: "product" }] }),
      /使えません/,
    );
  });

  it("同じ軸の重複を拒否する", () => {
    expectReject(withSpec({ axes: [{ key: "store" }, { key: "store" }, { key: "month" }] }), /同じ軸/);
  });

  it("時間軸以外への粒度指定と、一覧に無い粒度を拒否する", () => {
    expectReject(withSpec({ axes: [{ key: "store", grain: "month" }, { key: "month" }, { key: "product" }] }), /粒度/);
    expectReject(withSpec({ axes: [{ key: "store" }, { key: "month", grain: "hour" }, { key: "product" }] }), /粒度/);
  });

  it("列名の軸(columns)はまだ使えない", () => {
    expectReject(withSpec({ axes: [{ key: "store_item" }, { key: "month" }, { key: "product" }] }), /スプリント2/);
  });

  it("値に定義されていない集約を拒否する", () => {
    expectReject(withSpec({ measure: { key: "amount", agg: "latest" } }), /使えません/);
    expectReject(withSpec({ measure: { key: "price", agg: "sum" } }), /ありません/);
  });

  it("条件の op と value の形を確かめる", () => {
    const ok = validateFaceRequest(withSpec({ filters: [{ axis: "store", op: "in", value: ["S001", "S002"] }] }), meta);
    expect(ok.spec.filters).toEqual([{ axis: "store", op: "in", value: ["S001", "S002"] }]);
    expectReject(withSpec({ filters: [{ axis: "store", op: "like", value: "S%" }] }), /op または value/);
    expectReject(withSpec({ filters: [{ axis: "store", op: "between", value: ["S001"] }] }), /op または value/);
  });

  it("上限は 1〜50", () => {
    expectReject(withSpec({ limits: { perAxis: 51 } }), /1〜50/);
  });

  it("行と列に同じ番号は指定できない", () => {
    expectReject({ ...faceRequest(), view: { rows: 1, cols: 1 } }, /異なる番号/);
  });

  it("断面には member が要る", () => {
    expectReject({ ...faceRequest(), depth: { mode: "slice" } }, /depth\.mode/);
  });
});
