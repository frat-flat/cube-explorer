import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 色の元(ビルドの道具。型は付いていないので any 扱い)
import { contrastReport, EFFECTS, PAIRS, renderTokensCss, THEMES } from "../../tools/design/tokens.mjs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const tokensCss = read("./tokens.css");

describe("tokens.css(色の元 tools/design/tokens.mjs から作った生成物)", () => {
  it("元とずれていない(色を変えたら npm run tokens で作り直す)", () => {
    expect(tokensCss).toBe(renderTokensCss());
  });

  it("出す見た目は 2 つだけ: 明るい(印なし・light)と、暗い(OS が暗いとき・dark)。どちらも color-scheme を出す", () => {
    expect(Object.keys(THEMES)).toEqual(["light", "dark"]);
    expect(tokensCss).toContain(':root,\n[data-theme="light"] {\n  color-scheme:light;');
    expect(tokensCss).toContain("@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    color-scheme:dark;");
    expect(tokensCss).toContain('[data-theme="dark"] {\n  color-scheme:dark;');
    // 使わない見た目(A の明るい版・B の暗い版)は出さない
    expect(tokensCss).not.toMatch(/data-theme="(a|b)-/);
    expect(tokensCss).not.toMatch(/data-(dir|mode)/);
  });

  it("明るい = デザイン B の light、暗い = デザイン A の dark の色", () => {
    expect(THEMES.light).toMatchObject({ bg: "#f3f1ec", surface: "#fffdf8", accent: "#2c5b8c", "on-accent": "#ffffff" });
    expect(THEMES.dark).toMatchObject({ bg: "#05070b", surface: "#0a0e15", accent: "#6aa6db", "on-accent": "#05070b" });
  });

  it("2 つの見た目が同じ変数を持つ(どちらかにだけない色がない)", () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
    expect(Object.keys(EFFECTS.dark).sort()).toEqual(Object.keys(EFFECTS.light).sort());
  });
});

describe("文字と地の組みの読みやすさ(WCAG 2.x。文字 4.5・図形 3 以上)", () => {
  const report = contrastReport() as Record<string, { what: string; fg: string; bg: string; ratio: number; min: number; pass: boolean }[]>;

  for (const name of ["light", "dark"]) {
    it(`${name === "light" ? "明るい" : "暗い"}: すべての組みが基準を満たす`, () => {
      const rows = report[name];
      expect(rows).toHaveLength(PAIRS.length);
      expect(rows.length).toBeGreaterThan(30);
      for (const r of rows) expect(r.ratio, `${r.what}(${r.fg} / ${r.bg})`).toBeGreaterThanOrEqual(r.min);
      expect(rows.filter((r) => !r.pass)).toEqual([]);
    });
  }

  it("文字は 4.5、図形(枠・線・フォーカス)は 3 の基準で確かめている。主ボタンの文字(--on-accent)も含む", () => {
    expect(new Set(PAIRS.map((p) => p[2]))).toEqual(new Set([4.5, 3]));
    expect(PAIRS.some((p) => p[0] === "on-accent" && p[1] === "accent" && p[2] === 4.5)).toBe(true);
  });
});

describe("画面の CSS が色を直書きしていない(設定の見た目と食い違わない)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []));
  const srcDir = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const all = files(srcDir);
  // ログイン画面(ロゴの絵とその動き)は、いつも黒の別の決まり。tokens.css は生成物なので数えない
  const screens = all.filter((f) => !/[\\/]login[\\/]/.test(f) && !f.endsWith("tokens.css"));

  it("対象のファイルが見つかる", () => {
    expect(screens.map((f) => f.replace(/\\/g, "/").split("/src/")[1]).sort()).toEqual(
      expect.arrayContaining(["app/globals.css", "styles/components.css", "app/(app)/table/sheet.module.css", "app/(app)/settings/settings.module.css"]),
    );
  });

  it("色(#rrggbb・rgb()・hsl())と、@media (prefers-color-scheme) の上書きを書かない", () => {
    for (const f of screens) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, f).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(css, f).not.toMatch(/prefers-color-scheme/);
    }
  });

  it("使っている var(--名前) は、tokens.css か、どこかの CSS が定義している", () => {
    const defined = new Set<string>();
    for (const f of all) for (const m of readFileSync(f, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    // next/font が html に付ける変数
    for (const v of ["--font-sans", "--font-display", "--font-mono"]) defined.add(v);
    for (const f of screens) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\((--[a-z0-9-]+)/g)) expect(defined.has(m[1]), `${f}: ${m[1]}`).toBe(true);
    }
  });

  it("read() は CRLF でも同じに読む(Windows の作業コピーでも比べられる)", () => {
    expect(read("./tokens.css")).not.toContain("\r");
  });
});
