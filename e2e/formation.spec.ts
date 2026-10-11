import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PATTERNS, type Look } from "@/fourdb/core/prefs";
import { openHome, overviewOf, stubHome, unitOf } from "./support";

// ホームの立体: 単位の数ごとの隊形(1 つは真ん中・2 つは真ん中に寄せて横に・3 つは 1 列・4 つは後ろ 2・前 2 の互い違い・5 つは後ろ 2・前 3・6 つは後ろ 3・前 3。並ぶ順は左から右で、前・後ろの互い違い、いちばん左は前)。
// 手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/formation.spec.ts
// 単位の数・見た目は API の答え(/api/4db/home・/api/4db/prefs の GET)を差し替えて(route)作る。画面の実物(React・three・CSS)がそのまま動く。
// 確かめること: (1) 札の位置が隊形のとおり (2) 札どうしが重ならない (3) 札が舞台の中に収まり、右の欄の下に出ない (4) 札が立体(Box・台座・帯)にかからない
//   (4) は canvas だけを撮り(札・欄・背景は隠す)、札の四角の中に、立体の塗りがあるかを数える(点線の軌道のような細い線は、5×5 の収縮で除く)。
// 動きを減らす設定(reducedMotion)で動かす: カメラが落ち着いた形になり、札が上下にゆれない(位置が決まった値になる)。
// 既知の不具合(下の KNOWN_GAPS・LONG_NAME)は、test.fail() で書いてある: 直ると「想定外に通った」と出るので、そこで外す。
// E2E_FORMATION_SHOTS=<フォルダ> を付けると、見るための画像を保存する(普段は撮らない)。E2E_FORMATION_RAW=1 を付けると、既知の不具合の試験も test.fail() にせず流し、失敗の中身を見られる。
const BASE = process.env.E2E_4DB_URL;
const SHOTS = process.env.E2E_FORMATION_SHOTS;
/** 既知の不具合の試験を test.fail() にするか(E2E_FORMATION_RAW=1 なら、しない) */
const expectGaps = process.env.E2E_FORMATION_RAW !== "1";
test.use({ baseURL: BASE, contextOptions: { reducedMotion: "reduce" } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 240_000 });

const lookOf = (id: number): Look => ({ ...PATTERNS.find((p) => p.id === id)!.look });
/** 最初の見た目(パターン 3: 札は Box の上・光の輪・弧)、パターン 7(札は台の下・くぼみの台・面を下)、パターン 6(ひな壇) */
const LOOKS = { p3: lookOf(3), p7: lookOf(7), p6: lookOf(6) } as const;
const SIZES = { "1280": { width: 1280, height: 800 }, "1024": { width: 1024, height: 700 } } as const;
const COUNTS = [1, 2, 3, 4, 5, 6] as const;
const LONG_NAME = "あいうえおかきくけこさしすせそたちつてと"; // 日本語 20 文字

/** 舞台の中の 1 つの単位: 単位 i の名前(長い名前を 1 つ入れられる) */
const unitsFor = (n: number, longAt = -1) => Array.from({ length: n }, (_, i) => unitOf(i === longAt ? LONG_NAME : `単位${i + 1}`, 100 - i));

type R = { x: number; y: number; w: number; h: number };
type Geo = { stage: R; labels: R[]; panel: R | null; others: R | null; overflow: { page: number; content: number } };

/** 見た目と明暗を、アカウントの設定(GET)として差し替える(PUT は使わない) */
async function stubPrefs(page: Page, look: Look, theme: "light" | "dark") {
  const body = { available: true, saved: true, prefs: { theme, world: "plain", look } };
  await page.route("**/api/4db/prefs", (route) => route.fulfill({ json: body }));
}

/** ホームを開き、カメラと札が落ち着くまで待つ */
async function openStage(page: Page, opts: { look: Look; theme?: "light" | "dark"; units: ReturnType<typeof unitsFor>; others?: Parameters<typeof overviewOf>[1] }) {
  const theme = opts.theme ?? "light";
  await page.context().addCookies([{ name: "fourdb_theme", value: theme, url: BASE! }]);
  await stubPrefs(page, opts.look, theme);
  await stubHome(page, overviewOf(opts.units, opts.others));
  await openHome(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator('ul[aria-label="単位ごとの Box"] > li')).toHaveCount(opts.units.length);
  await settle(page);
}

/** 書体の読み込み後の札の計り直しと、カメラの落ち着きを待つ(動きを減らす設定では、位置が決まった値になる) */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

async function geometry(page: Page): Promise<Geo> {
  return page.evaluate(() => {
    const r = (el: Element): R => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const lis = [...document.querySelectorAll('ul[aria-label="単位ごとの Box"] > li')];
    const panel = document.querySelector("#box-panel") as HTMLElement | null;
    const others = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("ほかの単位"));
    const content = document.querySelector(".content");
    return {
      stage: r(document.querySelector("section[data-mode]")!),
      labels: lis.map((li) => r(li.querySelector("button")!)),
      panel: panel && panel.inert === false ? r(panel) : null,
      others: others ? r(others) : null,
      overflow: { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: content ? content.scrollWidth - content.clientWidth : 0 },
    };
  }) as Promise<Geo>;
}

/**
 * 札の四角ごとに、canvas の立体の塗り(アルファ 128 以上が、5×5 の収縮のあとも残る点)の数。canvas 以外を隠して撮るので、フォーカスが外れる(最後に呼ぶ)。
 * 台座・Box・帯は残り、床の点線の軌道・光だまりの薄い影は残らない。ひな壇の台(後ろの段)も塗りなので、ひな壇の並べ方では使わない
 */
async function solidCounts(page: Page, rects: R[]): Promise<number[]> {
  const style = await page.addStyleTag({
    content: "*{visibility:hidden !important;background:transparent !important;box-shadow:none !important} canvas{visibility:visible !important} html,body{background:transparent !important}",
  });
  const png = await page.screenshot({ omitBackground: true });
  await style.evaluate((el) => (el as Element).remove());
  return page.evaluate(
    async ({ b64, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const W = img.width;
      const H = img.height;
      const d = ctx.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
      const R = 2;
      const tmp = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 1;
          for (let k = -R; k <= R && v; k++) {
            const xx = x + k;
            if (xx < 0 || xx >= W || !m[y * W + xx]) v = 0;
          }
          tmp[y * W + x] = v;
        }
      const er = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 1;
          for (let k = -R; k <= R && v; k++) {
            const yy = y + k;
            if (yy < 0 || yy >= H || !tmp[yy * W + x]) v = 0;
          }
          er[y * W + x] = v;
        }
      return rects.map((rc) => {
        const x0 = Math.max(0, Math.floor(rc.x));
        const x1 = Math.min(W, Math.ceil(rc.x + rc.w));
        const y0 = Math.max(0, Math.floor(rc.y));
        const y1 = Math.min(H, Math.ceil(rc.y + rc.h));
        let n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += er[y * W + x];
        return n;
      });
    },
    { b64: png.toString("base64"), rects },
  );
}

const inter = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const cx = (r: R) => r.x + r.w / 2;
const cy = (r: R) => r.y + r.h / 2;
/** 札が立体にかかったとみなす、塗りの点の数(点線の軌道の太い所・端の丸みでは届かない大きさ) */
const COVER_PX = 25;

/** 札の入れ物の問題(重なる・舞台の外・欄の下・ほかの単位の行・横のはみ出し)。見つかったものの説明を返す */
function boxIssues(g: Geo): string[] {
  const out: string[] = [];
  const st = g.stage;
  g.labels.forEach((a, i) => {
    if (a.x < st.x - 0.5 || a.y < st.y - 0.5 || a.x + a.w > st.x + st.w + 0.5 || a.y + a.h > st.y + st.h + 0.5) out.push(`札 ${i} が舞台の外`);
    for (let j = i + 1; j < g.labels.length; j++) if (inter(a, g.labels[j])) out.push(`札 ${i} と ${j} が重なる`);
    if (g.panel && inter(a, g.panel)) out.push(`札 ${i} が右の欄の下`);
    if (g.others && inter(a, g.others)) out.push(`札 ${i} がほかの単位の行と重なる`);
  });
  if (g.others) {
    if (g.others.x < st.x - 0.5 || g.others.x + g.others.w > st.x + st.w + 0.5 || g.others.y + g.others.h > st.y + st.h + 0.5) out.push("ほかの単位の行が舞台の外");
    if (g.panel && inter(g.others, g.panel)) out.push("ほかの単位の行が右の欄の下");
  }
  if (g.overflow.page || g.overflow.content) out.push(`横にはみ出す ${JSON.stringify(g.overflow)}`);
  return out;
}

async function coverIssues(page: Page, g: Geo): Promise<string[]> {
  const counts = await solidCounts(page, [...g.labels, ...(g.others ? [g.others] : [])]);
  const out: string[] = [];
  counts.forEach((n, i) => {
    if (n > COVER_PX) out.push(i < g.labels.length ? `札 ${i} が立体にかかる(塗り ${n} 点)` : `ほかの単位の行が立体にかかる(塗り ${n} 点)`);
  });
  return out;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const labelButton = (page: Page, i: number) => page.locator('ul[aria-label="単位ごとの Box"] > li > button').nth(i);

/** 隊形のとおりの位置か(欄を開いていない舞台)。札の位置が、隊形(単位の数ごと)の左右・前後の並びになっていること */
function formationIssues(g: Geo, n: number): string[] {
  const out: string[] = [];
  const L = g.labels;
  const mid = g.stage.x + g.stage.w / 2;
  if (L.length !== n) return [`札の数 ${L.length}(${n} のはず)`];
  for (let i = 1; i < n; i++) if (!(cx(L[i]) > cx(L[i - 1]) + 20)) out.push(`札 ${i - 1} → ${i} が左から右の順でない`);
  if (n === 1 && Math.abs(cx(L[0]) - mid) > 4) out.push(`1 つが真ん中でない(ずれ ${Math.round(cx(L[0]) - mid)}px)`);
  if (n === 2 && Math.abs((cx(L[0]) + cx(L[1])) / 2 - mid) > 8) out.push("2 つが真ん中に寄っていない");
  if (n === 3 && Math.abs(cx(L[1]) - mid) > 8) out.push("3 つの真ん中が舞台の真ん中でない");
  if (n <= 3) {
    // 1 列: 札の高さがそろう(弧・ひな壇で真ん中が少し上がるのはよい)
    const ys = L.map(cy);
    if (Math.max(...ys) - Math.min(...ys) > 40) out.push(`1 列のはずが、札の高さが ${Math.round(Math.max(...ys) - Math.min(...ys))}px ばらつく`);
  } else {
    // 2 列: 左から 前・後ろ・前… の互い違い(前は画面の下側)。いちばん左は前
    const front = L.filter((_, i) => i % 2 === 0).map(cy);
    const back = L.filter((_, i) => i % 2 === 1).map(cy);
    if (front.length !== Math.ceil(n / 2) || back.length !== Math.floor(n / 2)) out.push("前・後ろの数が違う");
    if (!(Math.min(...front) > Math.max(...back) + 25)) out.push(`前の列(偶数番目)が後ろの列より下にない(前 ${front.map(Math.round)} / 後ろ ${back.map(Math.round)})`);
  }
  return out;
}

// ---------- 欄を開いていない舞台: 隊形・重なり・立体にかからない ----------

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    test(`隊形: 見た目 ${lookKey}・${vp}: 単位 1〜6 つの札が、隊形のとおりに並び(左から右・前後の互い違い)、重ならず、舞台に収まり、立体にかからない`, async ({ page }) => {
      await page.setViewportSize(SIZES[vp]);
      for (const n of COUNTS) {
        await openStage(page, { look, units: unitsFor(n) });
        const g = await geometry(page);
        await shot(page, `${lookKey}-${vp}-N${n}-closed`);
        const issues = [...boxIssues(g), ...formationIssues(g, n), ...(await coverIssues(page, g))];
        expect(issues, `${lookKey} ${vp} N=${n}`).toEqual([]);
        // 欄を開いていないので、札は元の大きさ(--k = 1)か、重なるときの小さめ(0.8)
        await page.goto("about:blank");
      }
    });
  }

test("隊形: 2 つは、3 つの 1 列と同じ間隔で真ん中に寄る(端まで広げない)。4 つの前の列は、3 つの間隔より狭くならない(札の間隔で比べる)", async ({ page }) => {
  for (const vp of ["1280", "1024"] as const) {
    await page.setViewportSize(SIZES[vp]);
    const gaps: Record<number, number> = {};
    for (const n of [2, 3] as const) {
      await openStage(page, { look: LOOKS.p7, units: unitsFor(n) });
      const g = await geometry(page);
      gaps[n] = cx(g.labels[1]) - cx(g.labels[0]);
      await page.goto("about:blank");
    }
    expect(Math.abs(gaps[2] / gaps[3] - 1), `${vp}: 2 つの間隔 ${Math.round(gaps[2])} と 3 つの間隔 ${Math.round(gaps[3])}`).toBeLessThan(0.05);
  }
});

// ---------- 右の欄を開く: いちばん左・いちばん右の単位 ----------

/**
 * 欄を開いたとき、札が舞台に収まり欄の下に出ないこと・札が立体にかからないこと、がそろわない組み合わせ(既知の不具合。test.fail で書く)。
 * いまは空(以前の p7-1024-N6 は、札を読める大きさの下限まで段々に小さくして全部を収めるようにして直した)。
 */
const KNOWN_GAPS: Record<string, string> = {};

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const)
    for (const n of COUNTS) {
      const known = KNOWN_GAPS[`${lookKey}-${vp}-N${n}`];
      test(`右の欄: 見た目 ${lookKey}・${vp}・単位 ${n} つ: いちばん左・いちばん右の単位を選んでも、札が舞台に収まり、欄の下に出ず、立体にかからない${known ? "(既知の不具合)" : ""}`, async ({ page }) => {
        if (known && expectGaps) test.fail(true, known);
        await page.setViewportSize(SIZES[vp]);
        await openStage(page, { look, units: unitsFor(n) });
        const picks = n === 1 ? [0] : [0, n - 1];
        const issues: string[] = [];
        for (const idx of picks) {
          await labelButton(page, idx).click();
          await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
          await page.waitForTimeout(500);
          await settle(page);
          const g = await geometry(page);
          expect(g.panel, "右の欄が開いている").not.toBeNull();
          expect(g.panel!.x + g.panel!.w, "右の欄が画面に収まる").toBeLessThanOrEqual(SIZES[vp].width + 1);
          await shot(page, `${lookKey}-${vp}-N${n}-panel${idx === 0 ? "L" : "R"}`);
          issues.push(...boxIssues(g).map((s) => `選んだ ${idx}: ${s}`), ...(await coverIssues(page, g)).map((s) => `選んだ ${idx}: ${s}`));
          await page.keyboard.press("Escape");
          await expect(page.locator("#box-panel")).toHaveJSProperty("inert", true);
          await page.waitForTimeout(300);
        }
        expect(issues, `${lookKey} ${vp} N=${n}`).toEqual([]);
      });
    }

// ---------- ほかの単位の行(7 つ目から) ----------

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    test(`ほかの単位の行: 見た目 ${lookKey}・${vp}: 単位 6 つに「ほかの単位」の行を足しても、行が舞台に収まり、札・立体にかからない(欄を開いていないとき)`, async ({ page }) => {
      await page.setViewportSize(SIZES[vp]);
      await openStage(page, { look, units: unitsFor(6), others: { items: [{ unitType: "部署", count: 12 }, { unitType: null, count: 5 }], more: 43 } });
      const g = await geometry(page);
      expect(g.others, "ほかの単位の行").not.toBeNull();
      await shot(page, `others-${lookKey}-${vp}`);
      expect([...boxIssues(g), ...formationIssues(g, 6), ...(await coverIssues(page, g))], `${lookKey} ${vp}`).toEqual([]);
    });
  }

// ---------- 長い単位名(日本語 20 文字ほど) ----------

/** 長い名前の札が、となりの立体の台座にかかる組み合わせ(既知の不具合)。いまは空(札の幅に上限を付け、名前を 2 行まで折り返して「…」で切るようにして直した) */
const LONG_NAME_GAPS: Record<string, string> = {};

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const)
    for (const [n, at] of [[3, "mid"], [6, "mid"], [6, "last"]] as const) {
      const key = `${lookKey}-${vp}-N${n}-${at}`;
      const known = LONG_NAME_GAPS[key];
      test(`長い名前: 見た目 ${lookKey}・${vp}・単位 ${n} つの${at === "mid" ? "真ん中" : "右端"}に 20 文字の名前: 札が重ならず、舞台に収まり、立体にかからない${known ? "(既知の不具合)" : ""}`, async ({ page }) => {
        if (known && expectGaps) test.fail(true, known);
        await page.setViewportSize(SIZES[vp]);
        await openStage(page, { look, units: unitsFor(n, at === "mid" ? Math.floor(n / 2) : n - 1) });
        const g = await geometry(page);
        await shot(page, `long-${key}`);
        expect([...boxIssues(g), ...(await coverIssues(page, g))], key).toEqual([]);
        await expect(page.getByText(LONG_NAME).first()).toBeVisible();
        // 名前は 2 行までで「…」に切ることがあるが、全文は札の読み上げの名前と、名前の title(指を乗せると出る)に残る
        const longIdx = at === "mid" ? Math.floor(n / 2) : n - 1;
        await expect(labelButton(page, longIdx)).toHaveAccessibleName(new RegExp(`^${LONG_NAME} `));
        await expect(labelButton(page, longIdx).locator("span[title]")).toHaveAttribute("title", LONG_NAME);
      });
    }

// ---------- キーボードで札を移る: 選んだ(フォーカスのある)Box が空いている所に入る ----------

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    test(`キーボード: 見た目 ${lookKey}・${vp}・単位 6 つ: 右の欄を開いたまま Tab で札を移ると、フォーカスのある札が、欄の左の空いている所に入る(Shift+Tab で戻っても)`, async ({ page }) => {
      await page.setViewportSize(SIZES[vp]);
      await openStage(page, { look, units: unitsFor(6) });
      await labelButton(page, 0).click();
      await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
      await settle(page);
      await labelButton(page, 0).focus();
      const framed = async (i: number, how: string) => {
        await expect(labelButton(page, i), how).toBeFocused();
        await settle(page);
        const g = await geometry(page);
        const a = g.labels[i];
        expect(g.panel, "右の欄が開いたまま").not.toBeNull();
        expect(a.x, `${how}: 札 ${i} が舞台の左に収まる`).toBeGreaterThanOrEqual(g.stage.x - 0.5);
        expect(a.x + a.w, `${how}: 札 ${i} が欄の左に収まる`).toBeLessThanOrEqual(g.panel!.x - 1);
        await shot(page, `kbd-${lookKey}-${vp}-focus${i}`);
      };
      await framed(0, "最初");
      for (let i = 1; i < 6; i++) {
        await page.keyboard.press("Tab");
        await framed(i, `Tab ${i} 回目`);
      }
      for (let i = 4; i >= 0; i--) {
        await page.keyboard.press("Shift+Tab");
        await framed(i, `Shift+Tab で ${i}`);
      }
    });
  }

// ---------- 暗い見た目 × ひな壇 ----------

test.describe("暗い見た目 × ひな壇(並べ方 = ひな壇)", () => {
  test.use({ colorScheme: "dark" });
  const stageLooks = [["p6", LOOKS.p6], ["p3stage", { ...LOOKS.p3, layout: "stage" } as Look]] as const;
  for (const [lookKey, look] of stageLooks) {
    test(`暗い・${lookKey}(ひな壇)・1280: 単位 1〜6 つで、札が重ならず、舞台に収まり、隊形のとおりに並ぶ(札が台の段にかかるのはよい)`, async ({ page }) => {
      await page.setViewportSize(SIZES["1280"]);
      for (const n of COUNTS) {
        await openStage(page, { look, theme: "dark", units: unitsFor(n) });
        const g = await geometry(page);
        await shot(page, `dark-${lookKey}-N${n}`);
        const issues = [...boxIssues(g), ...formationIssues(g, n)];
        // ひな壇の 3 つは、真ん中が後ろの段に上がり、前・後ろ・前の高さの差が出る(1 列のばらつきとは別)
        expect(issues.filter((s) => !s.startsWith("1 列のはずが")), `${lookKey} N=${n}`).toEqual([]);
        await page.goto("about:blank");
      }
    });
  }
  // ひな壇(パターン 6)で右の欄を開く: 札が舞台に収まり、欄の下に出ない。全部は収まらない組み合わせは既知の不具合(KNOWN_GAPS と同じ。いまは空)
  const STAGE_PANEL_GAPS: Record<string, string> = {};
  for (const vp of ["1280", "1024"] as const)
    for (const n of [4, 5, 6] as const) {
      const known = STAGE_PANEL_GAPS[`${vp}-N${n}`];
      test(`暗い・ひな壇・${vp}・単位 ${n} つ: 右の欄を開いても(いちばん左・いちばん右を選ぶ)、札が舞台に収まり、欄の下に出ない${known ? "(既知の不具合)" : ""}`, async ({ page }) => {
        if (known && expectGaps) test.fail(true, known);
        await page.setViewportSize(SIZES[vp]);
        await openStage(page, { look: LOOKS.p6, theme: "dark", units: unitsFor(n) });
        const issues: string[] = [];
        for (const idx of [0, n - 1]) {
          await labelButton(page, idx).click();
          await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
          await page.waitForTimeout(500);
          await settle(page);
          const g = await geometry(page);
          await shot(page, `dark-p6-${vp}-N${n}-panel${idx === 0 ? "L" : "R"}`);
          issues.push(...boxIssues(g).map((m) => `選んだ ${idx}: ${m}`));
          await page.keyboard.press("Escape");
          await expect(page.locator("#box-panel")).toHaveJSProperty("inert", true);
          await page.waitForTimeout(300);
        }
        expect(issues, `ひな壇 ${vp} N=${n}`).toEqual([]);
      });
    }
});


// ---------- 最終確認: 全部の単位が長い名前・ほかの単位の行を足して欄を開く・縮んだ札のフォーカスの輪 ----------

/** 全部の単位に、日本語 20 文字の名前(単位ごとに末尾の数字だけ変える) */
const allLong = (n: number) => Array.from({ length: n }, (_, i) => unitOf(`${LONG_NAME.slice(0, 19)}${i + 1}`, 100 - i));

/**
 * 全部の単位が長い名前(20 文字)のときの、欄を開く組み合わせ(既知の不具合。test.fail で書く)。
 * 札の幅が名前なりに広く、縮めても全部は欄の左に入らない。札を段々に小さくする段階(below 1 → 0.8 → 0.72、float 1 → 0.8)の下限では足りず、
 * 「選んだ Box ととなりだけ見せる」に切り替わるため、遠い単位の札が欄の下・舞台の外に出る(札どうしが数 px 重なることもある)。直ったら外す。
 */
const ALL_LONG_GAPS: Record<string, string> = {
  "p3-1280": "パターン 3・1280×800・6 つ全部が 20 文字: 欄を開くと、札 5・6 が欄の下に入る・札 1・2 が舞台の外に出る(札 1 と 2 が数 px 重なる)",
  "p3-1024": "パターン 3・1024×700・6 つ全部が 20 文字: 欄を開くと、札 4〜6 が欄の下に入る・札 1〜3 が舞台の外に出る",
  "p7-1024": "パターン 7・1024×700・6 つ全部が 20 文字: 欄を開くと、札 4〜6 が欄の下に入る・札 1〜3 が舞台の外に出る",
};

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    const known = ALL_LONG_GAPS[`${lookKey}-${vp}`];
    test(`全部の単位が長い名前: 見た目 ${lookKey}・${vp}・単位 6 つ(20 文字): 欄を閉じていても、いちばん左・いちばん右を選んで開いても、札が重ならず、舞台に収まり、欄の下に出ず、立体にかからない${known ? "(既知の不具合)" : ""}`, async ({ page }) => {
      if (known && expectGaps) test.fail(true, known);
      await page.setViewportSize(SIZES[vp]);
      await openStage(page, { look, units: allLong(6) });
      const issues: string[] = [];
      const check = async (state: string) => {
        const g = await geometry(page);
        await shot(page, `all-long-${lookKey}-${vp}-${state}`);
        issues.push(...boxIssues(g).map((s) => `${state}: ${s}`), ...(await coverIssues(page, g)).map((s) => `${state}: ${s}`));
        // 札の幅に上限がある(単位が多いとき、台の下の札は 150px、Box の上の札は 190px。縮めば、その倍率)。名前は 2 行までで、全文は読み上げの名前に残る
        const cap = look.label === "float" ? 190 : 150;
        g.labels.forEach((a, i) => expect(a.w, `${state}: 札 ${i} の幅`).toBeLessThanOrEqual(cap + 4));
      };
      await check("closed");
      for (let i = 0; i < 6; i++) await expect(labelButton(page, i)).toHaveAccessibleName(new RegExp(`^${LONG_NAME.slice(0, 19)}${i + 1} `));
      for (const idx of [0, 5]) {
        await labelButton(page, idx).click();
        await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
        await page.waitForTimeout(500);
        await settle(page);
        await check(idx === 0 ? "panelL" : "panelR");
        await page.keyboard.press("Escape");
        await expect(page.locator("#box-panel")).toHaveJSProperty("inert", true);
        await page.waitForTimeout(300);
      }
      expect(issues, `${lookKey} ${vp}`).toEqual([]);
    });
  }

for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    test(`ほかの単位の行 + 右の欄: 見た目 ${lookKey}・${vp}: 単位 6 つ + 「ほかの単位」の行で、いちばん左・いちばん右を選んで欄を開いても、行と札が舞台に収まり、欄の下に出ず、立体にかからない`, async ({ page }) => {
      await page.setViewportSize(SIZES[vp]);
      await openStage(page, { look, units: unitsFor(6), others: { items: [{ unitType: "部署", count: 12 }, { unitType: null, count: 5 }], more: 43 } });
      const issues: string[] = [];
      for (const idx of [0, 5]) {
        await labelButton(page, idx).click();
        await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
        await page.waitForTimeout(500);
        await settle(page);
        const g = await geometry(page);
        expect(g.others, "ほかの単位の行が出ている").not.toBeNull();
        await shot(page, `others-open-${lookKey}-${vp}-${idx === 0 ? "L" : "R"}`);
        issues.push(...boxIssues(g).map((s) => `選んだ ${idx}: ${s}`), ...(await coverIssues(page, g)).map((s) => `選んだ ${idx}: ${s}`));
        await page.keyboard.press("Escape");
        await expect(page.locator("#box-panel")).toHaveJSProperty("inert", true);
        await page.waitForTimeout(300);
      }
      expect(issues, `${lookKey} ${vp}`).toEqual([]);
    });
  }

/**
 * キーボードのフォーカスの輪(:focus-visible の 2px の輪 + 外側の光)が、縮んだ札でも見えること。
 * 右の欄を開いて札が縮んでいる舞台で、Tab で札に来たとき、輪を消した画像(同じ状態で、輪だけ CSS で消す)と比べて、
 * 札の四角の外側(8px の帯)の上・下・左・右のそれぞれに、違う点があること(輪が欠けていない)。舞台の縁や欄に隠れる側は数えない。
 */
const PAD = 8;
for (const [lookKey, look] of [["p3", LOOKS.p3], ["p7", LOOKS.p7]] as const)
  for (const vp of ["1280", "1024"] as const) {
    test(`フォーカスの輪: 見た目 ${lookKey}・${vp}・単位 6 つ(右の欄を開く): Tab で札に来ると、縮んだ札にも輪が四方に出る`, async ({ page }) => {
      await page.setViewportSize(SIZES[vp]);
      await openStage(page, { look, units: unitsFor(6) });
      await labelButton(page, 0).click();
      await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
      await settle(page);
      await labelButton(page, 0).focus();
      await page.mouse.move(2, 2); // ポインターを札から外す(hover の見た目と混ざらないように)
      const widths: number[] = [];
      for (let i = 1; i < 6; i++) {
        await page.keyboard.press("Tab");
        await expect(labelButton(page, i)).toBeFocused();
        await settle(page);
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { x: b.x, y: b.y, w: b.width, h: b.height, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, fv: el.matches(":focus-visible"), vw: window.innerWidth, vh: window.innerHeight };
        });
        widths.push(Math.round(r.w));
        expect(r.fv, `札 ${i} が :focus-visible`).toBe(true);
        expect(r.outlineStyle, `札 ${i} の輪の種類`).toBe("solid");
        expect(parseFloat(r.outlineWidth), `札 ${i} の輪の太さ`).toBeGreaterThanOrEqual(2);
        const x0 = Math.max(0, Math.floor(r.x - PAD));
        const y0 = Math.max(0, Math.floor(r.y - PAD));
        const x1 = Math.min(r.vw, Math.ceil(r.x + r.w + PAD));
        const y1 = Math.min(r.vh, Math.ceil(r.y + r.h + PAD));
        const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        const withRing = await page.screenshot({ clip });
        const noRing = await page.addStyleTag({ content: ":focus-visible{outline:none !important;box-shadow:none !important}" });
        await page.waitForTimeout(100);
        const without = await page.screenshot({ clip });
        await noRing.evaluate((el) => (el as Element).remove());
        // 札の四角(clip の中の座標)
        const inner = { l: Math.round(r.x - x0), t: Math.round(r.y - y0), r: Math.round(r.x + r.w - x0), b: Math.round(r.y + r.h - y0) };
        const sides = await page.evaluate(
          async ({ a, b, inner }) => {
            const load = async (b64: string) => {
              const img = new Image();
              img.src = `data:image/png;base64,${b64}`;
              await img.decode();
              const c = document.createElement("canvas");
              c.width = img.width;
              c.height = img.height;
              const ctx = c.getContext("2d")!;
              ctx.drawImage(img, 0, 0);
              return ctx.getImageData(0, 0, img.width, img.height);
            };
            const A = await load(a);
            const B = await load(b);
            const out = { top: 0, bottom: 0, left: 0, right: 0 };
            for (let y = 0; y < A.height; y++)
              for (let x = 0; x < A.width; x++) {
                const k = (y * A.width + x) * 4;
                if (Math.abs(A.data[k] - B.data[k]) + Math.abs(A.data[k + 1] - B.data[k + 1]) + Math.abs(A.data[k + 2] - B.data[k + 2]) <= 30) continue;
                if (y < inner.t) out.top++;
                else if (y >= inner.b) out.bottom++;
                else if (x < inner.l) out.left++;
                else if (x >= inner.r) out.right++;
              }
            return out;
          },
          { a: withRing.toString("base64"), b: without.toString("base64"), inner },
        );
        await shot(page, `focusring-${lookKey}-${vp}-${i}`);
        const g = await geometry(page);
        const room = { top: inner.t, bottom: clip.height - inner.b, left: inner.l, right: clip.width - inner.r };
        const hiddenByPanel = g.panel !== null && r.x + r.w + PAD > g.panel.x; // 右の欄に隠れる側
        for (const side of ["top", "bottom", "left", "right"] as const) {
          if (room[side] < 4 || (side === "right" && hiddenByPanel)) continue; // 画面の縁・欄で、輪の置き場がない側
          expect(sides[side], `札 ${i}(幅 ${Math.round(r.w)}px)の ${side} に輪が出る(違う点の数)`).toBeGreaterThan(8);
        }
      }
      // パターン 7・1024×700 では、右の欄を開くと札が 0.8 に縮み、幅 50px ほどになる(名前と数だけの幅)。その札にも輪が出ること(上の四方の確認)が、この試験の要
      if (lookKey === "p7" && vp === "1024") expect(Math.min(...widths), `縮んだ札の幅 ${widths.join("・")}`).toBeLessThan(60);
    });
  }
