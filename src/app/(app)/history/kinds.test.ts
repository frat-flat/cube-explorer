import { describe, expect, it } from "vitest";
import { formatAt, historyLink, kindName } from "./kinds";

describe("kindName(履歴の種類の日本語)", () => {
  it("取り込み・表の保存。ない種類は「その他」", () => {
    expect(kindName("import")).toBe("取り込み");
    expect(kindName("definition")).toBe("表の保存");
    expect(kindName("mapping")).toBe("その他");
    expect(kindName("")).toBe("その他");
    expect(kindName("constructor")).toBe("その他"); // 種類の名前が Object の持ち物と重なっても、その他
  });
});

describe("historyLink(履歴から移る画面)", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("取り込みは Import へ", () => {
    expect(historyLink({ kind: "import", definitionId: null })).toEqual({ href: "/migrate", label: "Import を開く" });
  });
  it("表の保存は、保存した表を開いた Table へ(/table?def=<id>)", () => {
    expect(historyLink({ kind: "definition", definitionId: id })).toEqual({ href: `/table?def=${id}`, label: "Table で開く" });
  });
  it("表の保存でも id がなければ移れない。ほかの種類も移れない", () => {
    expect(historyLink({ kind: "definition", definitionId: null })).toBeNull();
    expect(historyLink({ kind: "edit", definitionId: null })).toBeNull();
  });
});

describe("formatAt(日時の表示)", () => {
  it("見ている人の時刻で「年-月-日 時:分」(0 埋め)", () => {
    expect(formatAt(new Date(2026, 9, 8, 14, 5).toISOString())).toBe("2026-10-08 14:05");
    expect(formatAt(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("2026-01-02 03:04");
  });
  it("読めない日時は空", () => {
    expect(formatAt("not a date")).toBe("");
  });
});
