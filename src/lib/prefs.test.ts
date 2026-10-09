import { describe, expect, it } from "vitest";
import { NAV_COOKIE, parseNavOpen, parseTheme, THEME_COOKIE } from "./prefs";

describe("見た目のクッキー fourdb_theme", () => {
  it("名前", () => {
    expect(THEME_COOKIE).toBe("fourdb_theme");
    expect(NAV_COOKIE).toBe("fourdb_nav");
  });

  it("dark と light だけを受け付け、それ以外は無視する(印を付けない)", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    for (const bad of [undefined, null, "", "auto", "Dark", "LIGHT", " dark", "dark ", "a-dark", "b-light", "dark;x=1", '"><script>', "0"]) {
      expect(parseTheme(bad as string | null | undefined), String(bad)).toBeUndefined();
    }
  });
});

describe("メニューの開き閉じのクッキー fourdb_nav", () => {
  it("はじめ(クッキーなし)は閉じていて、open のときだけ開いている", () => {
    expect(parseNavOpen("open")).toBe(true);
    for (const other of [undefined, null, "", "closed", "Open", "1", "true"]) expect(parseNavOpen(other as string | null | undefined), String(other)).toBe(false);
  });
});
