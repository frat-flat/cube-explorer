import { expect, test } from "@playwright/test";

// 入口(/)で「軸の辞書と箱」のダッシュボードが開き、メニューで画面を切り替えられる
test("入口でダッシュボードが開き、画面を切り替えられる", async ({ page }) => {
  // three.js は CDN ではなく手元のものを使う(ネットにつながらない所でも動くように)
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.goto("/");
  await expect(page).toHaveTitle("軸の辞書と箱");
  await expect(page.locator("#crumb")).toHaveText("ホーム");
  await page.locator('.nv[data-go="import"]').click();
  await expect(page.locator("#crumb")).toHaveText("シートを入れる");
  await expect(page.locator("#bookRead")).toBeVisible();
});
