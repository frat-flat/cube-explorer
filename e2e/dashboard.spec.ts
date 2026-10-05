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
  await expect.poll(() => puts.length).toBe(1);
  // うまくいっているときは右上に何も出さない
  await expect(page.locator("#cloud")).toBeHidden();
  // Supabase 側の中身を書き換えて開き直すと、そちらが出る
  (stored as { axes: { name: string }[] }).axes[0].name = "雲の軸";
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.locator('.nv[data-go="dict"]').click();
  await expect(page.locator('.view[data-view="dict"]')).toContainText("雲の軸");
});

// 貼り付けたシートの行から、名前に使う列と単位を選んで箱を作る
test("シートの行から箱を作る", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("顧客一覧");
  await page.locator("#newData").fill("顧客番号,法人名,代表者名,電話\n0001,法人C,山田,03-1\n0002,法人D,佐藤,03-2\n0002,法人D,佐藤,03-2");
  await page.locator("#readUnits").click();
  await expect(page.locator("#unitSec")).toBeVisible();
  await page.locator('[data-ncol="1"]').check();
  await page.locator('[data-ncol="2"]').check();
  await expect(page.locator("#uPreview")).toContainText("0001 法人C 山田");
  await expect(page.locator("#uMake")).toBeDisabled();
  await page.locator("#uUnit").fill("お客様");
  await page.locator("#uMake").click();
  await expect(page.locator("#unitSec")).toBeHidden();
  await page.locator('.nv[data-go="home"]').click();
  await expect(page.locator("#tree")).toContainText("0001 法人C 山田");
  await expect(page.locator("#tree")).toContainText("お客様単位・箱3");
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}").boxes.filter((b: { levelName?: string }) => b.levelName === "お客様").length);
  expect(n).toBe(2);
  expect(errors).toEqual([]);
});
