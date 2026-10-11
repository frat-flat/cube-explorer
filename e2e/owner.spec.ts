import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { DEFAULT_LOOK, OWNER_HEADER, PATTERNS } from "@/fourdb/core/prefs";
import { getPrefs, hydrated, localDevOwner, manyUnits, openHome, otherOwner, overviewOf, ownerHeaders, pendingText, resetPrefs, stage, stubHome, type PrefsState } from "./support";

// 設定の送り先のアカウントを取り違えない仕組み(セキュリティ L-4。アカウントの指紋 x-4db-owner)の画面テスト。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/owner.spec.ts
// 1. サーバー(本物): PUT /api/4db/prefs は、いまのログインの指紋がなければ 409 owner_mismatch で、何も書かない。確かめる順番は 別のサイト 403 → ログイン 401 → 指紋 409 → 本文 400
// 2. 画面(PUT・GET の答えを差し替える): 401・403 は残さず・送らず・読み直さない。409 owner_mismatch は残さず、GET で 1 回読み直し、もう送らない。code のない 409 は今までどおり(残す)
// 3. 残した変更の指紋: 違うアカウントのもの・古い形(指紋なし)は読み込みで捨てる。同じアカウントのものは先に送る
// ログインなしの開発(FOURDB_LOCAL_DEV=1 の local-dev)では、ログインの切れた状態を作れないので、401・403・409 は PUT の答えを差し替えて起こす(サーバーの 409 は本物)。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 }, colorScheme: "light" });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 90_000 });

const PENDING = "fourdb.prefs.pending";
const LOCAL_NOTE = "いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)";
const pending = (page: Page) => page.evaluate((k) => localStorage.getItem(k), PENDING);
const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const radio = (page: Page, name: "暗い" | "明るい") => page.getByRole("radio", { name, exact: true });
const serverState = (over: Partial<PrefsState["prefs"]> = {}, flags: Partial<Pick<PrefsState, "available" | "saved">> = {}): PrefsState => ({
  available: true,
  saved: true,
  ...flags,
  prefs: { theme: null, world: "plain", look: { ...DEFAULT_LOOK }, ...over },
});

type Put = { body: unknown; owner: string | undefined; at: number };
type Reply = { status: number; json?: unknown; body?: string } | "continue";
/**
 * /api/4db/prefs の見張りと差し替え。get = GET の答え(なければ本物のサーバー)。put(n) = n 番目(0 から)の PUT の答え(なければ・"continue" なら本物のサーバー)。
 * 使い方は、goto の前に呼ぶ。gets・puts に、来た順に積む(PUT は本文と、画面が付けた指紋)
 */
async function routePrefs(page: Page, opts: { get?: PrefsState; put?: (n: number) => Reply | Promise<Reply> } = {}) {
  const gets: number[] = [];
  const puts: Put[] = [];
  await page.route("**/api/4db/prefs", async (route: Route) => {
    const req = route.request();
    if (req.method() === "GET") {
      gets.push(Date.now());
      return opts.get ? route.fulfill({ json: opts.get }) : route.continue();
    }
    const n = puts.length;
    puts.push({ body: JSON.parse(req.postData() ?? "null"), owner: req.headers()[OWNER_HEADER], at: Date.now() });
    const reply = (await opts.put?.(n)) ?? "continue";
    if (reply === "continue") return route.continue();
    return route.fulfill({ status: reply.status, ...(reply.body !== undefined ? { body: reply.body } : { json: reply.json ?? { error: "x" } }) });
  });
  return { gets, puts };
}

test.beforeEach(async ({ page }) => {
  await resetPrefs(page.request);
});
test.afterEach(async ({ page }) => {
  await resetPrefs(page.request);
});

// ---------- 1. サーバー(本物の開発サーバー) ----------

test.describe("サーバー: PUT /api/4db/prefs は、いまのログインの指紋を確かめる", () => {
  test("指紋が別のアカウントのもの・ない・形が違うときは 409 owner_mismatch で、何も書かない。いまのアカウントの指紋なら 200", async ({ page }) => {
    const req = page.request;
    const own = localDevOwner();
    expect(otherOwner(), "別のアカウントの指紋は、いまのアカウントのものとは違う").not.toBe(own);
    const before = await getPrefs(req);
    const swapped = [...own].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
    const cases: [string, Record<string, string>][] = [
      ["別のアカウントの指紋(neon:other)", ownerHeaders({}, otherOwner())],
      ["ヘッダーなし", ownerHeaders({}, null)],
      ["空のヘッダー", { [OWNER_HEADER]: "" }],
      ["21 文字", { [OWNER_HEADER]: own.slice(0, 21) }],
      ["23 文字", { [OWNER_HEADER]: `${own}A` }],
      ["base64url の外の文字(+)", { [OWNER_HEADER]: `${own.slice(0, 21)}+` }],
      ["詰め物(=)つき", { [OWNER_HEADER]: `${own.slice(0, 20)}==` }],
      ["指紋を 2 つ並べたもの", { [OWNER_HEADER]: `${own},${own}` }],
      ["principal そのもの(local-dev)", { [OWNER_HEADER]: "local-dev" }],
      ["大文字小文字を入れ替えたもの(base64url は区別する)", { [OWNER_HEADER]: swapped }],
    ];
    for (const [label, headers] of cases) {
      const res = await req.put("/api/4db/prefs", { data: { theme: "dark", world: "plain" }, headers });
      expect(res.status(), label).toBe(409);
      const j = await res.json();
      expect(j.code, label).toBe("owner_mismatch");
      expect(JSON.stringify(j), `${label}: 答えに指紋・principal を含めない`).not.toContain(own);
      expect(JSON.stringify(j), label).not.toContain("local-dev");
    }
    expect(await getPrefs(req), "409 のどれも、設定を変えていない").toEqual(before);

    // いまのアカウントの指紋なら通る(ヘッダーの名前は大文字小文字を区別しない)
    const ok = await req.put("/api/4db/prefs", { data: { theme: "dark" }, headers: { "X-4DB-Owner": own } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ available: true, saved: true, prefs: { theme: "dark", world: "plain", look: { ...DEFAULT_LOOK } } });
    expect((await getPrefs(req)).prefs.theme).toBe("dark");
    // GET は指紋なしで読める(読むだけ)
    expect((await req.get("/api/4db/prefs")).status()).toBe(200);
  });

  test("確かめる順番: 別のサイト 403 → 指紋 409 → 本文 400(指紋が違えば、本文が形違いでも 409。指紋が合えば 400)", async ({ page }) => {
    const req = page.request;
    const own = localDevOwner();
    const before = await getPrefs(req);
    // 別のサイトからは、指紋が合っていても・違っても・なくても 403(指紋の確かめより先)
    for (const [label, owner] of [["合っている指紋", own], ["別のアカウントの指紋", otherOwner()], ["指紋なし", null]] as const) {
      for (const site of [{ "sec-fetch-site": "cross-site" }, { origin: "https://evil.example" }] as Record<string, string>[]) {
        const res = await req.put("/api/4db/prefs", { data: { theme: "dark" }, headers: ownerHeaders(site, owner) });
        expect(res.status(), `${label} ${JSON.stringify(site)}`).toBe(403);
      }
    }
    // 本文が形違い: 指紋が違う・ない → 409(指紋が先)、指紋が合う → 400
    const badBodies: unknown[] = [{ unknown: 1 }, { theme: "blue" }, [], { look: { shape: "glass" } }];
    for (const body of badBodies) {
      for (const [label, owner] of [["別のアカウントの指紋", otherOwner()], ["指紋なし", null]] as const) {
        const res = await req.put("/api/4db/prefs", { data: body as never, headers: ownerHeaders({}, owner) });
        expect(res.status(), `${label} ${JSON.stringify(body)}`).toBe(409);
      }
      const res = await req.put("/api/4db/prefs", { data: body as never, headers: ownerHeaders() });
      expect(res.status(), `合っている指紋 ${JSON.stringify(body)}`).toBe(400);
    }
    // 壊れた JSON と大きすぎる本文も、指紋が違えば 409・合えば 400
    for (const raw of ['{"theme":"dark",', `{"theme":"dark"}${" ".repeat(5000)}`]) {
      const json = { "content-type": "application/json" };
      expect((await req.put("/api/4db/prefs", { data: raw, headers: ownerHeaders(json, otherOwner()) })).status(), "壊れた/大きい本文 + 別の指紋").toBe(409);
      expect((await req.put("/api/4db/prefs", { data: raw, headers: ownerHeaders(json) })).status(), "壊れた/大きい本文 + 合う指紋").toBe(400);
    }
    expect(await getPrefs(req), "どれも設定を変えていない").toEqual(before);
  });

  test("画面が送る PUT には、いまのアカウントの指紋が付き(本物のサーバーが通す)、設定がアカウントに入る", async ({ page }) => {
    const { puts } = await routePrefs(page);
    await page.goto("/settings");
    await hydrated(page);
    await radio(page, "暗い").check();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].owner, "画面が付けた指紋").toBe(localDevOwner());
    expect(puts[0].body).toEqual({ theme: "dark" });
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme).toBe("dark");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(await pending(page)).toBeNull();
  });
});

// ---------- 2. 画面: 401・403・409 ----------

test.describe("画面: ログインが切れた(401・403)ときは、残さず・送らず・読み直さない", () => {
  test("複数のタブ: 1 つ目のタブが送っている最中に、2 つ目のタブがログアウトし、1 つ目の PUT が 401。残さない・もう送らない・値はそのまま・GET をやり直さない", async ({ context }) => {
    // 1 つ目のタブ(T1): PUT を止めておく(送っている最中の状態)
    const t1 = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { gets, puts } = await routePrefs(t1, {
      put: async () => {
        await gate;
        return { status: 401, json: { error: "ログインが必要です" } };
      },
    });
    await t1.goto("/settings");
    await hydrated(t1);
    await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1); // 読み込みごとの GET(開発サーバーは React がやり直して 2 回まで)
    await t1.waitForTimeout(800); // 開発サーバーの React のやり直しの GET(2 回目)が出そろうのを待つ。このあとの GET の数と比べるため
    await radio(t1, "暗い").check();
    await expect.poll(() => puts.length).toBe(1); // 送った(答えは止めてある)
    expect(await theme(t1)).toBe("dark");

    // 2 つ目のタブ(T2): 同じブラウザで開いて、ログアウトする(送る直前に localStorage の送っていない変更を消すフォーム)
    const t2 = await context.newPage();
    await t2.goto("/settings");
    await hydrated(t2);
    await t2.getByRole("banner").getByRole("button", { name: "ログアウト" }).click();
    await expect(t2).toHaveURL(/\/login$/);
    expect(await pending(t2), "ログアウトで、送っていない変更は消えた").toBeNull();

    // T1 の PUT に 401 が返る
    const getsBefore = gets.length;
    release();
    await expect(t1.getByText(LOCAL_NOTE)).toBeVisible(); // 保存の状態が「このパソコンにだけ」になる
    await t1.waitForTimeout(1500); // 800ms のまとめ・再試行があっても出ない長さ
    expect(await pending(t1), "残さない(次にログインする別のアカウントに渡さない)").toBeNull();
    expect(puts.length, "もう送らない").toBe(1);
    expect(gets.length, "GET をやり直さない").toBe(getsBefore);
    // 画面の値はそのまま(戻さない)
    expect(await theme(t1)).toBe("dark");
    await expect(radio(t1, "暗い")).toBeChecked();
    await expect(t1.locator("main").getByRole("alert"), "エラーの表示にはしない").toHaveCount(0);

    // このあとの変更も、画面と クッキーだけ変わり、残さず・送らない
    await radio(t1, "明るい").check();
    expect(await theme(t1)).toBe("light");
    await t1.waitForTimeout(1200);
    expect(await pending(t1)).toBeNull();
    expect(puts.length).toBe(1);
    expect(gets.length).toBe(getsBefore);
    // 隠れた・ページを離れるときの keepalive の送信もしない
    await t1.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    await t1.waitForTimeout(800);
    expect(puts.length, "keepalive でも送らない").toBe(1);
    expect(await pending(t1)).toBeNull();
    await t1.close();
    await t2.close();
  });

  for (const status of [401, 403] as const) {
    test(`PUT が ${status} のとき: 残さない・もう送らない・読み直さない・値はそのまま`, async ({ page }) => {
      const { gets, puts } = await routePrefs(page, { put: () => ({ status, json: { error: "x" } }) });
      await page.goto("/settings");
      await hydrated(page);
      await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(800); // 開発サーバーの React のやり直しの GET(2 回目)が出そろうのを待つ。このあとの GET の数と比べるため
      const getsBefore = gets.length;
      await radio(page, "暗い").check();
      await expect(page.getByText(LOCAL_NOTE)).toBeVisible();
      await page.waitForTimeout(1500);
      expect(await pending(page)).toBeNull();
      expect(puts).toHaveLength(1);
      expect(gets.length).toBe(getsBefore);
      expect(await theme(page)).toBe("dark");
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      // もう一度変えても、送らず・残さない
      await radio(page, "明るい").check();
      await page.waitForTimeout(1200);
      expect(puts).toHaveLength(1);
      expect(await pending(page)).toBeNull();
      expect(await theme(page)).toBe("light");
    });
  }
});

test.describe("画面: 別のアカウントになった(409 owner_mismatch)ときは、残さず、GET で 1 回読み直し、もう送らない", () => {
  test("設定の画面: 読み直した設定(明暗)が出る。残さない。送った PUT は 1 つだけ", async ({ page }) => {
    const fetched = serverState({ theme: "light" }); // いまのログインの設定(読み直して出るもの)
    const { gets, puts } = await routePrefs(page, { get: fetched, put: () => ({ status: 409, json: { error: "x", code: "owner_mismatch" } }) });
    await page.goto("/settings");
    await hydrated(page);
    await expect(radio(page, "明るい")).toBeChecked(); // 最初の読み込み: アカウントの light
    await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(800); // 開発サーバーの React のやり直しの GET(2 回目)が出そろうのを待つ。このあとの GET の数と比べるため
    const getsBefore = gets.length;
    await radio(page, "暗い").check(); // 別のアカウントの画面から変えようとする
    await expect.poll(() => puts.length).toBe(1);
    await expect.poll(() => gets.length, { message: "GET で 1 回だけ読み直す" }).toBe(getsBefore + 1);
    // 読み直した設定が出る(暗いに変えた画面が、いまのアカウントの light に戻る)
    await expect(radio(page, "明るい")).toBeChecked();
    await expect.poll(() => theme(page)).toBe("light");
    await expect(page.getByText(LOCAL_NOTE)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await pending(page), "残さない").toBeNull();
    expect(puts, "もう送らない").toHaveLength(1);
    expect(gets.length, "読み直しは 1 回だけ").toBe(getsBefore + 1);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    // このあとの変更も、送らず・残さない(画面の値だけ変わる)
    await radio(page, "暗い").check();
    await page.waitForTimeout(1200);
    expect(await theme(page)).toBe("dark");
    expect(puts).toHaveLength(1);
    expect(await pending(page)).toBeNull();
    expect(gets.length).toBe(getsBefore + 1);
  });

  test("ホームの Visual: 読み直した見た目(パターン 6)が立体に出る。残さない。送った PUT は 1 つだけ", async ({ page }) => {
    test.setTimeout(240_000);
    const p6 = PATTERNS.find((p) => p.id === 6)!.look;
    const { gets, puts } = await routePrefs(page, { get: serverState({ look: { ...p6 } }), put: () => ({ status: 409, json: { error: "x", code: "owner_mismatch" } }) });
    await stubHome(page, overviewOf(manyUnits(2)));
    await openHome(page);
    await expect(stage(page)).toHaveAttribute("data-layout", "stage"); // 最初の読み込み: パターン 6
    const getsBefore = gets.length;
    await page.getByRole("button", { name: /^Visual/ }).click();
    const vpanel = page.locator("#visual-panel");
    await vpanel.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^7/ }).click();
    await expect(stage(page)).toHaveAttribute("data-layout", "row"); // 変えた(すぐ画面に出る)
    await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(1); // 800ms のあとに送る
    await expect.poll(() => gets.length, { timeout: 10_000 }).toBe(getsBefore + 1);
    await expect(stage(page)).toHaveAttribute("data-layout", "stage"); // 読み直した設定(パターン 6)に戻る
    await expect(vpanel.locator("span").filter({ hasText: /^(パターン \d|組み合わせ)/ })).toHaveText(/^パターン 6/);
    await page.waitForTimeout(1500);
    expect(await pending(page)).toBeNull();
    expect(puts).toHaveLength(1);
    expect(gets.length).toBe(getsBefore + 1);
    await expect(page.getByText("保存できませんでした")).toHaveCount(0);
    // もう送らない
    await vpanel.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^1/ }).click();
    await page.waitForTimeout(1800);
    expect(puts).toHaveLength(1);
    expect(await pending(page)).toBeNull();
  });

  for (const [label, reply] of [
    ["code のない 409(JSON)", { status: 409, json: { error: "x" } }],
    ["別の code の 409", { status: 409, json: { error: "x", code: "conflict" } }],
    ["JSON でない本文の 409", { status: 409, body: "conflict" }],
    ["本文のない 409", { status: 409, body: "" }],
  ] as const) {
    test(`${label}: 今までどおり「送れなかった」として残す(エラーを出す・読み直さない)`, async ({ page }) => {
      const { gets, puts } = await routePrefs(page, { put: () => reply });
      await page.goto("/settings");
      await hydrated(page);
      await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(800); // 開発サーバーの React のやり直しの GET(2 回目)が出そろうのを待つ。このあとの GET の数と比べるため
      const getsBefore = gets.length;
      await radio(page, "暗い").check();
      await expect(page.locator("main").getByRole("alert")).toHaveText("アカウントに保存できませんでした。このブラウザには覚えています。");
      expect(JSON.parse((await pending(page)) ?? "null"), "残す(指紋つき)").toEqual({ owner: localDevOwner(), patch: { theme: "dark" } });
      expect(await theme(page)).toBe("dark");
      expect(gets.length, "読み直さない").toBe(getsBefore);
      expect(puts).toHaveLength(1);
      expect((await getPrefs(page.request)).prefs.theme, "アカウントは変わっていない").toBeNull();
    });
  }
});

// ---------- 3. 残した変更の指紋 ----------

test.describe("残した変更(localStorage fourdb.prefs.pending)の指紋", () => {
  test("読み込みで、違うアカウントのもの・古い形(指紋なし)・指紋が null のものは送らずに捨てる(画面はアカウントの値)", async ({ page }) => {
    const { puts } = await routePrefs(page, { get: serverState({ theme: "light" }) });
    await page.goto("/settings");
    await hydrated(page);
    await expect.poll(() => theme(page)).toBe("light");
    const look = { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" };
    const cases: [string, string][] = [
      ["別のアカウントの指紋", pendingText({ theme: "dark" }, otherOwner())],
      ["別のアカウントの指紋・見た目も", pendingText({ theme: "dark", world: "plain", look }, otherOwner())],
      ["指紋が null", pendingText({ theme: "dark" }, null)],
      ["古い形(変更だけ)", JSON.stringify({ theme: "dark" })],
      ["古い形(見た目も)", JSON.stringify({ theme: "dark", look })],
    ];
    for (const [label, text] of cases) {
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PENDING, text]);
      await page.reload();
      await hydrated(page);
      await expect.poll(() => pending(page), { message: `${label}: 捨てる(localStorage から消える)` }).toBeNull();
      await page.waitForTimeout(600);
      expect(puts, `${label}: 送らない`).toEqual([]);
      expect(await theme(page), `${label}: 画面はアカウントの値`).toBe("light");
      await expect(radio(page, "明るい")).toBeChecked();
    }
  });

  test("同じアカウントのものは、アカウントの値より先に送る(指紋つきの PUT。送れたら消える)。本物のサーバーに入る", async ({ page }) => {
    const { gets, puts } = await routePrefs(page);
    await page.goto("/settings");
    await hydrated(page);
    await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(800); // 開発サーバーの React のやり直しの GET(2 回目)が出そろうのを待つ。このあとの GET の数と比べるため
    expect(puts).toEqual([]);
    const look = { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PENDING, pendingText({ theme: "dark", look })]);
    await page.reload();
    await hydrated(page);
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].body).toEqual({ theme: "dark", look });
    expect(puts[0].owner).toBe(localDevOwner());
    await expect.poll(() => pending(page)).toBeNull();
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme).toBe("dark");
    expect((await getPrefs(page.request)).prefs.look).toEqual(look);
    await expect(radio(page, "暗い")).toBeChecked();
    await page.waitForTimeout(600);
    expect(puts, "送ったのは 1 回だけ").toHaveLength(1);
  });

  test("アカウントに何も保存していなくて(saved: false)、クッキーの明暗もあるとき: 同じアカウントの残した変更が先(クッキーの移し替えより前)。違うアカウントのものなら、クッキーのほうを送る", async ({ browser, baseURL }) => {
    const run = async (ctx: BrowserContext, text: string) => {
      await ctx.addCookies([{ name: "fourdb_theme", value: "light", url: baseURL! }]);
      const page = await ctx.newPage();
      const { puts } = await routePrefs(page, { get: serverState({}, { saved: false }), put: () => ({ status: 200, json: serverState({ theme: "dark" }) }) });
      await page.goto("/settings");
      await hydrated(page);
      await page.waitForTimeout(800);
      puts.length = 0; // 最初の読み込みでの、クッキーの移し替えの PUT は数えない
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PENDING, text]);
      await page.reload();
      await hydrated(page);
      await page.waitForTimeout(1200);
      return puts;
    };
    const same = await browser.newContext({ baseURL, colorScheme: "light" });
    const putsSame = await run(same, pendingText({ theme: "dark" }));
    expect(putsSame.map((p) => p.body), "残した変更(dark)だけを、1 回").toEqual([{ theme: "dark" }]);
    expect(putsSame[0].owner).toBe(localDevOwner());
    await same.close();
    const other = await browser.newContext({ baseURL, colorScheme: "light" });
    const putsOther = await run(other, pendingText({ theme: "dark" }, otherOwner()));
    expect(putsOther.map((p) => p.body), "違うアカウントのものは捨て、クッキー(light)の明暗をアカウントへ移す").toEqual([{ theme: "light" }]);
    await other.close();
  });
});

// ---------- 4. ページを離れる・隠れるときの送信(keepalive)にも指紋が付く ----------

const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });

test.describe("ページを離れる・隠れるとき、送っていない変更の送信(keepalive)にも、いまのアカウントの指紋が付く", () => {
  test("設定の画面: 送れなかった変更が残っているとき、隠れた・離れたときの PUT にも指紋が付く(本物のサーバーが通す)", async ({ page }) => {
    // 1 回目の PUT は失敗させる(送っていない変更が残る)。2 回目からは本物のサーバーへ
    const { puts } = await routePrefs(page, { put: (n) => (n === 0 ? { status: 500, json: { error: "x" } } : "continue") });
    await page.goto("/settings");
    await hydrated(page);
    await radio(page, "暗い").check();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    expect(puts).toHaveLength(1);
    expect((await getPrefs(page.request)).prefs.theme, "まだアカウントに入っていない").toBeNull();
    await hide(page); // 隠れた・離れた: 送っていない分を keepalive で送る
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1].body).toEqual({ theme: "dark" });
    expect(puts[1].owner, "keepalive の PUT にも、画面のアカウントの指紋").toBe(localDevOwner());
    await expect.poll(async () => (await getPrefs(page.request)).prefs.theme, { message: "本物のサーバーが通した" }).toBe("dark");
    expect(await pending(page)).toBeNull();
  });

  test("ホームの Visual: 800ms のまとめを待たずに隠れたとき・別の画面へ移るとき、見た目の PUT に指紋が付き、アカウントに入る", async ({ page }) => {
    test.setTimeout(240_000);
    const { puts } = await routePrefs(page);
    await stubHome(page, overviewOf(manyUnits(2)));
    await openHome(page);
    await page.getByRole("button", { name: /^Visual/ }).click();
    const vpanel = page.locator("#visual-panel");
    const p7 = PATTERNS.find((p) => p.id === 7)!.look;
    // 画面の中で、押す → すぐ隠れる、を 1 つの処理でする(Playwright の操作の待ちや機械の混み具合で、まとめの 800ms が過ぎないように)。PUT を呼んだ時刻も画面の中で測る
    const lag = await page.evaluate(() => {
      const w = window as unknown as { __put?: number };
      const orig = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (init?.method === "PUT" && w.__put === undefined) w.__put = performance.now();
        return orig(input, init);
      };
      const btn = [...document.querySelectorAll('#visual-panel [role=group][aria-label="パターン"] button')].find((b) => /^7/.test(b.textContent?.trim() ?? "")) as HTMLButtonElement;
      const t0 = performance.now();
      btn.click();
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      return new Promise<number>((resolve) => setTimeout(() => resolve(w.__put === undefined ? -1 : w.__put - t0), 300));
    });
    expect(lag, "隠れたとき、まとめの 800ms を待たずに送った(画面の中で測った、押してから PUT を呼ぶまでの時間)").toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(500);
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].owner).toBe(localDevOwner());
    expect(puts[0].body).toEqual({ look: p7 });
    await expect.poll(async () => (await getPrefs(page.request)).prefs.look).toEqual(p7);

    // 実際に別の画面へ移る(離れる)ときも、送っていない見た目が、指紋つきで本物のサーバーに通る
    const owners: (string | undefined)[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && new URL(r.url()).pathname === "/api/4db/prefs") owners.push(r.headers()[OWNER_HEADER]);
    });
    const p4 = PATTERNS.find((p) => p.id === 4)!.look;
    await vpanel.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^4/ }).click();
    await page.goto("/settings"); // 800ms 経つ前に離れる
    await expect.poll(async () => (await getPrefs(page.request)).prefs.look, { timeout: 8000, message: "指紋つきの keepalive が通った(指紋がなければ 409 で入らない)" }).toEqual(p4);
    if (owners.length) expect(owners.every((o) => o === localDevOwner()), `離れるときの PUT の指紋: ${owners.join(",")}`).toBe(true);
  });
});

// ---------- 5. 止まったあと、同じアカウントで開き直しても、古い変更を送らない(L-1) ----------

test.describe("401・403・409 で止まったあと: この端末に残っていた変更も、止まる直前に書いた変更も、開き直しで送られない(L-1)", () => {
  const PC = "パソコンの設定に合わせる";
  const halts = [
    ["401", { status: 401, json: { error: "x" } }],
    ["403", { status: 403, json: { error: "x" } }],
    ["409 owner_mismatch", { status: 409, json: { error: "x", code: "owner_mismatch" } }],
  ] as const;

  for (const [label, reply] of halts) {
    test(`${label}: 1 回目の失敗(500)で残った変更に、続けて値を変えて 2 回目の PUT が ${label} で止まる → 残らない。同じアカウントで読み込み直しても送られず、アカウントの値(パソコンの設定に合わせる)になる`, async ({ page }) => {
      const { puts } = await routePrefs(page, { put: (n) => (n === 0 ? { status: 500, json: { error: "x" } } : reply) });
      await page.goto("/settings");
      await hydrated(page);
      await radio(page, "暗い").check();
      await expect(page.locator("main").getByRole("alert")).toBeVisible(); // 500: 送れなかった(この端末に残す)
      expect(JSON.parse((await pending(page)) ?? "null"), "1 回目の失敗で残る").toEqual({ owner: localDevOwner(), patch: { theme: "dark" } });
      await radio(page, "明るい").check(); // 失敗している間に変える: 書き込んでから送る(送る前に残す)
      await expect.poll(() => puts.length).toBe(2);
      await expect(page.getByText(LOCAL_NOTE)).toBeVisible(); // 止まった
      await expect.poll(() => pending(page), { message: "止まったら、この端末に残した変更も消える" }).toBeNull();
      await page.waitForTimeout(1200);
      expect(puts, "止まったあとは送らない").toHaveLength(2);
      expect(await pending(page)).toBeNull();

      // 同じアカウント(同じ指紋)で開き直す: 古い変更を送らない
      await page.reload();
      await hydrated(page);
      await page.waitForTimeout(1500);
      expect(puts, "開き直しても、古い変更を送らない").toHaveLength(2);
      expect(await pending(page)).toBeNull();
      await expect(radio(page, "暗い")).not.toBeChecked();
      await expect(radio(page, "明るい")).not.toBeChecked();
      await expect(page.getByRole("radio", { name: PC })).toBeChecked(); // アカウントの値
      expect((await getPrefs(page.request)).prefs.theme, "アカウントは変わっていない").toBeNull();
    });
  }

  test("複数のタブ: 1 つ目のタブが 500 で変更を残し、2 つ目のタブがログアウトして消し、1 つ目で値を変えると 401 → 残らない。同じアカウントで開き直しても送られない", async ({ context }) => {
    const t1 = await context.newPage();
    const { puts } = await routePrefs(t1, { put: (n) => (n === 0 ? { status: 500, json: { error: "x" } } : { status: 401, json: { error: "x" } }) });
    await t1.goto("/settings");
    await hydrated(t1);
    // 2 つ目のタブは、1 つ目が失敗する前に開いておく(あとで開くと、読み込みのとき、1 つ目が残した同じアカウントの変更を先に送ってしまう。それは決まりどおりの動き)
    const t2 = await context.newPage();
    await t2.goto("/settings");
    await hydrated(t2);
    await t2.waitForTimeout(800);
    await radio(t1, "暗い").check();
    await expect(t1.locator("main").getByRole("alert")).toBeVisible();
    expect(await pending(t1), "残っている").not.toBeNull();
    // 2 つ目のタブがログアウト: 送る直前に、この端末の送っていない変更を消す
    await t2.getByRole("banner").getByRole("button", { name: "ログアウト" }).click();
    await expect(t2).toHaveURL(/\/login$/);
    expect(await pending(t1), "ログアウトで消えた").toBeNull();
    // 1 つ目のタブで変える: 401(ログインが切れている)
    await radio(t1, "明るい").check();
    await expect.poll(() => puts.length).toBe(2);
    await expect(t1.getByText(LOCAL_NOTE)).toBeVisible();
    await expect.poll(() => pending(t1), { message: "401 のあとに、変更が残らない(L-1)" }).toBeNull();
    // 開き直し
    await t1.reload();
    await hydrated(t1);
    await t1.waitForTimeout(1500);
    expect(puts, "開き直しても送らない").toHaveLength(2);
    expect(await pending(t1)).toBeNull();
    await expect(t1.getByRole("radio", { name: PC })).toBeChecked();
    await t1.close();
    await t2.close();
  });
});
