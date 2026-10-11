import { chromium, expect, test, type Page } from "@playwright/test";
import { distinctColors, externalHosts, openHome, openMenu, overviewOf, resetPrefs, stage, stubHome, unitOf, watch } from "./support";

// ホームの舞台(3D)の、使えない場合・動きを減らす設定・文脈の扱い・読み込み。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/stage.spec.ts
// ヘッドレスの WebGL は SwiftShader(playwright.config.ts)。3D の試験は 1 つずつ(workers = 1)。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 180_000 });

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const FLAT_NOTE = "3D を表示できなかったため、平らな一覧で表示しています。";
const SECTION_ORDER = ["names", "inside", "cardFields", "measures", "period", "sheets", "tables", "cube", "bands"];

/** 合成データ: 単位 3 つ(2 つは全部の欄に値あり)と、ほかの単位 */
const sample = () =>
  overviewOf(
    [
      unitOf("法人", 2, {
        inside: { items: [{ unitType: "拠点", count: 6 }], more: 0 },
        measures: { items: [{ name: "売上", calculated: false }, { name: "精算額", calculated: true }], more: 0 },
        period: { from: "2026-04", to: "2026-09" },
        sheets: { items: [{ sheetId: "s", file: "売上", sheet: "2026年度" }], more: 0, lastReadAt: "2026-10-09T16:30:00.000Z" },
        tables: { items: [{ id: "11111111-2222-4333-8444-555555555555", name: "月次" }], more: 0 },
      }),
      unitOf("店舗", 3),
      unitOf(null, 1),
    ],
    { items: [{ unitType: "部署", count: 12 }], more: 3 },
  );

/** 平らなタイルの確かめ(どの「3D が使えない」でも同じ) */
async function expectFlat(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-mode", "flat", { timeout: 60_000 });
  await expect(page.getByText(FLAT_NOTE)).toBeVisible();
  await expect(stage(page).locator("canvas")).toHaveCount(0);
  const tiles = page.locator("article");
  await expect(tiles).toHaveCount(3);
  // 単位ごとのタイルに、右の欄と同じ欄が固定の順で全部(値がなければ「—」)
  for (let i = 0; i < 3; i++) {
    const ids = await tiles.nth(i).locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    expect(ids, `タイル ${i}`).toEqual(SECTION_ORDER);
  }
  await expect(tiles.nth(0).getByRole("heading")).toContainText("法人");
  await expect(tiles.nth(0)).toContainText("2026-04〜2026-09");
  await expect(tiles.nth(0).getByRole("img", { name: "計算された値" })).toHaveText("ƒ");
  await expect(tiles.nth(0)).toContainText("最後に取り込んだ日 2026-10-10");
  await expect(tiles.nth(0).getByRole("link", { name: /月次/ })).toHaveAttribute("href", "/table?def=11111111-2222-4333-8444-555555555555");
  expect(norm(await tiles.nth(1).locator('[data-section="inside"] dd').innerText())).toBe("—");
  await expect(tiles.nth(2).getByRole("heading")).toContainText("(単位なし)");
  expect(norm(await page.getByText("ほかの単位:").innerText())).toBe("ほかの単位: 部署 12 ほか 3");
  // 札・Visual のボタン・右の欄は、平らなタイルにはない(タイルが全部の情報を持つ)
  await expect(page.locator('ul[aria-label="単位ごとの Box"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Visual/ })).toHaveCount(0);
  await expect(stage(page)).not.toHaveAttribute("data-ready", "true");
}

test.describe("3D が使えないときは、平らなタイル(data-mode=flat)", () => {
  test("getContext が null を返す(addInitScript)", async ({ page, baseURL }) => {
    await resetPrefs(page.request);
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/i.test(type) ? null : (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    const w = watch(page);
    await stubHome(page, sample());
    await page.goto("/");
    await expectFlat(page);
    expect(w.problems, "コンソールの error・warning").toEqual([]);
    expect(externalHosts(w, baseURL!)).toEqual([]);
  });

  test("ブラウザを --disable-3d-apis で起動する(本物の WebGL なし)", async ({ baseURL }) => {
    const browser = await chromium.launch({ args: ["--disable-3d-apis"] });
    try {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const w = watch(page);
      await stubHome(page, sample());
      await page.goto("/");
      await expectFlat(page);
      expect(w.problems).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });

  test("最初の文脈は作れるが、立体を作るときに作れない(mountStage が throw)", async ({ page }) => {
    await resetPrefs(page.request);
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      let n = 0;
      // 1 回目(canUseWebGL の確かめ)は本物、あとは null(three の WebGLRenderer が作れない)
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type) && ++n > 1) return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    await stubHome(page, sample());
    await page.goto("/");
    await expectFlat(page);
  });

  test("立体の部品の読み込みに失敗したとき(import() が落ちる)", async ({ page }) => {
    await resetPrefs(page.request);
    // 立体のモジュール(home3d)を持つ塊は、ホームを開いたときに読み込まれる。three を含む JS の読み込みを断つ
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
      const res = await route.fetch();
      const text = await res.text();
      if (/WebGLRenderer/.test(text)) return route.abort("failed");
      return route.fulfill({ response: res, body: text });
    });
    await stubHome(page, sample());
    await page.goto("/");
    await expectFlat(page);
  });

  test("WEBGL_lose_context で文脈を失うと、3D から平らなタイルに切り替わる(canvas は外れ、エラーを出さない)", async ({ page }) => {
    await resetPrefs(page.request);
    const w = watch(page);
    await stubHome(page, sample());
    await openHome(page);
    await expect(stage(page).locator("canvas")).toHaveCount(1);
    await page.evaluate(() => {
      const c = document.querySelector("section[data-mode] canvas") as HTMLCanvasElement;
      const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGL2RenderingContext;
      gl.getExtension("WEBGL_lose_context")!.loseContext();
    });
    await expectFlat(page);
    await page.waitForTimeout(500);
    // 失った文脈の WARNING(Chromium 自身が出す「context lost」の文)は、この試験が起こしたもの。それ以外は出ない
    expect(w.problems.filter((p) => !/CONTEXT_LOST_WEBGL|context lost/i.test(p))).toEqual([]);
  });
});

test.describe("動きを減らす(prefers-reduced-motion: reduce)", () => {
  /** rAF の呼ばれた数を数える(描画が止まっているかの目安) */
  const countRaf = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf++;
        return orig(cb);
      };
    });
  const raf = (page: Page) => page.evaluate(() => (window as unknown as { __raf: number }).__raf);

  test("reduce: data-motion=still。1.5 秒おいた 2 枚の絵が同じ(回転しない)。普通のときは data-motion=live で絵が変わる", async ({ page, browser, baseURL }) => {
    await resetPrefs(page.request);
    await countRaf(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubHome(page, sample());
    await openHome(page);
    await expect(stage(page)).toHaveAttribute("data-motion", "still");
    const canvas = stage(page).locator("canvas");
    await page.waitForTimeout(800);
    const r0 = await raf(page);
    const a = await canvas.screenshot();
    await page.waitForTimeout(1500);
    const b = await canvas.screenshot();
    expect(a.equals(b), "動きを減らすと、時間がたっても絵が変わらない").toBe(true);
    expect(await distinctColors(page, a)).toBeGreaterThan(50);
    expect((await raf(page)) - r0, "描画の呼び出し(rAF)がほとんどない").toBeLessThan(3);

    // 対照: 普通の設定では動く
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
    const live = await ctx.newPage();
    await countRaf(live);
    await stubHome(live, sample());
    await openHome(live);
    await expect(stage(live)).toHaveAttribute("data-motion", "live");
    await live.waitForTimeout(500);
    const l0 = await raf(live);
    const c1 = await stage(live).locator("canvas").screenshot();
    await live.waitForTimeout(1500);
    const c2 = await stage(live).locator("canvas").screenshot();
    expect(c1.equals(c2), "普通の設定では回って絵が変わる").toBe(false);
    expect((await raf(live)) - l0, "毎フレーム描いている(ソフトウェアの描画は 1 秒に数枚〜十数枚)").toBeGreaterThan(4);
    await ctx.close();
  });

  test("途中で設定が変わっても追う: live → still → live(root の data-motion と、描画が止まる・動く)", async ({ page }) => {
    await resetPrefs(page.request);
    await countRaf(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await stubHome(page, sample());
    await openHome(page);
    await expect(stage(page)).toHaveAttribute("data-motion", "live");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(stage(page)).toHaveAttribute("data-motion", "still");
    await page.waitForTimeout(800); // カメラの追従などが止まって落ち着くまで
    const canvas = stage(page).locator("canvas");
    const a = await canvas.screenshot();
    await page.waitForTimeout(1500);
    const b = await canvas.screenshot();
    expect(a.equals(b)).toBe(true);
    const r0 = await raf(page);
    await page.waitForTimeout(2000);
    expect((await raf(page)) - r0, "止まっている間は描かない(2 秒で)").toBeLessThan(3);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(stage(page)).toHaveAttribute("data-motion", "live");
    const r1 = await raf(page);
    await page.waitForTimeout(2000);
    expect((await raf(page)) - r1, "また毎フレーム描く(2 秒で)").toBeGreaterThan(4);
  });

  test("still でも、見た目を変える・右の欄を開くなど「変化があるとき」は描き直す", async ({ page }) => {
    await resetPrefs(page.request);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubHome(page, sample());
    await openHome(page);
    const canvas = stage(page).locator("canvas");
    const before = await canvas.screenshot();
    await page.getByRole("button", { name: /^Visual/ }).click();
    await page.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^4/ }).click(); // 線と点・床の円盤
    await expect(stage(page)).toHaveAttribute("data-base", "disc");
    await page.waitForTimeout(800);
    const after = await canvas.screenshot();
    expect(before.equals(after), "見た目を変えたら、絵が変わる").toBe(false);
    await resetPrefs(page.request);
  });
});

test.describe("描くのを止める条件(隠れたとき)", () => {
  test("ページが隠れている間は描かず(rAF が止まる)、戻ると再び描く", async ({ page }) => {
    await resetPrefs(page.request);
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf++;
        return orig(cb);
      };
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await stubHome(page, sample());
    await openHome(page);
    const raf = () => page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    await page.waitForTimeout(500);
    const running = await raf();
    await page.waitForTimeout(2000);
    expect((await raf()) - running, "動いている間は毎フレーム(2 秒で)").toBeGreaterThan(4);
    // 隠れた
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
    const h0 = await raf();
    await page.waitForTimeout(2000);
    expect((await raf()) - h0, "隠れている間は描かない(2 秒で)").toBeLessThan(3);
    // 戻った
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const v0 = await raf();
    await page.waitForTimeout(2000);
    expect((await raf()) - v0, "戻ったら描く(2 秒で)").toBeGreaterThan(4);
    await expect(stage(page)).toHaveAttribute("data-mode", "3d");
  });
});

test.describe("文脈・読み込み", () => {
  test("「ホーム」と「Table」を 10 往復しても、canvas は 1 つまで。使っている WebGL の文脈も 1 つまで。「Too many active WebGL contexts」が出ない", async ({ page }) => {
    test.setTimeout(420_000);
    await resetPrefs(page.request);
    await page.addInitScript(() => {
      // 作られた WebGL の文脈をすべて控える(確かめ用の canvas も含む)。生きている数は isContextLost() で数える
      const w = window as unknown as { __gl: WebGLRenderingContext[] };
      w.__gl = [];
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const gl = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
        if (gl && /webgl/i.test(type)) w.__gl.push(gl as WebGLRenderingContext);
        return gl;
      } as typeof orig;
    });
    const w = watch(page);
    await stubHome(page, sample());
    await openHome(page);
    const nav = await openMenu(page);
    const live = () => page.evaluate(() => (window as unknown as { __gl: WebGLRenderingContext[] }).__gl.filter((g) => !g.isContextLost()).length);
    const canvases = () => page.evaluate(() => document.querySelectorAll("canvas").length);
    let maxCanvas = 0;
    let maxLive = 0;
    for (let i = 1; i <= 10; i++) {
      await nav.getByRole("link", { name: /Table/ }).click();
      await expect(page).toHaveURL(/\/table$/, { timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Table", { timeout: 30_000 });
      expect(await canvases(), `${i} 回目: Table には canvas がない`).toBe(0);
      await expect.poll(live, { message: `${i} 回目: Table では文脈をすべて手放す` }).toBe(0);
      await nav.getByRole("link", { name: /ホーム/ }).click();
      await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
      await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
      maxCanvas = Math.max(maxCanvas, await canvases());
      maxLive = Math.max(maxLive, await live());
    }
    expect(maxCanvas, "canvas の数(最大)").toBeLessThanOrEqual(1);
    expect(maxLive, "生きている WebGL の文脈(最大)").toBeLessThanOrEqual(1);
    const colors = await distinctColors(page, await stage(page).locator("canvas").screenshot());
    expect(colors, "10 往復のあとも絵が描かれている").toBeGreaterThan(50);
    expect(w.problems.filter((p) => !/CONTEXT_LOST_WEBGL|context lost/i.test(p)), "コンソールの error・warning").toEqual([]);
    expect(w.console.filter((c) => /Too many active WebGL contexts/i.test(c))).toEqual([]);
  });

  test("ホームだけが three を読む: ほかの画面で WebGLRenderer を含む JS も three / home3d の名前の JS も読み込まれない(ホームでは読み込まれる)", async ({ page }) => {
    const loaded: { url: string; hasRenderer: boolean }[] = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (res.request().resourceType() !== "script") return;
      try {
        loaded.push({ url, hasRenderer: /WebGLRenderer/.test(await res.text()) });
      } catch {
        // 読めない応答は数えない
      }
    });
    const seen = async (path: string) => {
      loaded.length = 0;
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      return [...loaded];
    };
    for (const path of ["/settings", "/tasks", "/history", "/migrate", "/table", "/login"]) {
      const js = await seen(path);
      expect(js.length, `${path}: JS が読み込まれている`).toBeGreaterThan(0);
      expect(js.filter((x) => x.hasRenderer).map((x) => x.url), `${path}: WebGLRenderer を含む JS`).toEqual([]);
      expect(js.filter((x) => /three|home3d/i.test(x.url)).map((x) => x.url), `${path}: three・home3d の名前の JS`).toEqual([]);
    }
    await stubHome(page, sample());
    const home = await seen("/");
    expect(home.some((x) => x.hasRenderer), "ホームでは three の塊を読み込む").toBe(true);
  });
});
