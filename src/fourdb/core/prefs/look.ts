// 立体のホームの「見た目」(Look)。6 つの部品(形・向き・台座・札・背景・並べ方)の選択肢と、決めた組み合わせ(パターン)。
// 値は英語の固定の目印(id)。日本語の名前は labels.ts。アカウントに覚える(表 principal_pref の look)ときも、この id を保存する。
import { isRecord } from "./record";

/** 部品ごとの選択肢。いちばん前が、その部品の基本の形 */
export const LOOK_OPTIONS = {
  /** Box の形: ガラス / つや消し / 帯つき(青と金の帯は Box の外を回る) / 線と点 */
  shape: ["glass", "solid", "ribbon", "wire"],
  /** Box の向き: 角を下 / 面を下 */
  tilt: ["vertex", "flat"],
  /** 台座: くぼみの台 / 2 段の台 / 光の輪 / 石の台 / 床の円盤 */
  base: ["dish", "plinth", "ring", "stone", "disc"],
  /** 札: 台の下 / 台の正面 / Box の上 */
  label: ["below", "front", "float"],
  /** 背景: ロゴの線 / 静か / 床の格子 */
  bg: ["logo", "quiet", "grid"],
  /** 並べ方: 1 列 / 弧 / ひな壇 */
  layout: ["row", "arc", "stage"],
} as const;

export type LookKey = keyof typeof LOOK_OPTIONS;
export type Look = { [K in LookKey]: (typeof LOOK_OPTIONS)[K][number] };

/** 部品の並び(画面に出す順。保存する JSON のキーもこの 6 つだけ) */
export const LOOK_KEYS: readonly LookKey[] = ["shape", "tilt", "base", "label", "bg", "layout"];

export type PatternId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Pattern = { id: PatternId; look: Readonly<Look> };

const look = (shape: Look["shape"], tilt: Look["tilt"], base: Look["base"], label: Look["label"], bg: Look["bg"], layout: Look["layout"]): Readonly<Look> =>
  Object.freeze({ shape, tilt, base, label, bg, layout });

/**
 * パターン(部品をまとめて切り替える組み合わせ)。試作の 8 つを仮に置いたもの(名前と並びは仮。決めるのはオーナー。D-017)。
 * 試作の部品名との対応: box → shape(glass・solid・ribbon・wire)、tilt・base・label・bg・layout はそのまま。
 */
export const PATTERNS: readonly Pattern[] = Object.freeze([
  Object.freeze({ id: 1 as const, look: look("glass", "flat", "plinth", "below", "logo", "row") }),
  Object.freeze({ id: 2 as const, look: look("solid", "flat", "stone", "front", "quiet", "row") }),
  Object.freeze({ id: 3 as const, look: look("ribbon", "flat", "ring", "float", "logo", "arc") }),
  Object.freeze({ id: 4 as const, look: look("wire", "flat", "disc", "below", "grid", "row") }),
  Object.freeze({ id: 5 as const, look: look("glass", "flat", "disc", "float", "quiet", "arc") }),
  Object.freeze({ id: 6 as const, look: look("ribbon", "flat", "plinth", "below", "logo", "stage") }),
  Object.freeze({ id: 7 as const, look: look("glass", "vertex", "dish", "below", "logo", "row") }),
  Object.freeze({ id: 8 as const, look: look("ribbon", "vertex", "dish", "below", "logo", "row") }),
]);

/** 最初に出すパターン。オーナーが 2026-10-11 に、本物のアプリで撮った全パターンを見て決めた(パターン 3「ロゴの宇宙」: 帯つき・面を下・光の輪・Box の上の札・ロゴの線・弧。D-017) */
export const DEFAULT_PATTERN_ID: PatternId = 3;

/** 最初に出す見た目。書き換えられない。使うときは parseLookLenient(undefined) か { ...DEFAULT_LOOK } で写しを取る */
export const DEFAULT_LOOK: Readonly<Look> = PATTERNS[DEFAULT_PATTERN_ID - 1].look;

/** 6 つの部品がすべて同じパターン(なければ null =「組み合わせ」) */
export function patternOf(l: Look): Pattern | null {
  return PATTERNS.find((p) => LOOK_KEYS.every((k) => p.look[k] === l[k])) ?? null;
}

/** key の選択肢に value があるか(文字列の完全一致) */
export function isLookValue(key: LookKey, value: unknown): boolean {
  return typeof value === "string" && (LOOK_OPTIONS[key] as readonly string[]).includes(value);
}

/**
 * 厳しく読む(書き込み用)。形が違えば理由(日本語の固定の文)を返す。理由に入力の値は入れない。
 * 6 つのキー(shape・tilt・base・label・bg・layout)がすべてあり、値が選択肢のものだけ。
 * 知らないキー・足りないキー・`__proto__`・`constructor`・配列・null・文字列などは通さない。入力と別の新しいオブジェクトを返す。
 */
export function parseLookStrict(input: unknown): Look | string {
  if (!isRecord(input)) return "見た目の指定の形が違います";
  const keys = Reflect.ownKeys(input);
  if (keys.length !== LOOK_KEYS.length || keys.some((k) => typeof k !== "string" || !(LOOK_KEYS as readonly string[]).includes(k))) {
    return "見た目の指定に、知らない項目か足りない項目があります";
  }
  const out: Record<string, string> = {};
  for (const k of LOOK_KEYS) {
    const v = input[k];
    if (!isLookValue(k, v)) return `見た目の「${k}」に選べない値があります`;
    out[k] = v as string;
  }
  return out as Look;
}

/**
 * ゆるく読む(保存してあった値を読み戻すとき用)。形が違うもの・知らない値・足りない部品は、最初に出す見た目(DEFAULT_LOOK)の値にする。
 * 知らないキーは捨てる。いつも新しいオブジェクトを返す(落ちない)。
 */
export function parseLookLenient(input: unknown): Look {
  const out: Record<string, string> = { ...DEFAULT_LOOK };
  if (!isRecord(input)) return out as Look;
  for (const k of LOOK_KEYS) {
    const v = Object.hasOwn(input, k) ? input[k] : undefined;
    if (isLookValue(k, v)) out[k] = v as string;
  }
  return out as Look;
}
