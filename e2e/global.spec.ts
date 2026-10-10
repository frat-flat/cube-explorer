import { expect, test } from "@playwright/test";
import { externalHosts, hydrated, resetPrefs, stage, watch } from "./support";

// 全画面(ホーム・Task・履歴・設定・取り込み・Table)の、見た目(暗い/明るい)・コンソール・外への通信。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/global.spec.ts
// コンソールの error と warning を数える(THREE の警告を含む)。ヘッドレスの SwiftShader が文脈ごとに出す Chromium 自身の通知(GL Driver Message)は、
// WebGL の素の canvas だけでも出るため数えない(e2e/support.ts の ENV_NOISE)。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 180_000 });

const ROUTES = ["/", "/tasks", "/history", "/settings", "/migrate", "/table"];

for (const theme of ["light", "dark"] as const) {
  test(`見た目「${theme === "light" ? "明るい" : "暗い"}」: 全画面が崩れない(横にはみ出さない)。コンソールに error・warning がない。外への通信がない`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await resetPrefs(ctx.request);
    // アカウントの明暗を選んだものにする(アカウントに保存してある値が、クッキーより優先される)
    expect((await ctx.request.put("/api/4db/prefs", { data: { theme } })).ok()).toBe(true);
    await ctx.addCookies([{ name: "fourdb_theme", value: theme, url: baseURL! }]);
    const page = await ctx.newPage();
    const w = watch(page);
    for (const path of ROUTES) {
      await page.goto(path);
      await hydrated(page);
      if (path === "/") {
        // データがあれば立体(最初のフレームまで)、なければ空の案内
        await expect(stage(page)).toHaveAttribute("data-mode", /^(3d|empty)$/, { timeout: 60_000 });
        if ((await stage(page).getAttribute("data-mode")) === "3d") await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
      } else {
        await page.waitForLoadState("networkidle");
      }
      await page.waitForTimeout(500);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const overflow = await page.evaluate(() => {
        const c = document.querySelector(".content")!;
        return { x: c.scrollWidth - c.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(overflow, path).toEqual({ x: 0, page: 0 });
    }
    expect(externalHosts(w, baseURL!), "外への通信").toEqual([]);
    expect(w.problems, "コンソールの error・warning").toEqual([]);
    await resetPrefs(ctx.request);
    await ctx.close();
  });
}

test("ホームの画面を開いたまま、右の欄・Visual・明暗の切り替え・メニューの開け閉めをしても、コンソールにエラー・警告が出ない", async ({ page, baseURL }) => {
  await resetPrefs(page.request);
  const w = watch(page);
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-mode", /^(3d|empty)$/, { timeout: 60_000 });
  if ((await stage(page).getAttribute("data-mode")) === "3d") {
    await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await page.locator('ul[aria-label="単位ごとの Box"] > li > button').first().click();
    await page.getByRole("button", { name: /^Visual/ }).click();
    await page.getByRole("group", { name: "明暗", exact: true }).getByRole("button", { name: "暗い" }).click();
    await page.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^2/ }).click();
    await page.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^4/ }).click();
    await page.getByRole("group", { name: "パターン" }).getByRole("button", { name: /^7/ }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("button", { name: "メニューを閉じる" }).click();
  await page.reload();
  await page.waitForTimeout(1500);
  expect(externalHosts(w, baseURL!)).toEqual([]);
  expect(w.problems, "コンソールの error・warning").toEqual([]);
  await resetPrefs(page.request);
});
