import { expect, test, type Locator, type Page } from "@playwright/test";
import type { HomeOverview } from "@/fourdb/core/home";
import { PATTERNS } from "@/fourdb/core/prefs";
import {
  copyFixture,
  distinctColors,
  externalHosts,
  hydrated,
  importFixture,
  manyUnits,
  openHome,
  overviewOf,
  removeFixture,
  resetPrefs,
  stage,
  stubHome,
  unitOf,
  watch,
} from "./support";

// ホーム(/): いちばん上の Box を単位ごとに 1 つの立体にして舞台に並べる(D-017)。手元のデータベースと試験用のスプシで動いている画面を相手にする:
//   node scripts/dev-fourdb.mjs --fixture --port 3200  で起動して
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/home.spec.ts
// 3D の試験は 1 つずつ(workers = 1)。ヘッドレスの WebGL は SwiftShader(playwright.config.ts)。
// 「本物のデータ」の試験は API の答えと画面を比べ、細かい値(期間・ƒ・日付)は試験用のスプシの中身から決まる値を直に書く。
// 決まった形(7 つ以上の単位・欄の値・長い名前など)は、API の答えを差し替えて(route)確かめる。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
// 3D(ソフトウェアの描画)は遅く、機械の混み具合で 3 倍ほど変わるので、1 つの試験に長めの時間をとる
test.describe.configure({ timeout: 120_000 });

const LABELS = 'ul[aria-label="単位ごとの Box"]';
/** 札のボタン */
const labelButtons = (page: Page) => page.locator(`${LABELS} > li > button`);
const panel = (page: Page) => page.locator("#box-panel");
const SECTION_ORDER = ["names", "inside", "cardFields", "measures", "period", "sheets", "tables", "cube", "bands"];
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const fmt = (n: number) => n.toLocaleString("ja-JP");

type Rect = { x: number; y: number; w: number; h: number };
const rectOf = async (l: Locator): Promise<Rect> => {
  const b = await l.boundingBox();
  if (!b) throw new Error("見えていません");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};
const overlap = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;

/** 日本時間の日付(YYYY-MM-DD)。ブラウザの時刻帯に左右されない書き方で、試験の側で別に求める */
const tokyoDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

test.describe("ホーム: 本物のデータ(取り込んだ試験用のスプシ)", () => {
  const id = `e2e-home-${Date.now()}`;
  test.beforeAll(() => copyFixture(id));
  test.afterAll(() => removeFixture(id));

  test("取り込んだデータが立体になる(data-mode=3d・data-ready)。canvas は一色でない。札・ほかの単位は API と合い、6 つまで", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await resetPrefs(page.request);
    const w = watch(page);
    await importFixture(page, id);
    const api = (await (await page.request.get("/api/4db/home")).json()) as HomeOverview;
    expect(api.units.length).toBeGreaterThan(0);
    expect(api.units.length).toBeLessThanOrEqual(6);

    await openHome(page);
    await expect(page).toHaveTitle("ホーム | 4DB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
    await expect(stage(page)).toHaveAttribute("data-motion", "live");
    // canvas は 1 つで、読み上げには出さない(読み上げ用の DOM は札と右の欄)
    const canvas = stage(page).locator("canvas");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute("aria-hidden", "true");
    // 絵が描かれている(一色の塗りつぶしではない)
    const colors = await distinctColors(page, await canvas.screenshot());
    expect(colors, "canvas の色の数").toBeGreaterThan(50);

    // 札: 単位の数だけ(6 つまで)。名前と数が API と同じ。単位なしは「(単位なし)」。数は 3 桁区切り
    const buttons = labelButtons(page);
    await expect(buttons).toHaveCount(Math.min(6, api.units.length));
    for (const [i, u] of api.units.entries()) {
      await expect(buttons.nth(i)).toHaveText(new RegExp(`^\\s*${(u.unitType ?? "(単位なし)").replace(/[()]/g, "\\$&")}\\s*${fmt(u.count)}\\s*$`));
      await expect(buttons.nth(i)).toHaveAttribute("aria-expanded", "false");
      await expect(buttons.nth(i)).toHaveAttribute("aria-controls", "box-panel");
    }
    // ほかの単位の行は、7 つ目からあるときだけ
    await expect(page.getByText("ほかの単位:")).toHaveCount(api.others.items.length > 0 ? 1 : 0);
    // 右の欄は閉じていて、触れない(inert)
    await expect(panel(page)).toHaveJSProperty("inert", true);

    expect(w.problems, "コンソールの error・warning").toEqual([]);
    expect(externalHosts(w, baseURL!), "外への通信").toEqual([]);
  });

  test("右の欄: 欄は固定の順。値がない欄は「—」。ƒ は role=img「計算された値」。期間は YYYY-MM〜YYYY-MM。最後に取り込んだ日は日本時間の年つき。【P8】【P11】", async ({ page }) => {
    test.setTimeout(180_000);
    await resetPrefs(page.request);
    await importFixture(page, id);
    const api = (await (await page.request.get("/api/4db/home")).json()) as HomeOverview;
    const shop = api.units.findIndex((u) => u.unitType === "店舗コード");
    expect(shop, "試験用のスプシの単位(店舗コード)が立体の中にある").toBeGreaterThanOrEqual(0);
    const unit = api.units[shop];

    await openHome(page);
    const btn = labelButtons(page).nth(shop);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toHaveJSProperty("inert", false);
    // 開いたら、右の欄の見出しへフォーカス(見出しは単位の名前と数)
    const heading = page.locator("#box-panel-h");
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(new RegExp(`店舗コード\\s*${fmt(unit.count)}`));
    await expect(panel(page)).toHaveAttribute("aria-labelledby", "box-panel-h");

    // 欄の並びは固定
    const ids = await panel(page).locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    expect(ids).toEqual(SECTION_ORDER);
    const section = (sid: string) => panel(page).locator(`[data-section="${sid}"]`);
    const heads = await panel(page).locator("[data-section] dt").allInnerTexts();
    expect(heads.map(norm)).toEqual(["名前", "中に", "Card の項目", "数値", "期間", "元のシート", "Table", "Cube", "数字の帯"]);

    // 値がない欄は「—」。ある欄は中身(API の値と同じ向き)
    const present: Record<string, boolean> = {
      names: unit.names.items.length > 0,
      inside: (unit.inside?.items.length ?? 0) > 0,
      cardFields: (unit.cardFields?.items.length ?? 0) > 0,
      measures: (unit.measures?.items.length ?? 0) > 0,
      period: unit.period !== null,
      sheets: (unit.sheets?.items.length ?? 0) > 0,
      tables: (unit.tables?.items.length ?? 0) > 0,
    };
    for (const [sid, has] of Object.entries(present)) {
      const text = norm(await section(sid).locator("dd").innerText());
      if (has) expect(text, sid).not.toBe("—");
      else expect(text, sid).toBe("—");
    }
    // 試験用のスプシの中身から決まる値(API とは別に決めた期待): 名前・Card の項目・数値・期間
    await expect(section("names")).toContainText("S-01");
    await expect(section("names")).toContainText("S-03");
    await expect(section("cardFields")).toContainText("課税区分");
    await expect(section("measures")).toContainText("売上");
    await expect(section("measures")).toContainText("精算額");
    // ƒ: 計算された値の数値(精算額)だけに付き、読み上げは「計算された値」
    const marks = section("measures").getByRole("img", { name: "計算された値" });
    await expect(marks).toHaveCount(unit.measures!.items.filter((m) => m.calculated).length);
    await expect(marks.first()).toHaveText("ƒ");
    await expect(section("measures").locator("span", { hasText: /^精算額ƒ$/ })).toHaveCount(1);
    expect(unit.measures!.items.find((m) => m.name === "精算額")?.calculated).toBe(true);
    expect(unit.measures!.items.find((m) => m.name === "売上")?.calculated).toBe(false);
    // 期間: 4 月〜9 月(2026)。期間の終わりは含まない日なので、1 日戻して 2026-09
    expect(norm(await section("period").locator("dd").innerText())).toBe("2026-04〜2026-09");
    // 元のシート: ファイル › シート。最後に取り込んだ日は、日本時間の年つきの日付
    await expect(section("sheets")).toContainText("店舗別売上(試験用) › 2026年度");
    const last = norm(await section("sheets").locator("dd").innerText()).match(/最後に取り込んだ日\s*(\S+)/);
    expect(last, "最後に取り込んだ日").not.toBeNull();
    expect(last![1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(last![1]).toBe(tokyoDate(unit.sheets!.lastReadAt!));
    // まだ作っていない欄
    await expect(section("cube").locator("dd")).toHaveText("【P8】");
    await expect(section("bands").locator("dd")).toHaveText("【P11】");

    // ✕ で閉じる(開いたボタンへフォーカスが戻り、欄は inert に戻る)
    await panel(page).getByRole("button", { name: "閉じる" }).click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(btn).toBeFocused();
    await expect(panel(page)).toHaveJSProperty("inert", true);
  });

  test("Table の欄: 保存した表が /table?def=<id> のリンクで並び、押すとその表が開く。表がない単位は「—」", async ({ page }) => {
    test.setTimeout(180_000);
    await resetPrefs(page.request);
    await importFixture(page, id);
    const cat = await (await page.request.get("/api/4db/catalog")).json();
    const dim = cat.dimensions.find((d: { name: string }) => d.name === "店舗コード");
    const name = `試験 ホーム ${Date.now()}`;
    const saved = await page.request.post("/api/4db/sheet-definitions", {
      data: { name, request: { measureId: cat.measures.find((m: { name: string }) => m.name === "売上").id, fn: "SUM", rows: { dimensionId: dim.id, level: null, subtotalLevel: null }, columns: null, filters: [], sheetIds: null } },
    });
    expect(saved.ok()).toBe(true);
    const { id: definitionId } = (await saved.json()) as { id: string };

    await openHome(page);
    const api = (await (await page.request.get("/api/4db/home")).json()) as HomeOverview;
    const shop = api.units.findIndex((u) => u.unitType === "店舗コード");
    await labelButtons(page).nth(shop).click();
    const link = panel(page).locator('[data-section="tables"]').getByRole("link", { name: new RegExp(name) });
    await expect(link).toHaveAttribute("href", `/table?def=${definitionId}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/table\\?def=${definitionId}$`));
    await expect(page.getByLabel("表の名前")).toHaveValue(name);
    // 軸の違う単位(Table が当たらない単位)があれば、「—」(合成データの試験で別に確かめる)
  });
});

test.describe("ホーム: 決まった形(API の答えを差し替える)", () => {
  test("単位は 6 つまで。7 つ目からは「ほかの単位: …」の 1 行(ほか N)。単位なしは「(単位なし)」", async ({ page }) => {
    await resetPrefs(page.request);
    // API が 8 つ返しても(返さない決まりだが)、画面は 6 つまで
    await stubHome(
      page,
      overviewOf([...manyUnits(8)], {
        items: [
          { unitType: "部署", count: 12 },
          { unitType: null, count: 5 },
        ],
        more: 43,
      }),
    );
    await openHome(page);
    await expect(labelButtons(page)).toHaveCount(6);
    await expect(labelButtons(page).first()).toContainText("単位1");
    await expect(labelButtons(page).last()).toContainText("単位6");
    const others = page.getByText("ほかの単位:");
    await expect(others).toHaveCount(1);
    expect(norm(await others.innerText())).toBe("ほかの単位: 部署 12・(単位なし) 5 ほか 43");
    // ほかの単位の行は、札と重ならない
    const o = await rectOf(others);
    for (const b of await labelButtons(page).all()) expect(overlap(o, await rectOf(b)), "ほかの単位の行と札").toBe(false);
  });

  test("単位が 6 つ以下なら、ほかの単位の行は出ない。単位 1 つでも立体と札が出る", async ({ page }) => {
    await resetPrefs(page.request);
    await stubHome(page, overviewOf([unitOf("店舗", 3)]));
    await openHome(page);
    await expect(labelButtons(page)).toHaveCount(1);
    await expect(page.getByText("ほかの単位:")).toHaveCount(0);
  });

  test("欄の値の表し方: 名前は 5 つと「ほか N」・中に・Card の項目・ƒ・期間・シート 3 つ(ファイル › シート)・Table。長い名前・記号は文字のまま(HTML にならない)", async ({ page }) => {
    await resetPrefs(page.request);
    const tid = "11111111-2222-4333-8444-555555555555";
    const evil = '<img src=x onerror="window.__xss=1"> & "引用"';
    await stubHome(
      page,
      overviewOf([
        unitOf("法人", 1234, {
          names: { items: ["A社", "B社", "C社", "D社", evil], more: 1229 },
          inside: { items: [{ unitType: "拠点", count: 1500 }, { unitType: null, count: 3 }], more: 4 },
          cardFields: { items: ["課税区分", "担当者"], more: 0 },
          measures: { items: [{ name: "売上", calculated: false }, { name: "精算額", calculated: true }, { name: "とても長い数値の名前".repeat(6), calculated: true }], more: 9 },
          period: { from: "2025-10", to: "2026-09" },
          sheets: {
            items: [
              { sheetId: "s1", file: "店舗別売上", sheet: "2026年度" },
              { sheetId: "s2", file: "経費", sheet: "メモ" },
              { sheetId: "s3", file: "予算", sheet: "法人A" },
            ],
            more: 7,
            lastReadAt: "2026-10-09T16:30:00.000Z", // 日本時間では 2026-10-10 01:30
          },
          tables: { items: [{ id: tid, name: "月次 売上 & 経費" }], more: 2 },
        }),
        // 全部の欄が「値なし」の単位。最後に取り込んだ日が日本時間で年をまたぐ
        unitOf("部署", 5, {
          sheets: { items: [{ sheetId: "s4", file: "部署表", sheet: "1枚目" }], more: 0, lastReadAt: "2025-12-31T15:00:00.000Z" },
        }),
        unitOf(null, 2, { names: { items: [], more: 0 } }),
      ]),
    );
    await openHome(page);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(labelButtons(page).nth(2)).toContainText("(単位なし)");

    const open = async (i: number) => {
      const b = labelButtons(page).nth(i);
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
      await expect(b).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#box-panel-h")).toBeFocused();
    };
    const section = (sid: string) => panel(page).locator(`[data-section="${sid}"]`);
    const text = async (sid: string) => norm(await section(sid).locator("dd").innerText());

    await open(0);
    expect(await text("names")).toBe(`A社・B社・C社・D社・${evil} ほか 1,229`);
    expect(await text("inside")).toBe("拠点 1,500・(単位なし) 3 ほか 4");
    expect(await text("cardFields")).toBe("課税区分・担当者");
    expect(await text("measures")).toBe(`売上・精算額ƒ・${"とても長い数値の名前".repeat(6)}ƒ ほか 9`);
    await expect(section("measures").getByRole("img", { name: "計算された値" })).toHaveCount(2);
    expect(await text("period")).toBe("2025-10〜2026-09");
    expect(await text("sheets")).toBe("店舗別売上 › 2026年度・経費 › メモ・予算 › 法人A ほか 7 最後に取り込んだ日 2026-10-10"); // 日本時間(UTC の 10-09 16:30 は日本の 10-10)
    expect(await text("tables")).toBe("月次 売上 & 経費 › ほか 2");
    await expect(section("tables").getByRole("link", { name: "月次 売上 & 経費 ›" })).toHaveAttribute("href", `/table?def=${tid}`);
    await expect(section("cube").locator("dd")).toHaveText("【P8】");
    await expect(section("bands").locator("dd")).toHaveText("【P11】");
    // 長い名前でも欄が横にはみ出さない
    const box = await rectOf(panel(page));
    const vw = page.viewportSize()!.width;
    expect(box.x + box.w, "右の欄が画面に収まる").toBeLessThanOrEqual(vw + 1);
    expect(await panel(page).evaluate((el) => el.scrollWidth - el.clientWidth), "右の欄の横のはみ出し").toBeLessThanOrEqual(1);

    // 別の単位へ: 欄の中身が入れ替わり、値のない欄は「—」。年をまたぐ日付
    await open(1);
    await expect(labelButtons(page).nth(0)).toHaveAttribute("aria-expanded", "false");
    for (const sid of ["inside", "cardFields", "measures", "period", "tables"]) expect(await text(sid), sid).toBe("—");
    expect(await text("sheets")).toBe("部署表 › 1枚目 最後に取り込んだ日 2026-01-01");
    // 名前も何もない単位: 名前の欄も「—」
    await open(2);
    expect(await text("names")).toBe("—");
    await expect(page.locator("#box-panel-h")).toHaveText(/\(単位なし\)\s*2/);
  });

  test("最後に取り込んだ日: 日付がないシートは「—」。日本時間は、ブラウザの時刻帯(ロサンゼルス)に左右されない", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, timezoneId: "America/Los_Angeles", locale: "en-US" });
    const page = await ctx.newPage();
    await resetPrefs(page.request);
    await stubHome(
      page,
      overviewOf([
        unitOf("A", 3, { sheets: { items: [{ sheetId: "s", file: "f", sheet: "t" }], more: 0, lastReadAt: "2026-10-09T16:30:00.000Z" } }),
        unitOf("B", 2, { sheets: { items: [{ sheetId: "s", file: "f", sheet: "t" }], more: 0, lastReadAt: null } }),
      ]),
    );
    await openHome(page);
    await labelButtons(page).nth(0).click();
    expect(norm(await panel(page).locator('[data-section="sheets"] dd').innerText())).toBe("f › t 最後に取り込んだ日 2026-10-10");
    await labelButtons(page).nth(1).click();
    expect(norm(await panel(page).locator('[data-section="sheets"] dd').innerText())).toBe("f › t 最後に取り込んだ日 —");
    await ctx.close();
  });

  test("Box がないとき: 空の文と、次の操作「Import でファイルを取り込む」(立体は作らない)", async ({ page }) => {
    await stubHome(page, overviewOf([]));
    await page.goto("/");
    await expect(stage(page)).toHaveAttribute("data-mode", "empty");
    await expect(page.getByRole("heading", { name: "まだ Box がありません" })).toBeVisible();
    await expect(page.getByText("ファイルを取り込み、行が表す実体を選んで反映すると、ここに Box が並びます。")).toBeVisible();
    const next = page.getByRole("link", { name: "Import でファイルを取り込む" });
    await expect(next).toHaveAttribute("href", "/migrate");
    await expect(stage(page).locator("canvas")).toHaveCount(0);
    await expect(page.locator(LABELS)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Visual/ })).toHaveCount(0);
    await next.click();
    await expect(page).toHaveURL(/\/migrate$/);
  });

  test("読み込めなかったとき: エラーの文(alert)。data-mode=error。立体は作らない", async ({ page }) => {
    await stubHome(page, { status: 500, body: { error: "処理できませんでした。少し時間をおいてもう一度試してください" } });
    await page.goto("/");
    await expect(stage(page)).toHaveAttribute("data-mode", "error");
    await expect(page.locator("main").getByRole("alert")).toContainText("処理できませんでした");
    await expect(stage(page).locator("canvas")).toHaveCount(0);
    await stubHome(page, { status: 503, body: { error: "4DB のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)", code: "not_configured" } });
    await page.reload();
    await expect(stage(page)).toHaveAttribute("data-mode", "error");
    await expect(page.locator("main").getByRole("alert")).toContainText("4DB のデータベースがまだ設定されていません");
  });

  test("読み込み中: data-mode=loading と「読み込んでいます…」。終わると 3d", async ({ page }) => {
    await resetPrefs(page.request);
    await page.route("**/api/4db/home", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ json: overviewOf([unitOf("店舗", 3)]) });
    });
    await page.goto("/");
    await expect(stage(page)).toHaveAttribute("data-mode", "loading");
    await expect(page.getByText("読み込んでいます…")).toBeVisible();
    await expect(stage(page)).toHaveAttribute("data-mode", "3d", { timeout: 60_000 });
    await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  });
});

// 画面の大きさ(1280×800 と 1024×700)ごとに、単位 1〜6 つの舞台が崩れないこと
for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
]) {
  test.describe(`ホーム: ${size.width}×${size.height} の舞台`, () => {
    test.use({ viewport: size });

    for (const n of [1, 2, 3, 4, 5, 6]) {
      test(`単位 ${n} つ: 札が重ならず画面の中に収まり、横にはみ出さない。右の欄を開いても札が欄に隠れない(3 つまで)`, async ({ page }) => {
        test.setTimeout(120_000);
        await resetPrefs(page.request);
        await stubHome(page, overviewOf(manyUnits(n)));
        await openHome(page);
        const root = await rectOf(stage(page));
        const buttons = await labelButtons(page).all();
        expect(buttons).toHaveLength(n);
        const rects: Rect[] = [];
        for (const b of buttons) {
          await expect(b).toBeVisible();
          const r = await rectOf(b);
          rects.push(r);
          expect(r.x, "札が舞台の左に収まる").toBeGreaterThanOrEqual(root.x - 1);
          expect(r.x + r.w, "札が舞台の右に収まる").toBeLessThanOrEqual(root.x + root.w + 1);
          expect(r.y, "札が舞台の上に収まる").toBeGreaterThanOrEqual(root.y - 1);
          expect(r.y + r.h, "札が舞台の下に収まる").toBeLessThanOrEqual(root.y + root.h + 1);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `札 ${i} と ${j}`).toBe(false);
        const over = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          content: (() => { const c = document.querySelector(".content")!; return c.scrollWidth - c.clientWidth; })(),
        }));
        expect(over, "横のはみ出し").toEqual({ page: 0, content: 0 });

        if (n <= 3) {
          // 右の欄を開く: 欄は画面に収まり、札は欄の下に隠れない(立体は欄をよける)
          await buttons[0].click();
          await expect(panel(page)).toHaveJSProperty("inert", false);
          await page.waitForTimeout(1500); // 開く動きとカメラの寄りが終わるまで
          const pr = await rectOf(panel(page));
          expect(pr.x + pr.w, "右の欄が画面に収まる").toBeLessThanOrEqual(size.width + 1);
          for (const [i, b] of buttons.entries()) expect(overlap(pr, await rectOf(b), 4), `開いた欄と札 ${i}`).toBe(false);
        }
      });
    }
  });
}

test.describe("ホーム: キーボード", () => {
  test.beforeEach(async ({ page }) => {
    await resetPrefs(page.request);
    await stubHome(page, overviewOf(manyUnits(3)));
  });

  test("Tab で札へ → Enter で開く(見出しへフォーカス)→ Escape で札へ戻る。Space でも開く。閉じている欄には Tab で入れない", async ({ page }) => {
    await openHome(page);
    await hydrated(page);
    const first = labelButtons(page).first();
    // Tab で札に届く(枠の ☰・ログアウトのあと)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    let reached = false;
    const insidePanel: boolean[] = [];
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press("Tab");
      insidePanel.push(await page.evaluate(() => Boolean(document.activeElement?.closest("#box-panel"))));
      reached = await first.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "Tab で最初の札に届く").toBe(true);
    expect(insidePanel.some(Boolean), "閉じている欄の中にフォーカスが入らない").toBe(false);
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#box-panel-h")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toHaveJSProperty("inert", true);
    // Space でも開く(2 つ目の札)
    const second = labelButtons(page).nth(1);
    await second.focus();
    await page.keyboard.press("Space");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#box-panel-h")).toBeFocused();
    await expect(page.locator("#box-panel-h")).toContainText("単位2");
    // 開いている間は欄の中の「閉じる」へ Tab で届く
    await page.keyboard.press("Tab");
    await expect(panel(page).getByRole("button", { name: "閉じる" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveJSProperty("inert", true);
    await expect(second).toBeFocused();
  });

  test("同じ札をもう一度押すと閉じる。別の札を押すと欄の中身が入れ替わる(開くのは 1 つだけ)", async ({ page }) => {
    await openHome(page);
    const [a, b] = [labelButtons(page).nth(0), labelButtons(page).nth(1)];
    await a.click();
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await a.click();
    await expect(a).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toHaveJSProperty("inert", true);
    await a.click();
    await b.click();
    await expect(b).toHaveAttribute("aria-expanded", "true");
    await expect(a).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#box-panel-h")).toContainText("単位2");
    await expect(panel(page).locator("[data-section]")).toHaveCount(9);
  });

  // 札の置き方(below = 台の下 / float = Box の上)が違っても、Box を押して開け閉めできる。既定の見た目(パターン 3・float)と、パターン 7(below)の両方で
  for (const [label, look] of [["既定の見た目", undefined], ["パターン 7(札は台の下)", PATTERNS[6].look]] as const) {
  test(`canvas の Box を押すと開き、同じ Box をもう一度押すと閉じる(当たった Box の欄)。${label}`, async ({ page }) => {
    if (look) await resetPrefs(page.request, { ...look });
    await openHome(page);
    const canvas = stage(page).locator("canvas");
    const cb = await rectOf(canvas);
    const btn = labelButtons(page).first();
    const lb = await rectOf(btn);
    // 札の真上か真下に Box がある(札は Box の上にも台の下にも出る)。当たるまで、札の下・上へ交互に少しずつ離して探す(Box は押せる当たりの面)
    const spots: { x: number; y: number }[] = [];
    for (let dy = 30; dy <= 420; dy += 15) spots.push({ x: lb.x + lb.w / 2, y: lb.y + lb.h + dy }, { x: lb.x + lb.w / 2, y: lb.y - dy });
    const inCanvas = spots.filter((p) => p.y >= cb.y + 5 && p.y <= cb.y + cb.h - 5);
    let hit: { x: number; y: number } | null = null;
    for (const p of inCanvas) {
      if (hit) break;
      await page.mouse.click(p.x, p.y);
      if ((await btn.getAttribute("aria-expanded")) === "true") hit = p;
    }
    expect(hit, "canvas の Box を押せる場所が見つかる").not.toBeNull();
    await expect(page.locator("#box-panel-h")).toContainText("単位1");
    await page.waitForTimeout(1200); // カメラの寄り(欄をよける)が終わるまで。動いたあとの同じ場所は Box でないことがある
    // 閉じる: 同じ Box を押す。カメラが動いて場所がずれるので、もう一度探す
    let closed = false;
    for (const p of inCanvas) {
      if (closed) break;
      await page.mouse.click(p.x, p.y);
      closed = (await btn.getAttribute("aria-expanded")) === "false";
    }
    expect(closed, "同じ Box をもう一度押すと閉じる").toBe(true);
  });
  }

  test("Escape は Visual の欄 → 右の欄 の順に閉じる(どこにフォーカスがあっても)。閉じたあと、開いたボタンへ戻る", async ({ page }) => {
    await openHome(page);
    const label = labelButtons(page).first();
    await label.click();
    const visualBtn = page.getByRole("button", { name: /^Visual/ });
    await visualBtn.click();
    await expect(visualBtn).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#visual-panel")).toBeVisible();
    // 両方が開いている。Escape 1 回目: Visual だけ閉じる(ボタンへフォーカス)
    await page.keyboard.press("Escape");
    await expect(visualBtn).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#visual-panel")).toBeHidden();
    await expect(visualBtn).toBeFocused();
    await expect(label).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toHaveJSProperty("inert", false);
    // 2 回目: 右の欄が閉じて札へ戻る
    await page.keyboard.press("Escape");
    await expect(label).toHaveAttribute("aria-expanded", "false");
    await expect(label).toBeFocused();
    await expect(panel(page)).toHaveJSProperty("inert", true);
    // 何も開いていなければ、Escape は何もしない
    await page.keyboard.press("Escape");
    await expect(label).toHaveAttribute("aria-expanded", "false");
  });
});
