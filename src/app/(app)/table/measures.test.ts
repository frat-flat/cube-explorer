import { describe, expect, it } from "vitest";
import { measureGoneMessage, measureLabel, measureMissingMessage, measuresIn } from "./measures";

const measures = [
  { id: "m1", name: "売上", sheets: 2, sheetIds: ["a", "b"] },
  { id: "m2", name: "経費", sheets: 1, sheetIds: ["c"] },
  { id: "m3", name: "精算額", sheets: 2, sheetIds: ["b", "c"] },
];

describe("数値の一覧を、選んだシートで絞る", () => {
  it("何も選んでいなければ(すべてのシート)、すべての数値", () => {
    expect(measuresIn(measures, null)).toEqual(measures);
  });

  it("選んだシートにある数値だけを残し、添え書きの数は選んだシートの中での数にする", () => {
    expect(measuresIn(measures, ["a"]).map((m) => [m.name, m.sheets])).toEqual([["売上", 1]]);
    expect(measuresIn(measures, ["b"]).map((m) => [m.name, m.sheets])).toEqual([["売上", 1], ["精算額", 1]]);
    expect(measuresIn(measures, ["b", "c"]).map((m) => [m.name, m.sheets])).toEqual([["売上", 1], ["経費", 1], ["精算額", 2]]);
  });

  it("今は見つからないシートが混じっていても、見つかるものだけで絞る", () => {
    expect(measuresIn(measures, ["gone", "c"]).map((m) => m.name)).toEqual(["経費", "精算額"]);
    expect(measuresIn(measures, ["gone"])).toEqual([]);
  });

  it("元の一覧は書き換えない", () => {
    measuresIn(measures, ["a"]);
    expect(measures[0].sheetIds).toEqual(["a", "b"]);
  });
});

describe("文言", () => {
  it("数値の添え書きは「(シート N 個)」", () => {
    expect(measureLabel({ name: "売上", sheets: 3 })).toBe("売上(シート 3 個)");
  });

  it("選んだシートに数値がないときの知らせ", () => {
    expect(measureMissingMessage("売上")).toBe("選んだシートには『売上』がありません。数値かシートを選び直してください。");
  });

  it("保存した表の数値が今のデータにないときの知らせ(名前が分かれば名前を出す)", () => {
    expect(measureGoneMessage("精算額")).toBe("保存した表の数値『精算額』が見つかりません。数値を選び直してください。");
    expect(measureGoneMessage(null)).toBe("保存した表の数値が見つかりません。数値を選び直してください。");
  });
});
