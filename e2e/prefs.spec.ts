import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_LOOK } from "@/fourdb/core/prefs";
import { getPrefs, hydrated, resetPrefs, watch, type PrefsState } from "./support";

// 設定(/settings)と、アカウントに覚える明暗・World(PrefsProvider)。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/prefs.spec.ts
// タブの読み込みごとの突き合わせの 3 つの決まり(P2b の 6 章)は、GET の答えを差し替えて(route)確かめる。
//   (1) この端末の送っていない変更(localStorage fourdb.prefs.pending)があれば、先に PUT する
//   (2) アカウントに何も保存していない(saved: false)なら、クッキーの明暗を PUT して移す
//   (3) 保存してあって、クッキーと違えば、クッキーと <html data-theme> をアカウントに合わせる
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 }, colorScheme: "light" });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");

const PENDING = "fourdb.prefs.pending";
const LIGHT_BG = "rgb(243, 241, 236)";
const DARK_BG = "rgb(5, 7, 11)";
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const pending = (page: Page) => page.evaluate((k) => localStorage.getItem(k), PENDING);
const cookie = async (page: Page, name = "fourdb_theme") => (await page.context().cookies()).find((c) => c.name === name)?.value;
const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const serverState = (over: Partial<PrefsState["prefs"]> = {}, flags: Partial<Pick<PrefsState, "available" | "saved">> = {}): PrefsState => ({
  available: true,
  saved: true,
  ...flags,
  prefs: { theme: null, world: "plain", look: { ...DEFAULT_LOOK }, ...over },
});
/** GET /api/4db/prefs を決まった答えにして、PUT の本文を集める(PUT は 200 で、送られた欄を重ねて返す) */
async function stubPrefs(page: Page, state: PrefsState) {
  const puts: unknown[] = [];
  const gets: number[] = [];
  await page.route("**/api/4db/prefs", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      gets.push(Date.now());
      return route.fulfill({ json: state });
    }
    const body = JSON.parse(req.postData() ?? "{}");
    puts.push(body);
    return route.fulfill({ json: { ...state, saved: true, prefs: { ...state.prefs, ...body } } });
  });
  return { puts, gets };
}

test.beforeEach(async ({ page }) => {
  await resetPrefs(page.request);
});
test.afterEach(async ({ page }) => {
  await resetPrefs(page.request);
});

test.describe("設定の画面", () => {
  test("「画面の見た目」は 3 択、「World」は「無地」だけ(role=radiogroup)。説明の文", async ({ page }) => {
    await page.goto("/settings");
    await hydrated(page);
    await expect(page).toHaveTitle("設定 | 4DB");
    const themeGroup = page.getByRole("radiogroup", { name: "画面の見た目" });
    await expect(themeGroup.getByRole("radio")).toHaveCount(3);
    await expect(themeGroup.locator("label")).toHaveText(["暗い", "明るい", "パソコンの設定に合わせる"]);
    await expect(themeGroup.getByRole("radio", { name: "パソコンの設定に合わせる" })).toBeChecked();
    await expect(page.getByText("選んだものは、アカウントに覚えます(どのパソコンでも同じになります)。")).toBeVisible();
    // World
    const world = page.getByRole("radiogroup", { name: /World/ });
    await expect(world).toBeVisible();
    await expect(page.getByRole("heading", { name: /World/ })).toContainText("まわりの世界");
    await expect(world.getByRole("radio")).toHaveCount(1);
    await expect(world.getByRole("radio", { name: "無地" })).toBeChecked();
    await expect(page.getByText("ほかの世界は、あとで選べるようになります。")).toBeVisible();
    // 無地を押し直しても何も送らない(変わっていない)
    const w = watch(page);
    await world.getByRole("radio", { name: "無地" }).check();
    await page.waitForTimeout(500);
    expect(w.puts).toEqual([]);
  });

  test("明暗を選ぶと、すぐ画面・クッキーが変わり、アカウントに覚える。別のブラウザ(クッキーなし)でも同じ明暗になり、設定の選択も合う", async ({ page, browser, baseURL }) => {
    const w = watch(page);
    await page.goto("/settings");
    await hydrated(page);
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    w.puts.length = 0;
    await page.getByRole("radio", { name: "暗い", exact: true }).check();
    expect(await bodyBg(page)).toBe(DARK_BG); // すぐ(PUT の返事を待たない)
    await expect.poll(() => cookie(page)).toBe("dark");
    await expect.poll(() => w.puts.length).toBe(1);
    expect(JSON.parse(w.puts[0].body)).toEqual({ theme: "dark" });
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme).toBe("dark");
    expect(await pending(page)).toBeNull();

    // 別のブラウザ: クッキーなし・パソコンの設定は明るい → 読み込みのあと、アカウントの暗いに合わせ、クッキーも書く
    const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
    const other = await ctx.newPage();
    await other.goto("/settings");
    await hydrated(other);
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(other)).toBe(DARK_BG);
    await expect(other.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    expect(await cookie(other)).toBe("dark");
    // こちらを「明るい」にすると、元のブラウザも読み込み直しで明るくなる
    await other.getByRole("radio", { name: "明るい", exact: true }).check();
    await expect.poll(async () => (await getPrefs(other.request)).prefs.theme).toBe("light");
    await ctx.close();
    await page.reload();
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "明るい", exact: true })).toBeChecked();
    expect(await cookie(page)).toBe("light");
    // 「パソコンの設定に合わせる」: PUT は theme: null。クッキーも data-theme も消える
    w.puts.length = 0;
    await page.getByRole("radio", { name: "パソコンの設定に合わせる" }).check();
    await expect.poll(() => w.puts.length).toBe(1);
    expect(JSON.parse(w.puts[0].body)).toEqual({ theme: null });
    expect(await theme(page)).toBeNull();
    expect(await cookie(page)).toBeUndefined();
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme).toBeNull();
  });

  test("保存に失敗したとき: 「アカウントに保存できませんでした。このブラウザには覚えています。」。見た目は変わったまま。読み込み直すと、この端末の変更が先に送られる", async ({ page }) => {
    let fail = true;
    await page.route("**/api/4db/prefs", (route) => (route.request().method() === "PUT" && fail ? route.fulfill({ status: 500, json: { error: "x" } }) : route.continue()));
    await page.goto("/settings");
    await hydrated(page);
    await page.getByRole("radio", { name: "暗い", exact: true }).check();
    await expect(page.locator("main").getByRole("alert")).toHaveText("アカウントに保存できませんでした。このブラウザには覚えています。");
    expect(await bodyBg(page)).toBe(DARK_BG);
    expect(await cookie(page)).toBe("dark");
    expect(JSON.parse((await pending(page)) ?? "null")).toEqual({ theme: "dark" });
    expect((await getPrefs(page.request)).prefs.theme, "アカウントはまだ元のまま").toBeNull();
    // 直ったあとで読み込み直す: この端末の変更が先に PUT される → アカウントに入り、残りは消える
    fail = false;
    const w = watch(page);
    await page.reload();
    await hydrated(page);
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme, { timeout: 10_000 }).toBe("dark");
    await expect.poll(() => pending(page), { timeout: 10_000 }).toBeNull();
    expect(w.puts.map((p) => JSON.parse(p.body))).toContainEqual({ theme: "dark" });
    await expect(page.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });

  test("アカウントへ保存できないとき(available: false): PUT は送らず、「いまはこのパソコンにだけ覚えます」。選んだ明暗はこのブラウザに残る", async ({ page }) => {
    const { puts } = await stubPrefs(page, serverState({}, { available: false, saved: false }));
    await page.goto("/settings");
    await hydrated(page);
    await expect(page.getByText("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)")).toBeVisible();
    await page.getByRole("radio", { name: "暗い", exact: true }).check();
    await page.waitForTimeout(800);
    expect(puts).toEqual([]);
    expect(await bodyBg(page)).toBe(DARK_BG);
    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    expect(puts, "読み込み直しても送らない").toEqual([]);
  });

  test("script なしでも、最初の描画から選んだ明暗(クッキーをサーバーが読む)。クッキーの値は dark / light だけを受け付ける", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: "light", javaScriptEnabled: false });
    await ctx.addCookies([{ name: "fourdb_theme", value: "dark", url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto("/settings");
    expect(await bodyBg(page)).toBe(DARK_BG);
    expect(await theme(page)).toBe("dark");
    await ctx.close();
    for (const bad of ["evil", "DARK", "auto"]) {
      const c2 = await browser.newContext({ baseURL, colorScheme: "light", javaScriptEnabled: false });
      await c2.addCookies([{ name: "fourdb_theme", value: bad, url: baseURL! }]);
      const p2 = await c2.newPage();
      await p2.goto("/settings");
      expect(await theme(p2), bad).toBeNull();
      expect(await bodyBg(p2), bad).toBe(LIGHT_BG);
      await c2.close();
    }
  });
});

test.describe("読み込みごとの突き合わせ(GET の答えを差し替える)", () => {
  test("読み込みごとに GET は 1 回(開発サーバーは React が 1 回やり直すので 2 回まで)。DB がなければ通信しない決まりは nodb.spec.ts", async ({ page }) => {
    const { gets } = await stubPrefs(page, serverState());
    await page.goto("/settings");
    await hydrated(page);
    await page.waitForTimeout(800);
    expect(gets.length).toBeGreaterThanOrEqual(1);
    expect(gets.length).toBeLessThanOrEqual(2);
    // 画面の中を移っても、読み直さない(タブの読み込みごとに 1 回)
    const n = gets.length;
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("navigation", { name: "画面" }).getByRole("link", { name: /履歴/ }).click();
    await expect(page).toHaveURL(/\/history$/);
    await page.getByRole("navigation", { name: "画面" }).getByRole("link", { name: /設定/ }).click();
    await page.waitForTimeout(500);
    expect(gets.length).toBe(n);
  });

  test("(2) アカウントに何も保存していなければ、クッキーの明暗を PUT して移す。クッキーが「合わせる」(なし)なら送らない", async ({ browser, baseURL }) => {
    for (const [cookieTheme, expectPut] of [["dark", { theme: "dark" }], ["light", { theme: "light" }], [null, null]] as const) {
      const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
      if (cookieTheme) await ctx.addCookies([{ name: "fourdb_theme", value: cookieTheme, url: baseURL! }]);
      const page = await ctx.newPage();
      const { puts } = await stubPrefs(page, serverState({}, { saved: false }));
      await page.goto("/settings");
      await hydrated(page);
      await page.waitForTimeout(1000);
      expect(puts, `クッキー ${cookieTheme}`).toEqual(expectPut ? [expectPut] : []);
      if (cookieTheme) expect(await theme(page)).toBe(cookieTheme);
      await ctx.close();
    }
  });

  test("(3) 保存してあって、クッキーと違えば、クッキーと data-theme をアカウントに合わせる(送らない)。アカウントが「合わせる」(null)なら、クッキーも消す", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
    await ctx.addCookies([{ name: "fourdb_theme", value: "dark", url: baseURL! }]);
    const page = await ctx.newPage();
    const { puts } = await stubPrefs(page, serverState({ theme: "light" }));
    await page.goto("/settings");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await cookie(page)).toBe("light");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    await expect(page.getByRole("radio", { name: "明るい", exact: true })).toBeChecked();
    expect(puts).toEqual([]);
    await ctx.close();
    // アカウントが null(パソコンの設定に合わせる)で、クッキーが dark → クッキーを消す
    const c2 = await browser.newContext({ baseURL, colorScheme: "light" });
    await c2.addCookies([{ name: "fourdb_theme", value: "dark", url: baseURL! }]);
    const p2 = await c2.newPage();
    await stubPrefs(p2, serverState({ theme: null }));
    await p2.goto("/settings");
    await hydrated(p2);
    await expect.poll(() => theme(p2)).toBeNull();
    expect(await cookie(p2)).toBeUndefined();
    await expect(p2.getByRole("radio", { name: "パソコンの設定に合わせる" })).toBeChecked();
    await c2.close();
  });

  test("(1) この端末の送っていない変更(pending)があれば、アカウントの値より先に PUT する(この端末が勝つ)。壊れた pending は無視する", async ({ page }) => {
    const { puts } = await stubPrefs(page, serverState({ theme: "light" }));
    await page.goto("/settings");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); // 最初の突き合わせが終わった(アカウントの light)あとで、この端末の変更を作る
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ theme: "dark", look: { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" } })), PENDING);
    await page.reload();
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ theme: "dark", look: { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" } });
    await expect.poll(() => pending(page)).toBeNull();
    await expect(page.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    // 壊れた pending(形の違う JSON・知らない値・巨大な文字)は無視して、落ちない
    for (const bad of ["not json", '{"theme":"evil"}', '{"look":{"shape":"x"}}', '{"__proto__":{"theme":"dark"}}', "[]", "null", "x".repeat(50_000)]) {
      const ctx = await page.context().browser()!.newContext({ baseURL: BASE, colorScheme: "light" });
      const p = await ctx.newPage();
      const problems: string[] = [];
      p.on("pageerror", (e) => problems.push(e.message));
      const { puts: ps } = await stubPrefs(p, serverState({ theme: "light" }));
      await p.goto("/settings");
      await hydrated(p);
      await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
      await p.evaluate(([k, v]) => localStorage.setItem(k, v), [PENDING, bad]);
      await p.reload();
      await hydrated(p);
      await expect.poll(() => theme(p), { message: bad.slice(0, 30), timeout: 10_000 }).toBe("light"); // アカウントの値(light)になる
      await p.waitForTimeout(500);
      expect(ps, `pending = ${bad.slice(0, 30)}`).toEqual([]);
      expect(problems).toEqual([]);
      await ctx.close();
    }
  });

  test("GET が失敗しても、画面はクッキーの明暗で動く(エラーを出さない)", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
    await ctx.addCookies([{ name: "fourdb_theme", value: "dark", url: baseURL! }]);
    const page = await ctx.newPage();
    await page.route("**/api/4db/prefs", (route) => (route.request().method() === "GET" ? route.fulfill({ status: 500, json: { error: "x" } }) : route.continue()));
    await page.goto("/settings");
    await hydrated(page);
    expect(await bodyBg(page)).toBe(DARK_BG);
    await expect(page.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await ctx.close();
  });
});
