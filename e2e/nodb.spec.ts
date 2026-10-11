import { expect, test } from "@playwright/test";
import { hydrated, openMenu, watch } from "./support";

// データベースがない開発サーバー(FOURDB_DATABASE_URL が空)のとき、枠は「Task の件数」と「アカウントの設定」を読みに行かない(P2b の 6・8 章)。
// 起動と流し方(E2E_NO_DB=1 のときだけ動く。playwright が npm run dev を 3000 番で起動する。データベース・ログインの設定は空にする):
//   E2E_NO_DB=1 NEON_AUTH_BASE_URL= NEON_AUTH_COOKIE_SECRET= FOURDB_DATABASE_URL= npx playwright test e2e/nodb.spec.ts
test.skip(process.env.E2E_NO_DB !== "1", "E2E_NO_DB=1 のときだけ(データベースのない開発サーバー)");
test.use({ baseURL: "http://localhost:3000" });
test.describe.configure({ timeout: 120_000 }); // 開発サーバーが画面を初めて作る時間がかかる

const PREFS = "/api/4db/prefs";
const COUNT = "/api/4db/tasks/count";

test("データベースがないとき: 設定・Task・履歴・ホームを開いても、/api/4db/tasks/count と /api/4db/prefs を読まない。明暗はクッキーだけで変わる", async ({ page }) => {
  const w = watch(page);
  for (const path of ["/settings", "/tasks", "/history", "/"]) {
    await page.goto(path);
    await hydrated(page);
    await page.waitForTimeout(800);
  }
  await page.goto("/settings");
  await hydrated(page);
  await page.getByRole("radio", { name: "暗い", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await page.context().cookies()).find((c) => c.name === "fourdb_theme")?.value).toBe("dark");
  // 見た目を変えても、画面を移っても、メニューを開けても、通信しない
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("navigation", { name: "画面" }).getByRole("link", { name: /履歴/ }).click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  expect(w.apis.filter((a) => a.endsWith(PREFS)), "prefs への通信").toEqual([]);
  expect(w.apis.filter((a) => a.endsWith(COUNT)), "tasks/count への通信").toEqual([]);
  expect(w.puts).toEqual([]);
  // メニューに件数の印はない。設定には「このパソコンにだけ」の文
  await page.goto("/settings");
  await hydrated(page);
  await openMenu(page); // 前の操作でメニューを開いた覚え(クッキー)が残っていれば、もう開いている
  await expect(page.locator(".nvbadge")).toHaveCount(0);
  await expect(page.getByText("いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)")).toBeVisible();
  // 画面の中身が読む API(Task など)は、データベースがなければ答えられず、画面はエラーを出す(枠は壊れない)
  await page.goto("/tasks");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
});
