// アカウント(principal)ごとに覚える設定: 明暗(theme)・World・立体の見た目(look)。表 principal_pref(0006)の 1 行。
import { DEFAULT_LOOK, parseLookLenient, parseLookStrict, type Look } from "./look";
import { isRecord } from "./record";

/** 明暗。null = パソコンの設定に合わせる(Prefs.theme のとき) */
export type Theme = "dark" | "light";
export const THEMES: readonly Theme[] = ["dark", "light"];
export const isTheme = (v: unknown): v is Theme => v === "dark" || v === "light";

/** World(まわりの世界)。P2 は「無地」だけ。P5 で増やすときは、ここと表 principal_pref の check(world の形)に足す */
export const WORLDS = ["plain"] as const;
export type WorldId = (typeof WORLDS)[number];
export const DEFAULT_WORLD: WorldId = "plain";
export const isWorldId = (v: unknown): v is WorldId => typeof v === "string" && (WORLDS as readonly string[]).includes(v);

export type Prefs = { theme: Theme | null; world: WorldId; look: Look };

/** 何も覚えていないときの設定(新しいオブジェクト) */
export function defaultPrefs(): Prefs {
  return { theme: null, world: DEFAULT_WORLD, look: { ...DEFAULT_LOOK } };
}

/** PUT /api/4db/prefs の本文。送られた欄だけ入っている(theme: null は「パソコンの設定に合わせる」に戻す) */
export type PrefsPatch = { theme?: Theme | null; world?: WorldId; look?: Look };

const PATCH_KEYS = ["theme", "world", "look"] as const;

/**
 * 厳しく読む(書き込み用)。形が違えば理由(日本語の固定の文)を返す。理由に入力の値は入れない。
 * キーは theme・world・look のうち 1 つ以上で、ほかのキー(`__proto__`・`constructor` を含む)は通さない。
 * theme は "dark"・"light"・null、world は WORLDS のどれか、look は 6 つの部品がそろった parseLookStrict の形。
 * 入力と別の新しいオブジェクトを返す(送られなかった欄は入れない)。
 */
export function parsePrefsPatch(input: unknown): PrefsPatch | string {
  if (!isRecord(input)) return "設定の指定の形が違います";
  const keys = Reflect.ownKeys(input);
  if (keys.some((k) => typeof k !== "string" || !(PATCH_KEYS as readonly string[]).includes(k))) return "設定の指定に、知らない項目があります";
  if (keys.length === 0) return "更新する項目がありません";
  const out: PrefsPatch = {};
  if (keys.includes("theme")) {
    const v = input.theme;
    if (v !== null && !isTheme(v)) return "画面の見た目の指定が違います";
    out.theme = v;
  }
  if (keys.includes("world")) {
    const v = input.world;
    if (!isWorldId(v)) return "World の指定が違います";
    out.world = v;
  }
  if (keys.includes("look")) {
    const v = parseLookStrict(input.look);
    if (typeof v === "string") return v;
    out.look = v;
  }
  return out;
}

/**
 * ゆるく読む(保存してあった行を読み戻すとき用)。raw = { theme, world, look } の形。
 * 形が違うもの・知らない値・足りない部品は既定の値にする(theme は null)。いつも新しいオブジェクトを返す(落ちない)。
 */
export function parsePrefsLenient(raw: unknown): Prefs {
  if (!isRecord(raw)) return defaultPrefs();
  return {
    theme: isTheme(raw.theme) ? raw.theme : null,
    world: isWorldId(raw.world) ? raw.world : DEFAULT_WORLD,
    look: parseLookLenient(raw.look),
  };
}
