// 立体の色。tokens.css の変数を <html> から読む(明るい・暗いが変わったら読み直す)。
// 読めない値(空・知らない書き方)は、明るい見た目の値にする(THREE.Color に渡して警告を出さないため)。
import { Color } from "three";

export type Palette = {
  dark: boolean;
  bg: string;
  surface: string;
  raised: string;
  sunken: string;
  line: string;
  lineStrong: string;
  ink: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  hl: string;
  hlStrong: string;
  hlSoft: string;
  word1: string;
  word3: string;
};

type ColorKey = Exclude<keyof Palette, "dark">;

/** 変数の名前と、読めないときの値(tokens.css の明るい見た目) */
const TOKENS: Record<ColorKey, [string, string]> = {
  bg: ["--bg", "#f3f1ec"],
  surface: ["--surface", "#fffdf8"],
  raised: ["--raised", "#ffffff"],
  sunken: ["--sunken", "#faf8f3"],
  line: ["--line", "#e3ded4"],
  lineStrong: ["--line-strong", "#958c7d"],
  ink: ["--ink", "#1b2330"],
  muted: ["--muted", "#5b6270"],
  accent: ["--accent", "#2c5b8c"],
  accentHover: ["--accent-hover", "#22476e"],
  accentSoft: ["--accent-soft", "#e8eef5"],
  hl: ["--hl", "#b47e37"],
  hlStrong: ["--hl-strong", "#b8884a"],
  hlSoft: ["--hl-soft", "#f8eedd"],
  word1: ["--word-1", "#779cbf"],
  word3: ["--word-3", "#cca57d"],
};

/** #rgb・#rrggbb・rgb()/rgba() だけを通す(THREE.Color が警告なしに読める形) */
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d+(\.\d+)?%?\s*,\s*\d+(\.\d+)?%?\s*,\s*\d+(\.\d+)?%?\s*(,\s*[\d.]+\s*)?\))$/i;

export function readPalette(root: Element = document.documentElement): Palette {
  const cs = getComputedStyle(root);
  const out = {} as Record<ColorKey, string>;
  for (const key of Object.keys(TOKENS) as ColorKey[]) {
    const [name, fallback] = TOKENS[key];
    const v = cs.getPropertyValue(name).trim();
    out[key] = COLOR_RE.test(v) ? v : fallback;
  }
  const c = new Color(out.bg);
  return { ...out, dark: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.35 };
}

/** 色(sRGB の文字か Color)を、描くときの直線の色に */
export const lin = (c: string | Color): Color => new Color(c).convertSRGBToLinear();

/** 2 つの色を t の割合で混ぜる(sRGB のまま) */
export const mix = (a: string, b: string, t: number): Color => new Color(a).lerp(new Color(b), t);
