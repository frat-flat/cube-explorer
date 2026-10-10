// アカウントに覚える設定の、ブラウザ側の実物(通信・localStorage・クッキー)。PrefsStore(prefs-sync.ts)に渡す。
// localStorage とクッキーは、使えない(無効・容量いっぱい・保存禁止)ことがあるので、すべて try/catch で包み、落とさない。
import { parsePrefsLenient, type PrefsPatch, type Theme } from "@/fourdb/core/prefs";
import { parseTheme, readCookieValue, THEME_COOKIE, writeCookie } from "@/lib/prefs";
import { isEmptyPatch, parseStoredPending, PENDING_KEY, type PutOutcome, type ServerPrefs, type StoreDeps } from "./prefs-sync";

const PREFS_URL = "/api/4db/prefs";

/** GET /api/4db/prefs。形が違えば throw(中身は、知らない値を既定にしてゆるく読む) */
export async function loadServerPrefs(signal: AbortSignal): Promise<ServerPrefs> {
  const res = await fetch(PREFS_URL, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`設定を読めませんでした(${res.status})`);
  const j: unknown = await res.json();
  if (typeof j !== "object" || j === null || Array.isArray(j)) throw new Error("設定の答えの形が違います");
  const r = j as { available?: unknown; saved?: unknown; prefs?: unknown };
  return { available: r.available === true, saved: r.saved === true, prefs: parsePrefsLenient(r.prefs) };
}

/** PUT /api/4db/prefs。503 の prefs_unavailable は「まだ使えない」、そのほかの失敗は「送れなかった」。通信そのものの失敗は throw のまま */
export async function putServerPrefs(patch: PrefsPatch, keepalive: boolean): Promise<PutOutcome> {
  const res = await fetch(PREFS_URL, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
    credentials: "same-origin",
    keepalive,
  });
  if (res.ok) return "ok";
  if (res.status === 503) {
    const j: unknown = await res.json().catch(() => null);
    if (typeof j === "object" && j !== null && (j as { code?: unknown }).code === "prefs_unavailable") return "unavailable";
  }
  return "error";
}

/**
 * 送っていない変更を localStorage から読む(なければ・読めなければ {})。
 * 読めない(JSON でない)・形が違う値は、読んだ上で消す(書き換えられた・壊れた値を、次の読み込みでも読み直し続けない)
 */
export function readStoredPending(): PrefsPatch {
  try {
    const text = window.localStorage.getItem(PENDING_KEY);
    if (text === null) return {};
    const patch = parseStoredPending(text);
    if (isEmptyPatch(patch)) window.localStorage.removeItem(PENDING_KEY);
    return patch;
  } catch {
    return {};
  }
}

/** 送っていない変更を localStorage に書く(null か空なら消す) */
export function writeStoredPending(patch: PrefsPatch | null): void {
  try {
    if (!patch || isEmptyPatch(patch)) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(patch));
  } catch {
    // 保存できなくても、この画面の中では変更が効いている(次のタブには残らない)
  }
}

/**
 * ログアウトのとき、この端末に残した「送っていない変更」を消す(次にこのブラウザでログインする別のアカウントに、前の人の変更を送らない)。
 * 明暗のクッキーは消さない(ログイン画面も同じ明暗で出す)。落ちない
 */
export function clearStoredPending(): void {
  writeStoredPending(null);
}

/** いまのクッキーの明暗(なければ null =「パソコンの設定に合わせる」) */
export function readCookieTheme(): Theme | null {
  try {
    return parseTheme(readCookieValue(document.cookie, THEME_COOKIE)) ?? null;
  } catch {
    return null;
  }
}

/** クッキーと <html data-theme> を明暗に合わせる(null はクッキーと印を消す。CSS が OS の明暗に合わせる) */
export function applyTheme(theme: Theme | null): void {
  try {
    writeCookie(THEME_COOKIE, theme);
  } catch {
    // クッキーが書けなくても、いまの画面は変える
  }
  const root = document.documentElement;
  if (theme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** ブラウザで使う実物 */
export function browserDeps(): StoreDeps {
  return { load: loadServerPrefs, put: putServerPrefs, readStored: readStoredPending, writeStored: writeStoredPending, readCookieTheme, applyTheme };
}

/** Provider の外で使うとき(アカウントへは何も送らず、クッキーと印だけを変える) */
export function cookieOnlyDeps(): StoreDeps {
  return {
    load: () => Promise.reject(new Error("Provider の外では読み込まない")),
    put: () => Promise.resolve("unavailable"),
    readStored: () => ({}),
    writeStored: () => {},
    readCookieTheme,
    applyTheme,
  };
}
