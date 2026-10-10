import { describe, expect, it } from "vitest";
import { NAV_COOKIE, parseNavOpen, parseTheme, readCookieValue, THEME_COOKIE } from "./prefs";

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

describe("readCookieValue(document.cookie から名前で取り出す)", () => {
  it("名前が完全に一致するクッキーの値を返す。前後の空白は除く", () => {
    expect(readCookieValue("fourdb_theme=dark", THEME_COOKIE)).toBe("dark");
    expect(readCookieValue("a=1; fourdb_theme=light; fourdb_nav=open", THEME_COOKIE)).toBe("light");
    expect(readCookieValue("a=1;   fourdb_nav=open ", NAV_COOKIE)).toBe("open");
  });

  it("ないとき・名前の一部だけ同じ・値が空のとき", () => {
    expect(readCookieValue("", THEME_COOKIE)).toBeNull();
    expect(readCookieValue("a=1; b=2", THEME_COOKIE)).toBeNull();
    expect(readCookieValue("xfourdb_theme=dark; fourdb_theme_x=light", THEME_COOKIE)).toBeNull();
    expect(readCookieValue("fourdb_theme", THEME_COOKIE)).toBeNull();
    expect(readCookieValue("fourdb_theme=", THEME_COOKIE)).toBe("");
  });

  it("値に = が入っていても、最初の = で分ける", () => {
    expect(readCookieValue("k=a=b", "k")).toBe("a=b");
  });
});
