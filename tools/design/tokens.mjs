// 画面の色(デザイントークン)の元。ロゴの色から作った 2 つの見た目:
//   「明るい」= デザイン B(紙と光)の明るい版(light)  「暗い」= デザイン A(宇宙)の暗い版(dark)   (D-012)
// 色はここだけで決め、src/styles/tokens.css を作る(生成物もコミットする)。作り直すときは:
//   node tools/design/tokens.mjs        (npm run tokens)
// 文字と地の組みの読みやすさ(文字 4.5・図形 3 以上。WCAG 2.x)は src/styles/tokens.test.ts が確かめる。
// 使わない見た目(A の明るい版・B の暗い版)は出さない(2026-10-09 決定)。
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// ロゴ(tools/brand/4db-logo.webp)から読み取った色
export const LOGO = {
  black: "#010101",
  blue900: "#283c54", blue700: "#3a587a", blue500: "#5179a3", blue400: "#789ec3", blueSig: "#6aa6db", blue200: "#b0cce5", blue100: "#cee2f5",
  gold900: "#6f5841", gold600: "#ba9f7d", goldSig: "#dbaf77", gold300: "#d9be9c", gold200: "#edd5b5", goldDot: "#f8deb8", gold100: "#faefdc", gold50: "#fef6e9",
  silver: "#b0b0af", tagline: "#a1a19f", glow: "#f9f9f3", crosshair: "#746453", word4: "#779cbf", wordB: "#cca57d",
};

/** 見た目ごとの色。キーは CSS の変数名(--キー) */
export const THEMES = {
  // 明るい(デザイン B の light)。ヘッダーだけは黒い帯(ロゴの黒地をそのまま見せる)
  light: {
    "on-hl": "#14100a", "page-word-1": "#2c5b8c", "page-word-2": "#5a6270", "page-word-3": "#84571b",
    "word-1": LOGO.word4, "word-2": LOGO.silver, "word-3": LOGO.wordB,
    bg: "#f3f1ec", surface: "#fffdf8", raised: "#ffffff", sunken: "#faf8f3",
    line: "#e3ded4", "line-strong": "#958c7d",
    ink: "#1b2330", "ink-strong": "#10161f", muted: "#5b6270",
    accent: "#2c5b8c", "accent-hover": "#22476e", "accent-soft": "#e8eef5", "on-accent": "#ffffff",
    hl: "#b47e37", "hl-text": "#84571b", "hl-strong": "#b8884a", "hl-soft": "#f8eedd",
    danger: "#b3261e", ok: "#1c7549", focus: "#2c5b8c",
    "head-bg": "#050608", "head-ink": "#ece9e2", "head-muted": "#a1a19f", "head-line": "#050608",
    "nav-on-bg": "#ece6da", "th-bg": "#f1ede5", "th-ink": "#333b47",
    "sub-bg": "#edf1f6", "sub-line": "#6c8bb1", "grand-bg": "#f8efdf", "grand-line": "#a37a42", "calc-mark": "#84571b",
    "tag-dim-bg": "#e4f1e9", "tag-dim-ink": "#1b5a3c", "tag-mea-bg": "#e8eef5", "tag-mea-ink": "#2c5b8c",
    "tag-att-bg": "#f8eedd", "tag-att-ink": "#7a5016", "tag-agg-bg": "#f1eaf5", "tag-agg-ink": "#5d3c80",
  },
  // 暗い(デザイン A の dark)
  dark: {
    "on-hl": "#14100a", "page-word-1": LOGO.word4, "page-word-2": LOGO.silver, "page-word-3": LOGO.wordB,
    "word-1": LOGO.word4, "word-2": LOGO.silver, "word-3": LOGO.wordB,
    bg: "#05070b", surface: "#0a0e15", raised: "#10151f", sunken: "#070a10",
    line: "#1b2330", "line-strong": "#56647a",
    ink: "#e4e9f0", "ink-strong": LOGO.glow, muted: "#98a3b5",
    accent: LOGO.blueSig, "accent-hover": "#8fc0ea", "accent-soft": "#0f1c2b", "on-accent": "#05070b",
    hl: LOGO.goldSig, "hl-text": "#e7c48f", "hl-strong": LOGO.goldDot, "hl-soft": "#211a11",
    danger: "#f28b7f", ok: "#6fcf97", focus: LOGO.goldDot,
    "head-bg": "#05070b", "head-ink": "#e4e9f0", "head-muted": "#98a3b5", "head-line": "#1b2330",
    "nav-on-bg": "#0f1724", "th-bg": "#0d121b", "th-ink": "#c3cbd8",
    "sub-bg": "#0e1825", "sub-line": "#4f6e90", "grand-bg": "#19160f", "grand-line": "#b8956a", "calc-mark": "#e7c48f",
    "tag-dim-bg": "#10241c", "tag-dim-ink": "#8fd6b0", "tag-mea-bg": "#0f1c2b", "tag-mea-ink": "#8fc0ea",
    "tag-att-bg": "#211a11", "tag-att-ink": "#e7c48f", "tag-agg-bg": "#1e1729", "tag-agg-ink": "#c8b0ec",
  },
};

/** 色以外の効果(光・影・合計のマスの色)。読みやすさの確認の対象ではない */
export const EFFECTS = {
  light: {
    "glow-hl": "none", "glow-ac": "none",
    "card-shadow": "0 1px 2px rgba(70,50,20,.05)", "tot-bg": "color-mix(in srgb,var(--accent) 6%,transparent)",
    "side-bg": "var(--surface)", "focus-halo": "none", "body-bg": "var(--bg)",
  },
  dark: {
    "glow-hl": "0 0 7px color-mix(in srgb,var(--hl) 75%,transparent)", "glow-ac": "0 0 14px color-mix(in srgb,var(--accent) 35%,transparent)",
    "card-shadow": "inset 0 1px 0 rgba(255,255,255,.035)", "tot-bg": "color-mix(in srgb,var(--accent) 5%,transparent)",
    "side-bg": "color-mix(in srgb,var(--bg) 70%,transparent)", "focus-halo": "0 0 0 4px color-mix(in srgb,var(--focus) 18%,transparent)",
    // ロゴの光のような、ごくうすい明かりを右上と左下に(控えめに)
    "body-bg": "radial-gradient(1100px 520px at 88% -12%, color-mix(in srgb,var(--accent) 9%,transparent), transparent 62%), radial-gradient(800px 420px at 4% 108%, color-mix(in srgb,var(--hl) 5%,transparent), transparent 60%), var(--bg)",
  },
};

// ---- 文字と地の読みやすさ(WCAG 2.x のコントラスト比) ----
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** [文字(または図形)の色, 地の色, 最低の比(文字 4.5・図形 3), 何の組みか] */
export const PAIRS = [
  ["ink", "bg", 4.5, "本文 / 地"], ["ink", "surface", 4.5, "本文 / 面"], ["ink", "raised", 4.5, "本文 / 浮いた面"],
  ["muted", "bg", 4.5, "補足 / 地"], ["muted", "surface", 4.5, "補足 / 面"], ["muted", "raised", 4.5, "補足 / 浮いた面"],
  ["accent", "surface", 4.5, "リンク・選択 / 面"], ["accent", "bg", 4.5, "リンク / 地"], ["on-accent", "accent", 4.5, "主ボタンの文字"],
  ["accent", "nav-on-bg", 4.5, "選んだメニュー"], ["ink", "accent-soft", 4.5, "本文 / 薄い青(チップ)"],
  ["hl-text", "surface", 4.5, "金の文字 / 面"], ["danger", "surface", 4.5, "エラー / 面"], ["ok", "surface", 4.5, "OK / 面"],
  ["th-ink", "th-bg", 4.5, "表の見出し"], ["muted", "th-bg", 4.5, "補足 / 表の見出し"],
  ["ink", "sub-bg", 4.5, "Σ 小計の行"], ["ink", "grand-bg", 4.5, "Σ 総計の行"], ["hl-text", "grand-bg", 4.5, "Σ 印(金) / 総計"],
  ["calc-mark", "surface", 4.5, "ƒ 印 / 面"], ["calc-mark", "sub-bg", 4.5, "ƒ 印 / 小計"],
  ["head-ink", "head-bg", 4.5, "ヘッダーの文字"], ["word-1", "head-bg", 4.5, "4DB の文字(青)"], ["word-2", "head-bg", 4.5, "4DB の文字(銀)"], ["word-3", "head-bg", 4.5, "4DB の文字(金)"], ["head-muted", "head-bg", 4.5, "ヘッダーの補足"],
  ["page-word-1", "bg", 4.5, "画面上の 4DB(青)"], ["page-word-2", "bg", 4.5, "画面上の 4DB(銀)"], ["page-word-3", "bg", 4.5, "画面上の 4DB(金)"], ["on-hl", "hl", 4.5, "金の数字バッジ"],
  ["tag-dim-ink", "tag-dim-bg", 4.5, "役割: 分類(軸)"], ["tag-mea-ink", "tag-mea-bg", 4.5, "役割: 数値"],
  ["tag-att-ink", "tag-att-bg", 4.5, "役割: 属性(Card)"], ["tag-agg-ink", "tag-agg-bg", 4.5, "役割: 合計"],
  ["focus", "surface", 3, "フォーカスの輪 / 面"], ["focus", "bg", 3, "フォーカスの輪 / 地"],
  ["line-strong", "surface", 3, "入力欄の枠 / 面"], ["line-strong", "sunken", 3, "入力欄の枠 / 入力の地"],
  ["grand-line", "grand-bg", 3, "総計の二重線"], ["sub-line", "sub-bg", 3, "小計の点線"], ["hl", "surface", 3, "金の点・線(図形)"],
];

/** 見た目ごと・組みごとの読みやすさ */
export function contrastReport() {
  const report = {};
  for (const [name, t] of Object.entries(THEMES)) {
    report[name] = PAIRS.map(([fg, bg, min, what]) => {
      const ratio = contrast(t[fg], t[bg]);
      return { what, fg, bg, fgHex: t[fg], bgHex: t[bg], ratio: +ratio.toFixed(2), min, pass: ratio >= min };
    });
  }
  return report;
}

const block = (name) => Object.entries({ ...THEMES[name], ...EFFECTS[name] }).map(([k, v]) => `--${k}:${v};`);
const indent = (lines, n) => lines.map((l) => " ".repeat(n) + l).join("\n");

/**
 * src/styles/tokens.css の中身。
 *  - 明るい: 印のない画面と [data-theme="light"]
 *  - 暗い: 印のない画面で OS が暗いとき(@media)と、[data-theme="dark"](設定で選んだとき・ログイン画面)
 * どれも color-scheme も出す(入力欄・スクロールバーなどをブラウザが合わせる)
 */
export function renderTokensCss() {
  return [
    "/* generated by tools/design/tokens.mjs — do not edit by hand. 作り直し: npm run tokens */",
    ':root,\n[data-theme="light"] {',
    indent(["color-scheme:light;", ...block("light")], 2),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not([data-theme]) {",
    indent(["color-scheme:dark;", ...block("dark")], 4),
    "  }",
    "}",
    '[data-theme="dark"] {',
    indent(["color-scheme:dark;", ...block("dark")], 2),
    "}",
    "",
  ].join("\n");
}

export const TOKENS_CSS_PATH = fileURLToPath(new URL("../../src/styles/tokens.css", import.meta.url));

// 直接実行したときだけ書き出す(テストから読み込んだときは書かない)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(TOKENS_CSS_PATH, renderTokensCss());
  console.log(`wrote ${TOKENS_CSS_PATH}`);
  for (const [name, rows] of Object.entries(contrastReport())) {
    console.log(`\n== ${name}`);
    for (const r of rows) console.log(`${r.pass ? "  " : "!!"} ${r.ratio.toFixed(2).padStart(5)} (>=${r.min}) ${r.what}  ${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex}`);
  }
}
