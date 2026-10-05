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
  await expect(page.locator("#tree")).toContainText("お客様単位・箱6");
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}").boxes.filter((b: { levelName?: string }) => b.levelName === "お客様").length);
  expect(n).toBe(2);
  expect(errors).toEqual([]);
});

// 立体は World の画面だけに出し、設定で選んだ世界(Blender で作った世界)をまわりに映す
test("World で設定した世界の中に立体を並べる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.route("**/GLTFLoader.js", (r) => r.fulfill({ path: "node_modules/three/examples/js/loaders/GLTFLoader.js", contentType: "text/javascript" }));
  await page.route("**/meshopt_decoder.js", (r) => r.fulfill({ path: "node_modules/three/examples/js/libs/meshopt_decoder.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // ホームには立体を置かない
  await expect(page.locator('.view[data-view="home"] #stage')).toHaveCount(0);
  await page.locator('.nv[data-go="world"]').click();
  await expect(page.locator("#crumb")).toHaveText("World");
  await expect(page.locator("#stage canvas")).toBeVisible();
  await expect(page.locator("#worldNow")).toHaveText("今の世界: 標準(無地)");
  await page.locator('.nv[data-go="settings"]').click();
  await page.locator("#pWorld").selectOption("zen");
  await page.locator('.nv[data-go="world"]').click();
  await expect(page.locator("#worldNow")).toHaveText("今の世界: 和の庭");
  // 読み込み中の表示が消えれば世界が入っている
  await expect(page.locator("#worldMsg")).toBeHidden({ timeout: 30_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}").prefs?.world)).toBe("zen");
  // 世界の中は展示: 凡例(文字)は出さない
  await expect(page.locator("#legend")).toBeHidden();
  // 名前で探すと、そのキューブの中(無地)に入り、戻るボタンで世界に戻る
  // 和の庭では探す欄は立て札の中
  await expect(page.locator("#guide.sign")).toBeVisible();
  await page.locator("#gFind").fill("S-01");
  await page.locator("#gFind").press("Enter");
  await expect(page.locator("#worldBar")).toContainText("S-01 の中");
  await expect(page.locator("#legend")).toBeVisible();
  await page.locator("#worldBack").click();
  await expect(page.locator("#worldBar")).toBeHidden();
  // 選んでいる状態なら、そのものの情報と軸が出る。空のまま Enter で中へ、Esc で戻る
  await expect(page.locator("#guide")).toContainText("3軸");
  await page.locator("#gFind").press("Enter");
  await expect(page.locator("#worldBar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#worldBar")).toBeHidden();
  expect(errors).toEqual([]);
});

// World の特別枠: タイムスリップ(カレンダー・宇宙)と日本地図。見本の法人の申込日・登録住所で並べる
test("World の特別枠で日付と住所で並べ直す", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.route("**/GLTFLoader.js", (r) => r.fulfill({ path: "node_modules/three/examples/js/loaders/GLTFLoader.js", contentType: "text/javascript" }));
  await page.route("**/meshopt_decoder.js", (r) => r.fulfill({ path: "node_modules/three/examples/js/libs/meshopt_decoder.js", contentType: "text/javascript" }));
  await page.route("**/leaflet/1.9.4/leaflet.js", (r) => r.fulfill({ path: "node_modules/leaflet/dist/leaflet.js", contentType: "text/javascript" }));
  await page.route("**/leaflet/1.9.4/leaflet.css", (r) => r.fulfill({ path: "node_modules/leaflet/dist/leaflet.css", contentType: "text/css" }));
  // 地図のタイルは外に取りに行かず、1 ドットの画像で代わりにする
  await page.route("https://cyberjapandata.gsi.go.jp/**", (r) => r.fulfill({ body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), contentType: "image/png" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // 見本は代理店・申込者の箱の中に法人
  await expect(page.locator("#tree")).toContainText("代理店単位");
  await page.locator('.nv[data-go="world"]').click();
  // カレンダー: 法人A の申込日(2026-04-12)の札があり、ダブルクリックで中に入れる
  await page.locator('[data-wm="cal"]').click();
  await expect(page.locator("#cal")).toBeVisible();
  await page.locator("#cal [data-cm='3']").click();
  await expect(page.locator("#cal h3")).toHaveText("2026年4月");
  await page.locator("#cal .chip", { hasText: "法人A" }).dblclick();
  await expect(page.locator("#worldBar")).toContainText("法人A の中");
  await page.keyboard.press("Escape");
  await expect(page.locator("#cal")).toBeVisible();
  // 日付の枠を押すとその日: 時刻のあるもの(面談日時)は時間の横軸、無いものは縦のリスト
  await page.locator(`#cal .day[data-day="${Date.UTC(2026, 3, 12)}"] .dn`).click();
  await expect(page.locator("#cal h3")).toHaveText("2026年4月12日(日)");
  await page.locator("#cField").selectOption("面談日時");
  await expect(page.locator("#cal .ax.day .chip")).toHaveCount(2);
  await expect(page.locator("#cal .ax.day")).toContainText("10:30 法人A");
  await expect(page.locator("#cal .dl")).toContainText("法人C");
  // 年: 3×4 の月。何月までのもの(開始予定)は月の見出しに
  await page.locator("#cField").selectOption("開始予定");
  await page.locator('#cal [data-cv="year"]').click();
  await expect(page.locator("#cal h3")).toHaveText("2026年");
  await expect(page.locator("#cal .ym")).toHaveCount(12);
  await expect(page.locator("#cal .ym").nth(6).locator(".mo")).toContainText("法人A");
  // 日本地図: 地理院タイルの地図に、登録住所のある5つのピン。案内は枠の外
  await page.locator('[data-wm="japan"]').click();
  await expect(page.locator("#jmap .leaflet-interactive")).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator("#stageWrap > #guide")).toContainText("ピン 5 件");
  await page.locator('#guide [data-js="photo"]').click();
  await expect(page.locator("#jmap .leaflet-tile").first()).toHaveAttribute("src", /seamlessphoto/);
  await page.locator("#jmap .leaflet-interactive").first().dblclick();
  await expect(page.locator("#worldBar")).toContainText("の中");
  await page.keyboard.press("Escape");
  await expect(page.locator("#jmap")).toBeVisible();
  // 宇宙: 申込日で並べる
  await page.locator('[data-wm="space"]').click();
  await expect(page.locator("#worldMsg")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#guide")).toContainText("時間航行");
  await page.locator("#lField").selectOption("申込日");
  await expect(page.locator("#stageWrap > #guide")).toContainText("並んだもの 4 件");
  // Y・Z にも項目を選べる。軸の中心は原点か中央値。案内とメニューは閉じられる
  await page.locator("#lFieldY").selectOption("@top");
  await page.locator("#lFieldZ").selectOption("契約日");
  await expect(page.locator("#stageWrap > #guide")).toContainText("並んだもの 4 件");
  await page.locator('[data-center="median"]').click();
  await expect(page.locator('[data-center="median"]')).toHaveClass(/on/);
  await page.locator("#gHide").click();
  await expect(page.locator("#guide")).toHaveClass(/gc/);
  await page.locator("#gShow").click();
  await expect(page.locator("#gFind")).toBeVisible();
  await page.locator("#navToggle").click();
  await expect(page.locator(".shell")).toHaveClass(/navc/);
  expect(errors).toEqual([]);
});
