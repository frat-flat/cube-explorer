import { describe, expect, it } from "vitest";
import { parseBoxCursor, parseHistoryCursor, parseKind, parseLimit, parseParent, parseText } from "./params";

const ID = "11111111-2222-4333-8444-555555555555";

describe("parseLimit", () => {
  it("なければ既定の件数。上限を超えれば上限に丸める", () => {
    expect(parseLimit(null, 50, 100)).toEqual({ value: 50 });
    expect(parseLimit("", 50, 100)).toEqual({ value: 50 });
    expect(parseLimit("10", 50, 100)).toEqual({ value: 10 });
    expect(parseLimit("100", 50, 100)).toEqual({ value: 100 });
    expect(parseLimit("101", 50, 100)).toEqual({ value: 100 });
    expect(parseLimit("999999999", 50, 100)).toEqual({ value: 100 });
  });
  it("1 以上の整数でなければ断る(0・負・小数・文字・長すぎる数)", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "1e3", " 5", "5 ", "1234567890", "+5"]) expect(parseLimit(bad, 50, 100), bad).toHaveProperty("error");
  });
});

describe("parseHistoryCursor", () => {
  it("なければ null。数字(18 桁まで)だけ通す", () => {
    expect(parseHistoryCursor(null)).toEqual({ value: null });
    expect(parseHistoryCursor("")).toEqual({ value: null });
    expect(parseHistoryCursor("12345")).toEqual({ value: "12345" });
    expect(parseHistoryCursor("123456789012345678")).toEqual({ value: "123456789012345678" });
  });
  it("数字以外・長すぎる数・負の数は断る(データベースに渡さない)", () => {
    for (const bad of ["abc", "1; drop table x", "-1", "1.5", "1234567890123456789", "0x10", "1\u0000"]) expect(parseHistoryCursor(bad), bad).toHaveProperty("error");
  });
});

describe("parseKind", () => {
  it("なければ null。小文字で始まる、小文字・数字・下線の 32 文字までを通す", () => {
    expect(parseKind(null)).toEqual({ value: null });
    expect(parseKind("import")).toEqual({ value: "import" });
    expect(parseKind("sheet_definition2")).toEqual({ value: "sheet_definition2" });
  });
  it("それ以外は断る", () => {
    for (const bad of ["Import", "1abc", "a-b", "a b", "a'; --", "a".repeat(33), "a\u0000"]) expect(parseKind(bad), bad).toHaveProperty("error");
  });
});

describe("parseParent", () => {
  it("なし・root = いちばん上(null)。Box の id(uuid)はそのまま", () => {
    expect(parseParent(null)).toEqual({ value: null });
    expect(parseParent("")).toEqual({ value: null });
    expect(parseParent("root")).toEqual({ value: null });
    expect(parseParent(ID)).toEqual({ value: ID });
  });
  it("root でも uuid でもなければ断る", () => {
    for (const bad of ["ROOT", "abc", `${ID}x`, "1"]) expect(parseParent(bad), bad).toHaveProperty("error");
  });
});

describe("parseBoxCursor", () => {
  it("なければ null。Box の id(uuid)だけ通す", () => {
    expect(parseBoxCursor(null)).toEqual({ value: null });
    expect(parseBoxCursor("")).toEqual({ value: null });
    expect(parseBoxCursor(ID)).toEqual({ value: ID });
  });
  it("uuid でないものは断る(以前の base64 の形・数字・長い文字・NUL も)", () => {
    const old = Buffer.from(JSON.stringify(["x", ID])).toString("base64url");
    for (const bad of ["abc", "12345", `${ID}x`, "bm90LWpzb24", old, "a".repeat(5000), "\u0000", `${ID}\u0000`]) {
      expect(parseBoxCursor(bad), bad.slice(0, 20)).toHaveProperty("error");
    }
  });
});

describe("parseText", () => {
  it("なければ空。上限の長さに切り詰め、前後の空白を外す", () => {
    expect(parseText(null, 100, "q")).toEqual({ value: "" });
    expect(parseText("  法人 ", 100, "q")).toEqual({ value: "法人" });
    expect(parseText("あ".repeat(150), 100, "q")).toEqual({ value: "あ".repeat(100) });
  });
  it("NUL が入っていれば、どこにあっても断る(データベースが 22021 で止まり、500 になるため)。切り詰めで外れる位置のものも断る", () => {
    for (const bad of ["\u0000", "a\u0000b", "法人\u0000", "\u0000法人", "x".repeat(100) + "\u0000", "%\u0000"]) {
      expect(parseText(bad, 100, "q"), JSON.stringify(bad)).toEqual({ error: "q に使えない文字が入っています" });
    }
    expect(parseText("\u0000", 100, "unitType")).toEqual({ error: "unitType に使えない文字が入っています" });
  });
  it("NUL 以外の記号・改行・% _ は、そのまま通す(ワイルドカードにはならない)", () => {
    expect(parseText("a%_b\\", 100, "q")).toEqual({ value: "a%_b\\" });
    expect(parseText("1\n2", 100, "q")).toEqual({ value: "1\n2" });
  });
});
