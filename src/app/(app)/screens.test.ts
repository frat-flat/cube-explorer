import { describe, expect, it } from "vitest";
import { isCurrent, placeOf, SCREENS } from "./screens";

describe("メニューの画面", () => {
  it("並びは ホーム / Task / Import / Table / 履歴 / 設定。旧ダッシュボードはない", () => {
    expect(SCREENS.map((s) => [s.label, s.href])).toEqual([
      ["ホーム", "/"],
      ["Task", "/tasks"],
      ["Import", "/migrate"],
      ["Table", "/table"],
      ["履歴", "/history"],
      ["設定", "/settings"],
    ]);
  });
});

describe("メニューの Task", () => {
  it("ホームの次。区切りの見出しも添え書きもなく、印は ✓", () => {
    expect(SCREENS[1]).toEqual({ href: "/tasks", label: "Task", icon: "✓" });
  });
});

describe("isCurrent(いま開いている画面)", () => {
  it("/ は入口だけ(ほかの画面では印が付かない)", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/migrate", "/")).toBe(false);
    expect(isCurrent("/history", "/")).toBe(false);
    expect(isCurrent("/tasks", "/")).toBe(false);
  });
  it("/tasks は Task だけ(/tasks/… も Task とみなす。名前が前だけ同じ別の画面は違う)", () => {
    expect(isCurrent("/tasks", "/tasks")).toBe(true);
    expect(isCurrent("/tasks/x", "/tasks")).toBe(true);
    expect(isCurrent("/tasksx", "/tasks")).toBe(false);
    expect(isCurrent("/migrate", "/tasks")).toBe(false);
  });
  it("/table?def=… の道筋(/table/…)も /table とみなす。名前が前だけ同じ別の画面は違う", () => {
    expect(isCurrent("/table", "/table")).toBe(true);
    expect(isCurrent("/table/x", "/table")).toBe(true);
    expect(isCurrent("/tables", "/table")).toBe(false);
  });
});

describe("placeOf(今いる場所)", () => {
  it("区切りの見出しがあれば「見出し › 名前」、なければ名前だけ。一覧にない画面は null", () => {
    expect(placeOf("/")).toBe("ホーム");
    expect(placeOf("/tasks")).toBe("Task");
    expect(placeOf("/migrate")).toBe("取り込む › Import");
    expect(placeOf("/table")).toBe("見る › Table");
    expect(placeOf("/history")).toBe("履歴");
    expect(placeOf("/settings")).toBe("設定");
    expect(placeOf("/unknown")).toBeNull();
  });
});
