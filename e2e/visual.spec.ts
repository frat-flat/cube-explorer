import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_LOOK } from "@/fourdb/core/prefs";
import { getPrefs, manyUnits, openHome, overviewOf, resetPrefs, stage, stubHome, unitOf, watch, type PrefsState } from "./support";

// ホームの Visual(見た目の欄)とアカウントへの保存。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/visual.spec.ts
// 見た目の保存は、実際の API(/api/4db/prefs)と手元のデータベースの表 principal_pref で確かめる。失敗・使えないときだけ、通信を差し替える(route)。
// 試験のたびに、アカウントの設定をもとに戻す(パソコンの設定に合わせる・無地・パターン 3)。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
// 3D(ソフトウェアの描画)は遅く、機械の混み具合で 3 倍ほど変わるので、1 つの試験に長めの時間をとる
test.describe.configure({ timeout: 240_000 });

const PENDING = "fourdb.prefs.pending";
const visualButton = (page: Page) => page.getByRole("button", { name: /^Visual/ });
const vpanel = (page: Page) => page.locator("#visual-panel");
const current = (page: Page) => vpanel(page).locator("span").filter({ hasText: /^(パターン \d|組み合わせ)/ });
const pattern = (page: Page, n: number) => vpanel(page).getByRole("group", { name: "パターン" }).getByRole("button", { name: new RegExp(`^${n}`) });
const part = (page: Page, group: string, name: string) => vpanel(page).getByRole("group", { name: group }).getByRole("button", { name, exact: true });
const pending = (page: Page) => page.evaluate((k) => localStorage.getItem(k), PENDING);

async function openVisual(page: Page) {
  await visualButton(page).click();
  await expect(visualButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(vpanel(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetPrefs(page.request);
  await stubHome(page, overviewOf(manyUnits(2)));
});
test.afterEach(async ({ page }) => {
  await resetPrefs(page.request);
});

test.describe("Visual の欄", () => {
  test("読み込んだときは閉じている。ボタンで開くと最初のパターンへフォーカス。✕・Escape・ボタンでもう一度、で閉じて、ボタンへ戻る", async ({ page }) => {
    await openHome(page);
    await expect(visualButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(visualButton(page)).toHaveAttribute("aria-controls", "visual-panel");
    await expect(vpanel(page)).toBeHidden();
    await expect(visualButton(page)).toContainText("見た目を変える");

    await openVisual(page);
    await expect(pattern(page, 1)).toBeFocused();
    await expect(vpanel(page).getByRole("heading", { name: /Visual/ })).toBeVisible();
    // ✕ で閉じる
    await vpanel(page).getByRole("button", { name: "閉じる" }).click();
    await expect(vpanel(page)).toBeHidden();
    await expect(visualButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(visualButton(page)).toBeFocused();
    // Escape で閉じる(フォーカスがパターンにあっても)
    await openVisual(page);
    await expect(pattern(page, 1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(vpanel(page)).toBeHidden();
    await expect(visualButton(page)).toBeFocused();
    // ボタンをもう一度押しても閉じる
    await openVisual(page);
    await visualButton(page).click();
    await expect(vpanel(page)).toBeHidden();
    // 欄は画面に収まる
    await openVisual(page);
    const b = (await vpanel(page).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  });

  test("パターン 8 つと部品(形・向き・台座・札・背景・並べ方)と明暗(2 択)がそろい、はじめはパターン 3。選ぶと aria-pressed と root の data-* が変わる", async ({ page }) => {
    const w = watch(page);
    await openHome(page);
    await openVisual(page);
    const patterns = vpanel(page).getByRole("group", { name: "パターン" }).getByRole("button");
    await expect(patterns).toHaveCount(8);
    for (const [group, labels] of [
      ["Box の形", ["ガラス", "つや消し", "帯つき", "線と点"]],
      ["向き", ["角を下", "面を下"]],
      ["台座", ["くぼみの台", "2 段の台", "光の輪", "石の台", "床の円盤"]],
      ["札", ["台の下", "台の正面", "Box の上"]],
      ["背景", ["ロゴの線", "静か", "床の格子"]],
      ["並べ方", ["1 列", "弧", "ひな壇"]],
      ["明暗", ["明るい", "暗い"]],
    ] as const) {
      const g = vpanel(page).getByRole("group", { name: group, exact: true });
      await expect(g.getByRole("button"), group).toHaveText([...labels]);
    }
    // 試作の「単位 2/6」は入れない
    await expect(vpanel(page).getByText(/単位 ?[0-9]/)).toHaveCount(0);

    // はじめ: パターン 3「ロゴの宇宙」(帯つき・面を下・光の輪・Box の上・ロゴの線・弧)
    await expect(current(page)).toHaveText("パターン 3「ロゴの宇宙」");
    for (let n = 1; n <= 8; n++) await expect(pattern(page, n), `パターン ${n}`).toHaveAttribute("aria-pressed", n === 3 ? "true" : "false");
    for (const [group, name] of [["Box の形", "帯つき"], ["向き", "面を下"], ["台座", "光の輪"], ["札", "Box の上"], ["背景", "ロゴの線"], ["並べ方", "弧"]] as const) {
      await expect(part(page, group, name), `${group}: ${name}`).toHaveAttribute("aria-pressed", "true");
    }
    await expect(stage(page)).toHaveAttribute("data-bg", "logo");
    await expect(stage(page)).toHaveAttribute("data-base", "ring");
    await expect(stage(page)).toHaveAttribute("data-layout", "arc");
    await expect(stage(page)).toHaveAttribute("data-label", "float");

    // パターン 7(ガラス・角を下・くぼみの台・台の下・ロゴの線・1 列): 6 つの部品がまとめて変わる
    await pattern(page, 7).click();
    await expect(pattern(page, 7)).toHaveAttribute("aria-pressed", "true");
    await expect(pattern(page, 3)).toHaveAttribute("aria-pressed", "false");
    await expect(current(page)).toHaveText("パターン 7「くぼみの台」");
    for (const [group, name] of [["Box の形", "ガラス"], ["向き", "角を下"], ["台座", "くぼみの台"], ["札", "台の下"], ["背景", "ロゴの線"], ["並べ方", "1 列"]] as const) {
      await expect(part(page, group, name), `${group}: ${name}`).toHaveAttribute("aria-pressed", "true");
    }
    await expect(stage(page)).toHaveAttribute("data-base", "dish");
    await expect(stage(page)).toHaveAttribute("data-layout", "row");
    await expect(stage(page)).toHaveAttribute("data-label", "below");
    // パターン 4(線と点・面を下・床の円盤・台の下・床の格子・1 列)
    await pattern(page, 4).click();
    await expect(stage(page)).toHaveAttribute("data-bg", "grid");
    await expect(stage(page)).toHaveAttribute("data-base", "disc");
    await expect(stage(page)).toHaveAttribute("data-layout", "row");
    await expect(stage(page)).toHaveAttribute("data-label", "below");
    // 立体は作り直しても 1 つの canvas・3d のまま(壊れない)
    await expect(stage(page)).toHaveAttribute("data-mode", "3d");
    await expect(stage(page).locator("canvas")).toHaveCount(1);
    // 8 つ全部を順に押しても、コンソールにエラー・警告が出ない(THREE の警告を含む)
    for (let n = 1; n <= 8; n++) {
      await pattern(page, n).click();
      await expect(pattern(page, n)).toHaveAttribute("aria-pressed", "true");
    }
    await page.waitForTimeout(500);
    expect(w.problems).toEqual([]);
  });

  test("部品を 1 つ変えるとパターンに当たらず「組み合わせ」。パターンを押すと戻る", async ({ page }) => {
    await openHome(page);
    await openVisual(page);
    await part(page, "Box の形", "つや消し").click();
    await expect(part(page, "Box の形", "つや消し")).toHaveAttribute("aria-pressed", "true");
    await expect(part(page, "Box の形", "帯つき")).toHaveAttribute("aria-pressed", "false");
    await expect(current(page)).toHaveText("組み合わせ");
    for (let n = 1; n <= 8; n++) await expect(pattern(page, n), `パターン ${n}`).toHaveAttribute("aria-pressed", "false");
    // 残りの 5 つの部品は変わらない
    await expect(stage(page)).toHaveAttribute("data-base", "ring");
    await part(page, "並べ方", "ひな壇").click();
    await expect(stage(page)).toHaveAttribute("data-layout", "stage");
    await expect(current(page)).toHaveText("組み合わせ");
    // 戻す: 部品でパターン 3 の形に戻せば、パターン 3(当たる組み合わせはパターンの名前になる)
    await part(page, "Box の形", "帯つき").click();
    await part(page, "並べ方", "弧").click();
    await expect(current(page)).toHaveText("パターン 3「ロゴの宇宙」");
    await part(page, "向き", "角を下").click();
    await expect(current(page)).toHaveText("組み合わせ");
    await pattern(page, 3).click();
    await expect(current(page)).toHaveText("パターン 3「ロゴの宇宙」");
    await expect(part(page, "向き", "面を下")).toHaveAttribute("aria-pressed", "true");
  });

  test("札の注記(正面がない): 光の輪・床の円盤には正面がないので、「台の正面」を選んでも台の下に出し、台座の名前つきで理由を出す。正面のある台座(くぼみの台・2 段の台・石の台)では台の正面に出て注記は出ない。台の下に戻すと消える", async ({ page }) => {
    await openHome(page); // 単位 2 つ・1280×800
    await openVisual(page);
    const note = vpanel(page).locator("p[role=status]");
    await expect(note).toHaveText("");
    await part(page, "札", "台の正面").click();
    for (const [base, front] of [["くぼみの台", true], ["2 段の台", true], ["光の輪", false], ["石の台", true], ["床の円盤", false]] as const) {
      await part(page, "台座", base).click();
      await expect(stage(page), base).toHaveAttribute("data-label", front ? "front" : "below");
      await expect(note, base).toHaveText(front ? "" : `${base}には正面がないため、札は台の下に出しています`);
    }
    // 台の下に戻す: 注記が消える
    await part(page, "札", "台の下").click();
    await expect(note).toHaveText("");
    await expect(stage(page)).toHaveAttribute("data-label", "below");
  });

  test("札の注記(小さすぎる): 単位が多く正面の文字が小さくなるときは、正面のある台座でも台の下に出し、その理由を出す", async ({ page }) => {
    await stubHome(page, overviewOf(manyUnits(6)));
    await openHome(page);
    await openVisual(page);
    const note = vpanel(page).locator("p[role=status]");
    await part(page, "台座", "くぼみの台").click(); // 正面のある台座にしてから(はじめの光の輪には正面がない)
    await part(page, "札", "台の正面").click();
    await expect(stage(page)).toHaveAttribute("data-label", "below");
    await expect(note).toHaveText("正面の文字が小さすぎるため、札は台の下に出しています");
    // 正面のない台座は、正面がない理由が先
    await part(page, "台座", "光の輪").click();
    await expect(note).toHaveText("光の輪には正面がないため、札は台の下に出しています");
    // 台の下に戻すと消える
    await part(page, "札", "台の下").click();
    await expect(note).toHaveText("");
  });

  test("明暗(Visual の中): 押すとすぐ <html data-theme> とクッキーが変わり、押した状態(aria-pressed)になる。パソコンの設定に合わせているときは、いまの見た目の方が押された形", async ({ browser, baseURL, request }) => {
    for (const os of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, colorScheme: os });
      const page = await ctx.newPage();
      await stubHome(page, overviewOf(manyUnits(2)));
      await openHome(page);
      await openVisual(page);
      // 何も選んでいない(パソコンの設定に合わせる): OS と同じ側が押された形
      await expect(part(page, "明暗", os === "light" ? "明るい" : "暗い")).toHaveAttribute("aria-pressed", "true");
      await expect(part(page, "明暗", os === "light" ? "暗い" : "明るい")).toHaveAttribute("aria-pressed", "false");
      // OS と逆を選ぶ
      const target = os === "light" ? "dark" : "light";
      await part(page, "明暗", target === "dark" ? "暗い" : "明るい").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", target);
      expect((await ctx.cookies()).find((c) => c.name === "fourdb_theme")?.value).toBe(target);
      await expect(part(page, "明暗", target === "dark" ? "暗い" : "明るい")).toHaveAttribute("aria-pressed", "true");
      await ctx.close();
      await resetPrefs(request);
    }
  });
});

test.describe("見た目の保存(アカウント)", () => {
  test("5 回つづけて変えても PUT は 2 回以下(800ms まとめて 1 回)。送った中身は最後の見た目。「アカウントに保存しました」", async ({ page }) => {
    const w = watch(page);
    await openHome(page);
    await openVisual(page);
    w.puts.length = 0;
    // 5 回つづけて変える(画面の中で 100ms おきに押す。Playwright の 1 回ごとの操作は 1 秒近くかかり、800ms を超えてしまうので)
    await page.evaluate(async () => {
      const click = (group: string, name: string) => {
        const g = document.querySelector(`#visual-panel [role=group][aria-labelledby="${group}"]`)!;
        [...g.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!.click();
      };
      for (const [g, n] of [["vis-shape", "つや消し"], ["vis-tilt", "角を下"], ["vis-base", "2 段の台"], ["vis-bg", "静か"], ["vis-layout", "1 列"]]) {
        click(g, n);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    await expect(page.getByText("アカウントに保存しました")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(w.puts.length, `PUT の回数: ${w.puts.map((p) => p.body).join(" / ")}`).toBeLessThanOrEqual(2);
    expect(w.puts.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(w.puts[w.puts.length - 1].body);
    expect(last).toEqual({ look: { ...DEFAULT_LOOK, shape: "solid", tilt: "vertex", base: "plinth", bg: "quiet", layout: "row" } });
    const saved = await getPrefs(page.request);
    expect(saved.saved).toBe(true);
    expect(saved.prefs.look).toEqual(last.look);
    expect(await pending(page), "送れたので、この端末に残る分はない").toBeNull();
  });

  test("明暗はすぐ送る(まとめない)。クッキーが先、PUT はそのあと。本文は theme だけ", async ({ page }) => {
    const w = watch(page);
    await openHome(page);
    await openVisual(page);
    w.puts.length = 0;
    // 画面の中で時間を測る(Playwright の操作の待ちや機械の混み具合に左右されないように)。押した瞬間と、PUT を呼んだ瞬間
    await page.evaluate(() => {
      const w = window as unknown as { __put?: number; __t0?: number };
      const orig = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (init?.method === "PUT" && w.__put === undefined) w.__put = performance.now();
        return orig(input, init);
      };
      const btn = [...document.querySelectorAll('#visual-panel [role=group][aria-labelledby="vis-theme"] button')].find((b) => b.textContent?.trim() === "暗い") as HTMLButtonElement;
      w.__t0 = performance.now();
      btn.click();
    });
    await expect.poll(() => w.puts.length, { timeout: 30_000 }).toBe(1);
    const lag = await page.evaluate(() => {
      const w = window as unknown as { __put?: number; __t0?: number };
      return w.__put === undefined || w.__t0 === undefined ? -1 : w.__put - w.__t0;
    });
    expect(lag, "まとめずにすぐ送る(800ms のまとめを待たない。画面の中で測った時間)").toBeGreaterThanOrEqual(0);
    expect(lag, "押してから PUT を呼ぶまで").toBeLessThan(500);
    expect(JSON.parse(w.puts[0].body)).toEqual({ theme: "dark" });
    expect((await getPrefs(page.request)).prefs.theme).toBe("dark");
  });

  test("読み込み直しても、別のブラウザ(クッキーなし)でも、同じ見た目と明暗になる", async ({ page, browser, baseURL }) => {
    await openHome(page);
    await openVisual(page);
    await pattern(page, 7).click(); // はじめのパターン 3 とは別のものを選んで覚えさせる
    await part(page, "明暗", "暗い").click();
    await expect(page.getByText("アカウントに保存しました")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    // 読み込み直し
    await page.reload();
    await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect(stage(page)).toHaveAttribute("data-base", "dish");
    await expect(stage(page)).toHaveAttribute("data-layout", "row");
    await expect(stage(page)).toHaveAttribute("data-label", "below");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await openVisual(page);
    await expect(current(page)).toHaveText("パターン 7「くぼみの台」");
    await expect(part(page, "明暗", "暗い")).toHaveAttribute("aria-pressed", "true");

    // 2 つ目のブラウザ(クッキー・localStorage なし。パソコンの設定は明るい)
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    const second = await ctx.newPage();
    await stubHome(second, overviewOf(manyUnits(2)));
    await openHome(second);
    await expect(stage(second)).toHaveAttribute("data-base", "dish");
    await expect(stage(second)).toHaveAttribute("data-layout", "row");
    await expect(stage(second)).toHaveAttribute("data-label", "below");
    await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await ctx.cookies()).find((c) => c.name === "fourdb_theme")?.value, "アカウントに合わせてクッキーも書く").toBe("dark");
    await visualButton(second).click();
    await expect(current(second)).toHaveText("パターン 7「くぼみの台」");
    // 別のブラウザで変えたものも、元のブラウザに反映される(読み込み直したとき)
    await pattern(second, 6).click();
    await expect(second.getByText("アカウントに保存しました")).toBeVisible({ timeout: 60_000 });
    await ctx.close();
    await page.reload();
    await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect(stage(page)).toHaveAttribute("data-base", "plinth");
    await expect(stage(page)).toHaveAttribute("data-layout", "stage");
  });

  test("送る要求は同時に 1 つ。送っている間に変えたら、終わってから最新を送る(古い見た目で上書きしない)", async ({ page }) => {
    let inFlight = 0;
    let maxInFlight = 0;
    const bodies: string[] = [];
    await page.route("**/api/4db/prefs", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      bodies.push(route.request().postData() ?? "");
      await new Promise((r) => setTimeout(r, 1500)); // ゆっくり返す
      await route.continue();
      inFlight--;
    });
    await openHome(page);
    await openVisual(page);
    await part(page, "並べ方", "1 列").click();
    await expect.poll(() => bodies.length, { timeout: 5000 }).toBe(1); // 800ms のあと 1 つ目が飛ぶ(返事は 1.5 秒後)
    await part(page, "背景", "静か").click(); // 送っている間に変える
    await page.waitForTimeout(1200); // 800ms 過ぎても、2 つ目はまだ飛ばない(1 つ目が終わっていない)
    expect(maxInFlight).toBe(1);
    await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(2);
    expect(maxInFlight, "同時に飛ぶ要求は 1 つ").toBe(1);
    await expect(page.getByText("アカウントに保存しました")).toBeVisible({ timeout: 10_000 });
    expect(JSON.parse(bodies[1]).look).toMatchObject({ layout: "row", bg: "quiet" });
    expect((await getPrefs(page.request)).prefs.look).toMatchObject({ layout: "row", bg: "quiet" });
  });

  test("ページを離れるとき、送っていない見た目は keepalive で送る(800ms を待たずに他の画面へ移っても覚える)", async ({ page }) => {
    await openHome(page);
    await openVisual(page);
    await part(page, "並べ方", "ひな壇").click();
    await page.goto("/settings"); // 800ms 経つ前に離れる
    await expect.poll(async () => (await getPrefs(page.request)).prefs.look.layout, { timeout: 5000 }).toBe("stage");
  });

  test("PUT が失敗したとき: 見た目は戻さず、「保存できませんでした」と「もう一度試す」。この端末に残し、直ったら試し直して「アカウントに保存しました」", async ({ page }) => {
    let fail = true;
    await page.route("**/api/4db/prefs", async (route) => {
      if (route.request().method() === "PUT" && fail) return route.fulfill({ status: 500, json: { error: "処理できませんでした" } });
      return route.continue();
    });
    await openHome(page);
    await openVisual(page);
    await pattern(page, 7).click();
    await expect(page.getByText("保存できませんでした。もう一度試してください")).toBeVisible({ timeout: 10_000 });
    const retry = vpanel(page).getByRole("button", { name: "もう一度試す" });
    await expect(retry).toBeVisible();
    // 見た目は戻さない
    await expect(pattern(page, 7)).toHaveAttribute("aria-pressed", "true");
    await expect(stage(page)).toHaveAttribute("data-layout", "row");
    // この端末に残してある
    const stored = JSON.parse((await pending(page)) ?? "null");
    expect(stored?.look).toMatchObject({ shape: "glass", base: "dish", layout: "row" });
    // アカウントはまだ元のまま
    expect((await getPrefs(page.request)).prefs.look.layout).toBe(DEFAULT_LOOK.layout);
    // 直ったあとで試し直す
    fail = false;
    await retry.click();
    await expect(page.getByText("アカウントに保存しました")).toBeVisible({ timeout: 10_000 });
    await expect(retry).toHaveCount(0);
    expect(await pending(page)).toBeNull();
    expect((await getPrefs(page.request)).prefs.look.layout).toBe("row");
  });

  test("通信そのものが切れたとき(接続エラー)も同じ: 失敗の文と「もう一度試す」。見た目は戻らない", async ({ page }) => {
    await page.route("**/api/4db/prefs", (route) => (route.request().method() === "PUT" ? route.abort("failed") : route.continue()));
    await openHome(page);
    await openVisual(page);
    await part(page, "並べ方", "ひな壇").click();
    await expect(page.getByText("保存できませんでした。もう一度試してください")).toBeVisible({ timeout: 10_000 });
    await expect(vpanel(page).getByRole("button", { name: "もう一度試す" })).toBeVisible();
    await expect(stage(page)).toHaveAttribute("data-layout", "stage");
    // 失敗のあとで読み込み直すと、この端末に残した変更が先に送られる(次の読み込みで先に送る)
    await page.unroute("**/api/4db/prefs");
    await page.reload();
    await expect.poll(async () => (await getPrefs(page.request)).prefs.look.layout, { timeout: 10_000 }).toBe("stage");
    await expect.poll(() => pending(page), { timeout: 10_000 }).toBeNull();
  });

  test("アカウントへ保存できないとき(available: false): PUT は送らず「いまはこのパソコンにだけ覚えます」。読み込み直してもこのパソコンでは同じ見た目", async ({ page }) => {
    const off: PrefsState = { available: false, saved: false, prefs: { theme: null, world: "plain", look: { ...DEFAULT_LOOK } } };
    const puts: string[] = [];
    await page.route("**/api/4db/prefs", (route) => {
      if (route.request().method() === "PUT") {
        puts.push(route.request().postData() ?? "");
        return route.fulfill({ status: 503, json: { error: "x", code: "prefs_unavailable" } });
      }
      return route.fulfill({ json: off });
    });
    await openHome(page);
    await openVisual(page);
    await expect(page.getByText("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)")).toBeVisible();
    await pattern(page, 7).click();
    await part(page, "明暗", "暗い").click();
    await page.waitForTimeout(1800);
    expect(puts, "送らない").toEqual([]);
    await expect(page.getByText("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)")).toBeVisible();
    await expect(page.getByText("保存できませんでした")).toHaveCount(0);
    expect(JSON.parse((await pending(page)) ?? "null")).toMatchObject({ theme: "dark", look: { layout: "row" } });
    await page.reload();
    await expect(stage(page)).toHaveAttribute("data-layout", "row");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(puts, "読み込み直しても送らない").toEqual([]);
  });

  test("GET は使えるのに PUT が 503 prefs_unavailable のとき: 「このパソコンにだけ」に切り替わり、以後は送らない(エラーにしない)", async ({ page }) => {
    const puts: string[] = [];
    await page.route("**/api/4db/prefs", (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      puts.push(route.request().postData() ?? "");
      return route.fulfill({ status: 503, json: { error: "x", code: "prefs_unavailable" } });
    });
    await openHome(page);
    await openVisual(page);
    await part(page, "並べ方", "1 列").click();
    await expect(page.getByText("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)")).toBeVisible({ timeout: 10_000 });
    await part(page, "並べ方", "ひな壇").click();
    await page.waitForTimeout(1800);
    expect(puts.length, "最初の 1 回だけ試して、あとは送らない").toBe(1);
    await expect(page.getByText("保存できませんでした")).toHaveCount(0);
  });

  test("別のサイトからの書き込みは断る(PUT は同じサイトだけ)・不正な本文は 400・4KB を超える本文は 400。GET は読める", async ({ page }) => {
    const req = page.request;
    const look = { ...DEFAULT_LOOK };
    expect((await req.put("/api/4db/prefs", { data: { theme: "dark" }, headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
    expect((await req.put("/api/4db/prefs", { data: { theme: "dark" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await getPrefs(req)).prefs.theme, "断った書き込みは効いていない").toBeNull();
    // 形の違うもの: 知らないキー・知らない値・欠けた部品・__proto__・constructor・配列・空
    const bads: unknown[] = [
      {}, [], "x", null, { unknown: 1 }, { theme: "blue" }, { theme: 1 }, { world: "modern" }, { look: { ...look, shape: "cube" } },
      { look: { shape: "glass" } }, { look: { ...look, extra: 1 } }, { look: [] }, { look: null }, { theme: "dark", extra: 1 },
    ];
    for (const b of bads) expect((await req.put("/api/4db/prefs", { data: b as never })).status(), JSON.stringify(b)).toBe(400);
    for (const raw of ['{"__proto__":{"theme":"dark"}}', '{"constructor":{"x":1}}', `{"look":{"__proto__":{"shape":"glass"},"shape":"glass","tilt":"vertex","base":"dish","label":"below","bg":"logo","layout":"row"}}`, '{"theme":"dark",']) {
      const res = await req.put("/api/4db/prefs", { data: raw, headers: { "content-type": "application/json" } });
      expect(res.status(), raw).toBe(400);
    }
    // 4KB を超える本文
    const big = await req.put("/api/4db/prefs", { data: `{"theme":"dark"}${" ".repeat(5000)}`, headers: { "content-type": "application/json" } }); // 中身は正しい。大きさだけが違う
    expect(big.status()).toBe(400);
    expect((await getPrefs(req)).prefs, "不正な書き込みは何も変えない").toEqual({ theme: null, world: "plain", look });
    // 正しい書き込みは返り値が GET と同じ形。送った欄だけ変わる
    const ok = await req.put("/api/4db/prefs", { data: { theme: "light" } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ available: true, saved: true, prefs: { theme: "light", world: "plain", look } });
  });
});

test("Visual を開いて 1280×800 でも 1024×700 でも、欄とボタンが画面の中に収まる(右の欄と同時に開いても)", async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 700 }]) {
    await page.setViewportSize(size);
    await stubHome(page, overviewOf([unitOf("店舗", 3), unitOf("法人", 2)]));
    await openHome(page);
    await page.locator('ul[aria-label="単位ごとの Box"] > li > button').first().click();
    await openVisual(page);
    await page.waitForTimeout(1500);
    for (const el of [vpanel(page), visualButton(page), page.locator("#box-panel")]) {
      const b = (await el.boundingBox())!;
      expect(b.x, `${size.width}: 左`).toBeGreaterThanOrEqual(-1);
      expect(b.y, `${size.width}: 上`).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width, `${size.width}: 右`).toBeLessThanOrEqual(size.width + 1);
      expect(b.y + b.height, `${size.width}: 下`).toBeLessThanOrEqual(size.height + 1);
    }
    const [v, p] = [(await vpanel(page).boundingBox())!, (await page.locator("#box-panel").boundingBox())!];
    expect(v.x + v.width <= p.x + 1 || p.x + p.width <= v.x + 1, "Visual の欄と右の欄は重ならない(並ぶ)").toBe(true);
    await page.goto("about:blank");
  }
});
