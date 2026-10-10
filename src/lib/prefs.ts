// 画面の見た目・メニューの開き閉じを、ブラウザのクッキーに覚える(サーバーが読んで、最初の HTML に反映する)。
// 値は決まったものだけを受け付け、それ以外は無視する(クッキーは利用者が書き換えられるため)。
// 見た目の型(Theme)は芯(src/fourdb/core/prefs)のものを使う。アカウントへの保存は PrefsProvider(src/app/(app)/PrefsProvider.tsx)
import { isTheme, type Theme } from "@/fourdb/core/prefs";

/** 見た目(「暗い」「明るい」)。クッキーがなければ印を付けず、CSS が OS の明暗に合わせる(src/styles/tokens.css) */
export const THEME_COOKIE = "fourdb_theme";

export function parseTheme(value: string | null | undefined): Theme | undefined {
  return isTheme(value) ? value : undefined;
}

/** 左のメニューを開いているか。はじめは閉じていて(クッキーなし)、☰ で開いたときだけ "open" を書く。閉じればクッキーを消す */
export const NAV_COOKIE = "fourdb_nav";

export function parseNavOpen(value: string | null | undefined): boolean {
  return value === "open";
}

const ONE_YEAR = 60 * 60 * 24 * 365;

/** ブラウザ側でクッキーを書く(value が null なら消す)。この設定の値は秘密ではないので HttpOnly にはしない(JS から書くため) */
export function writeCookie(name: string, value: string | null) {
  document.cookie = `${name}=${value ?? ""}; path=/; max-age=${value === null ? 0 : ONE_YEAR}; samesite=lax`;
}

/** document.cookie の文字列から、名前の一致するクッキーの値を取り出す(なければ null)。名前は完全一致 */
export function readCookieValue(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
