import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// 1つのアプリの枠(ロゴの帯・左のメニュー)・「暗い」「明るい」の切り替え・/sheet の転送・書体(実行中に外へ通信しない)。
// データベースは使わない(設定の画面と、枠だけを見る)。ログインの設定を空にした npm run dev(または scripts/dev-fourdb.mjs)で動かす。
// E2E_4DB_URL があれば、そのサーバーを相手にする(なければ playwright.config.ts の localhost:3000)
const BASE = process.env.E2E_4DB_URL ?? "http://localhost:3000";
test.use({ baseURL: BASE });

// 見た目の色(tools/design/tokens.mjs): 明るい = デザイン B の light、暗い = デザイン A の dark
const LIGHT = { bg: "rgb(243, 241, 236)", accent: "#2c5b8c", onAccent: "#ffffff" };
const DARK = { bg: "rgb(5, 7, 11)", accent: "#6aa6db", onAccent: "#05070b" };

// 画面の準備(hydration)が終わるまで待つ。終わる前の操作は効かない(React が操作の部品をつなぐのは、そのあと)。枠の ☰ が目印
const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector(".navbtn");
    return Boolean(el) && Object.keys(el!).some((k) => k.startsWith("__reactProps"));
  });
// 色の書き方をそろえる(ビルドで #ffffff が #fff になることがある)
const hex6 = (c: string) => (/^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : c).toLowerCase();
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name).then(hex6);
const cookieOf = async (ctx: BrowserContext, name: string) => (await ctx.cookies()).find((c) => c.name === name)?.value;

test.describe("枠: ロゴの帯と左のメニュー", () => {
  test("帯にロゴ・4DB・今いる場所・メール・ログアウト。メニューは今の画面に印が付き、キーボードで動かせる", async ({ page }) => {
    await page.goto("/settings");
    await hydrated(page);
    const top = page.getByRole("banner");
    await expect(top.locator('img[src="/brand/logo-64.png"]')).toBeVisible();
    await expect(top.getByText("4DB", { exact: true })).toBeVisible();
    await expect(top.getByText("設定", { exact: true })).toBeVisible(); // 今いる場所
    await expect(top.getByText("local-dev")).toBeVisible(); // ログインなしの開発用の利用者(ログインしていれば、そのメール)
    // ログアウトは POST のフォームのボタン(リンクではない)。見た目はリンクと同じ
    const logout = top.getByRole("button", { name: "ログアウト" });
    await expect(logout).toBeVisible();
    await expect(top.getByRole("link", { name: "ログアウト" })).toHaveCount(0);
    await expect(logout.locator("xpath=ancestor::form")).toHaveAttribute("method", "post");
    await expect(logout.locator("xpath=ancestor::form")).toHaveAttribute("action", "/auth/signout");
    expect(await logout.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.borderTopWidth]; })).toEqual(["rgba(0, 0, 0, 0)", "0px"]);

    // メニューは、はじめは閉じている。☰ で開く
    const nav = page.getByRole("navigation", { name: "画面" });
    await expect(page.locator(".shell")).toHaveAttribute("data-nav", "closed");
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    await expect(links).toHaveText([/Import/, /Table/, /設定/, /旧ダッシュボード/]);
    await expect(links.nth(0)).toHaveAttribute("href", "/migrate");
    await expect(links.nth(1)).toHaveAttribute("href", "/table");
    await expect(links.nth(2)).toHaveAttribute("href", "/settings");
    await expect(links.nth(3)).toHaveAttribute("href", "/");
    await expect(nav.getByText("ファイルから取り込む")).toBeVisible();
    await expect(nav.getByText("表で見る")).toBeVisible();
    // まだない画面はメニューに出さない
    for (const absent of ["Saving", "照合", "Column Registry", "Library", "World", "履歴", "ホーム"]) await expect(nav.getByText(absent)).toHaveCount(0);

    // 今の画面だけに aria-current。設定
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: /設定/ })).toHaveAttribute("aria-current", "page");

    // キーボード: メニューの項目に移って Enter で開く。取り込む › Import
    await nav.getByRole("link", { name: /Import/ }).focus();
    await expect(nav.getByRole("link", { name: /Import/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/migrate$/);
    await expect(page).toHaveTitle("Import | 4DB");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Import");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ファイルから取り込む");
    await expect(top.getByText("取り込む › Import")).toBeVisible();
    await expect(nav.getByRole("link", { name: /Import/ })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: /設定/ })).not.toHaveAttribute("aria-current", "page");

    // 見る › Table(題・ブラウザのタブ・今いる場所・メニューが「Table」)
    await nav.getByRole("link", { name: /Table/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/table$/);
    await expect(page).toHaveTitle("Table | 4DB");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Table");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("表で見る");
    await expect(top.getByText("見る › Table")).toBeVisible();
    await expect(nav.getByRole("link", { name: /Table/ })).toHaveAttribute("aria-current", "page");

    // Tab で枠の中を順に動ける(帯の ☰ → ログアウト → メニュー)。ログアウトのボタンにも Tab で届く
    await page.getByRole("button", { name: "メニューを閉じる" }).focus();
    await page.keyboard.press("Tab");
    await expect(logout).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("link", { name: /Import/ })).toBeFocused();
  });

  test("login は枠の外(帯もメニューもない)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "画面" })).toHaveCount(0);
  });

  test("メニューははじめ閉じている。☰ で開くとクッキーに覚え、次からは開いたまま(サーバーが最初の HTML に出す)。閉じれば、はじめの状態に戻る", async ({ page, context }) => {
    // はじめ(クッキーなし): サーバーが返す HTML から閉じている
    expect(await (await context.request.get("/settings")).text()).toContain('data-nav="closed"');
    await page.goto("/settings");
    await hydrated(page);
    const shell = page.locator(".shell");
    const nav = page.getByRole("navigation", { name: "画面" });
    await expect(shell).toHaveAttribute("data-nav", "closed");
    await expect(nav).toBeHidden(); // 閉じたメニューには Tab でも入れない
    await expect(page.getByRole("button", { name: "メニューを開く" })).toHaveAttribute("aria-expanded", "false");
    expect(await cookieOf(context, "fourdb_nav")).toBeUndefined();

    // ☰ で開く(キーボードでも)。開いたことをクッキーに覚える
    await page.getByRole("button", { name: "メニューを開く" }).focus();
    await page.keyboard.press("Enter");
    await expect(shell).toHaveAttribute("data-nav", "open");
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "メニューを閉じる" })).toHaveAttribute("aria-expanded", "true");
    expect(await cookieOf(context, "fourdb_nav")).toBe("open");

    // 次に開いたときも開いている(サーバーが返す HTML に出ている。ほかの画面でも)
    expect(await (await context.request.get("/settings")).text()).toContain('data-nav="open"');
    await page.reload();
    await hydrated(page);
    await expect(shell).toHaveAttribute("data-nav", "open");
    await expect(nav).toBeVisible();
    await page.goto("/table");
    await hydrated(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-nav", "open");

    // 閉じると、はじめの状態(クッキーなし)に戻る
    await page.getByRole("button", { name: "メニューを閉じる" }).click();
    await expect(page.locator(".shell")).toHaveAttribute("data-nav", "closed");
    expect(await cookieOf(context, "fourdb_nav")).toBeUndefined();
    expect(await (await context.request.get("/settings")).text()).toContain('data-nav="closed"');
  });

  test("クッキーの値は open だけを受け付ける(それ以外は、はじめと同じ閉じた状態)", async ({ browser, baseURL }) => {
    for (const bad of ["closed", "OPEN", "1", "true"]) {
      const ctx = await browser.newContext({ baseURL });
      await ctx.addCookies([{ name: "fourdb_nav", value: bad, url: baseURL! }]);
      expect(await (await ctx.request.get("/settings")).text(), bad).toContain('data-nav="closed"');
      await ctx.close();
    }
  });

  test("ログアウト: POST のボタンで /login へ。別のサイトからの POST・GET は断る(同じサイトの GET は今までどおり)", async ({ page, context }) => {
    await page.goto("/settings");
    await hydrated(page);
    await page.getByRole("banner").getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/); // 303 で GET に切り替わるので、/login の画面が開く
    await expect(page.getByLabel("メールアドレス")).toBeVisible();

    const refusedBody = { error: "この画面からの操作だけを受け付けます" };
    for (const site of ["cross-site", "same-site"]) {
      const post = await context.request.post("/auth/signout", { headers: { "sec-fetch-site": site }, maxRedirects: 0 });
      expect(post.status(), `POST ${site}`).toBe(403);
      expect(await post.json()).toEqual(refusedBody);
      expect((await context.request.get("/auth/signout", { headers: { "sec-fetch-site": site }, maxRedirects: 0 })).status(), `GET ${site}`).toBe(403);
    }
    expect((await context.request.post("/auth/signout", { headers: { origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
    // 同じサイトの GET(ログインの「許可がありません」の画面・旧ダッシュボードのリンク)と、同じサイトの POST は通る
    for (const method of ["get", "post"] as const) {
      const ok = await context.request[method]("/auth/signout", { headers: { "sec-fetch-site": "same-origin" }, maxRedirects: 0 });
      expect(ok.status(), method).toBe(303);
      expect(ok.headers()["location"]).toMatch(/\/login$/);
    }
  });

  test("枠の中の移動は next/link(ページを読み込み直さない)", async ({ page }) => {
    await page.goto("/settings");
    await hydrated(page);
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("navigation", { name: "画面" }).getByRole("link", { name: /Import/ }).click();
    await expect(page).toHaveURL(/\/migrate$/);
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
  });
});

test.describe("/sheet は /table へ転送する", () => {
  test("308 で /table へ。問い合わせ(?def= など)を引き継ぐ", async ({ request }) => {
    for (const [from, to] of [["/sheet", "/table"], ["/sheet?def=abc", "/table?def=abc"], ["/sheet?def=abc&x=1", "/table?def=abc&x=1"]]) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(res.headers()["location"], from).toBe(to);
    }
  });

  test("ブラウザで /sheet を開くと /table の画面になる", async ({ page }) => {
    await page.goto("/sheet?def=abc");
    await expect(page).toHaveURL(/\/table\?def=abc$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Table");
  });
});

for (const [os, expected] of [["light", LIGHT], ["dark", DARK]] as const) {
  test.describe(`見た目: パソコンの設定が${os === "light" ? "明るい" : "暗い"}(クッキーなし)`, () => {
    test.use({ colorScheme: os });

    test(`${os === "light" ? "明るい(デザイン B)" : "暗い(デザイン A)"}の値になる。HTML に data-theme は付かない`, async ({ page, context }) => {
      const html = await (await context.request.get("/settings")).text();
      expect(html).not.toMatch(/<html[^>]*data-theme/);
      await page.goto("/settings");
      expect(await bodyBg(page)).toBe(expected.bg);
      expect(await token(page, "--accent")).toBe(expected.accent);
      expect(await token(page, "--on-accent")).toBe(expected.onAccent);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(os);
      // 設定の「パソコンの設定に合わせる」が選ばれている
      await expect(page.getByRole("radio", { name: "パソコンの設定に合わせる" })).toBeChecked();
    });
  });
}

test.describe("見た目の切り替え(設定)", () => {
  test.use({ colorScheme: "light" });

  test("暗い・明るい・パソコンの設定に合わせる: すぐ変わり、再読み込みしても残り、サーバーが返す HTML に data-theme がある", async ({ page, context }) => {
    await page.goto("/settings");
    await hydrated(page);
    const html = page.locator("html");
    await expect(page.getByRole("radiogroup", { name: "画面の見た目" }).getByRole("radio")).toHaveCount(3);
    expect(await bodyBg(page)).toBe(LIGHT.bg);

    // 暗い: 再読み込みなしですぐ変わる
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await page.getByRole("radio", { name: "暗い", exact: true }).check();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).toBe(DARK.bg);
    expect(await token(page, "--accent")).toBe(DARK.accent);
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
    expect(await cookieOf(context, "fourdb_theme")).toBe("dark");
    // サーバーが返す HTML に data-theme(= 最初の描画から暗い。ちらつかない)
    expect(await (await context.request.get("/settings")).text()).toMatch(/<html[^>]*data-theme="dark"/);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).toBe(DARK.bg);
    await expect(page.getByRole("radio", { name: "暗い", exact: true })).toBeChecked();
    // ほかの画面にも効く
    await page.goto("/table");
    expect(await bodyBg(page)).toBe(DARK.bg);

    // 明るい(パソコンの設定が明るくても、暗い → 明るいと切り替わる)
    await page.goto("/settings");
    await hydrated(page);
    await page.getByRole("radio", { name: "明るい", exact: true }).check();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await bodyBg(page)).toBe(LIGHT.bg);
    expect(await cookieOf(context, "fourdb_theme")).toBe("light");
    expect(await (await context.request.get("/settings")).text()).toMatch(/<html[^>]*data-theme="light"/);

    // パソコンの設定に合わせる: クッキーと印を消す(OS が明るいので明るい)
    await page.getByRole("radio", { name: "パソコンの設定に合わせる" }).check();
    await expect(html).not.toHaveAttribute("data-theme", /.*/);
    expect(await cookieOf(context, "fourdb_theme")).toBeUndefined();
    expect(await (await context.request.get("/settings")).text()).not.toMatch(/<html[^>]*data-theme/);
    await page.reload();
    await expect(page.getByRole("radio", { name: "パソコンの設定に合わせる" })).toBeChecked();
  });

  test("OS が明るくても、暗いを選べば暗い。OS が暗くても、明るいを選べば明るい(設定が OS に優先する)", async ({ browser, baseURL }) => {
    for (const [os, chosen, expected] of [["light", "dark", DARK], ["dark", "light", LIGHT]] as const) {
      const ctx = await browser.newContext({ baseURL, colorScheme: os });
      await ctx.addCookies([{ name: "fourdb_theme", value: chosen, url: baseURL! }]);
      const page = await ctx.newPage();
      await page.goto("/settings");
      expect(await bodyBg(page), `${os} + ${chosen}`).toBe(expected.bg);
      expect(await token(page, "--accent")).toBe(expected.accent);
      await ctx.close();
    }
  });

  test("クッキーの値は dark / light だけを受け付け、それ以外は無視する", async ({ browser, baseURL }) => {
    for (const bad of ["evil", "DARK", "auto", "a-dark", "b-light"]) {
      const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
      await ctx.addCookies([{ name: "fourdb_theme", value: bad, url: baseURL! }]);
      const html = await (await ctx.request.get("/settings")).text();
      expect(html, bad).not.toMatch(/<html[^>]*data-theme/);
      const page = await ctx.newPage();
      await page.goto("/settings");
      expect(await bodyBg(page), bad).toBe(LIGHT.bg);
      await expect(page.getByRole("radio", { name: "パソコンの設定に合わせる" })).toBeChecked();
      await ctx.close();
    }
  });

  test("script なしでも、最初の描画から選んだ見た目(サーバーが決めている)", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: "light", javaScriptEnabled: false });
    await ctx.addCookies([{ name: "fourdb_theme", value: "dark", url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto("/settings");
    expect(await bodyBg(page)).toBe(DARK.bg);
    await ctx.close();
  });

  test("ログイン画面は、設定(明るい)と OS の明るい設定のときも、いつも黒", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: "light" });
    await ctx.addCookies([{ name: "fourdb_theme", value: "light", url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto("/login");
    const black = "rgb(0, 0, 0)";
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(black);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("main")!.parentElement!).backgroundColor)).toBe(black);
    await expect(page.locator("main").locator("xpath=..")).toHaveAttribute("data-theme", "dark");
    await ctx.close();
  });
});

test.describe("書体: ビルド時に取り込み、実行中に外へ通信しない", () => {
  test("画面を開いても fonts.googleapis.com・fonts.gstatic.com・cdnjs・jsdelivr などの外へ通信しない。書体は自分のサーバーから読み込まれる", async ({ page, baseURL }) => {
    const hosts = new Map<string, number>();
    const fontFiles: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol === "data:" || u.protocol === "blob:") return;
      hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
      // /__nextjs_font/ は開発サーバーの画面(エラー表示など)が使う書体。アプリの書体ではないので数えない
      if (r.resourceType() === "font" && !u.pathname.startsWith("/__nextjs_font/")) fontFiles.push(u.pathname);
    });
    for (const path of ["/settings", "/migrate", "/table", "/login"]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
    }
    const own = new URL(baseURL!).host;
    const external = [...hosts.keys()].filter((h) => h !== own);
    expect(external, `外への通信: ${external.join(", ")}`).toEqual([]);
    for (const banned of ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs", "jsdelivr"]) expect([...hosts.keys()].some((h) => h.includes(banned)), banned).toBe(false);
    // 書体のファイルは自分のサーバー(/_next/static/media/…)から
    expect(fontFiles.length).toBeGreaterThan(0);
    for (const f of fontFiles) expect(f).toMatch(/^\/_next\/static\/media\//);
  });

  test("数字の書体(Montserrat)・本文の書体(Zen Kaku Gothic New)が使われる", async ({ page }) => {
    await page.goto("/settings");
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
    expect(loaded.some((f) => /montserrat/i.test(f)), loaded.join(",")).toBe(true);
    const families = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      word: getComputedStyle(document.querySelector(".word")!).fontFamily,
    }));
    expect(families.body).toMatch(/Zen Kaku Gothic New/);
    expect(families.word).toMatch(/Montserrat/);
  });
});

test.describe("コンソール", () => {
  test("枠・設定・ログインを開いても、コンソールにエラーが出ない(hydration のずれも出ない)", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    // 取り込み・Table は、データベースにつながる開発サーバー(E2E_4DB_URL)のときだけ(つながらないと API が失敗して、その分のエラーが出るため)
    const paths = ["/settings", "/login", ...(process.env.E2E_4DB_URL ? ["/migrate", "/table"] : [])];
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    }
    // 見た目を切り替えても、枠のメニューを開け閉めしても、エラーは出ない
    await page.goto("/settings");
    await hydrated(page);
    await page.getByRole("radio", { name: "暗い", exact: true }).check();
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "メニューを閉じる" }).click();
    await page.reload();
    await hydrated(page);
    expect(problems).toEqual([]);
  });
});
