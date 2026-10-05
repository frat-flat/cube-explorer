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

// Supabase に保存があればそれで開き、変えたら Supabase にも送る(API はここで差し替える)
test("Supabase の保存から開き、変えたら送り返す", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const puts: { state: { axes: { name: string }[] } }[] = [];
  let stored: unknown = null;
  await page.route("**/api/workspace", async (r) => {
    if (r.request().method() === "PUT") {
      const body = r.request().postDataJSON();
      puts.push(body);
      stored = body.state;
      return r.fulfill({ json: { updatedAt: "t" } });
    }
    return r.fulfill({ json: { configured: true, state: stored, updatedAt: null } });
  });
  // 1回目: Supabase は空なので、いまの中身(見本)を送る
  await page.goto("/");
  await expect(page.locator("#cloud")).toHaveText("Supabase に保存済み");
  expect(puts.length).toBe(1);
  // Supabase 側の中身を書き換えて開き直すと、そちらが出る
  (stored as { axes: { name: string }[] }).axes[0].name = "雲の軸";
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.locator("#cloud")).toHaveText("Supabase から読み込みました");
  await page.locator('.nv[data-go="dict"]').click();
  await expect(page.locator('.view[data-view="dict"]')).toContainText("雲の軸");
});
