import { expect, test } from "@playwright/test";

// 見本(ダミー)のデータはテストの時だけ入れる。「見本なし」のテストは本番と同じく空から始める
test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes("見本なし")) await page.addInitScript(() => localStorage.setItem("axis-boxes-v2:demo", "1"));
});

// 軸を使うテストのための軸(本番は空から始めるので、テストの中で入れる)
const AXES = [
  { id: "shop", name: "ショップ", kind: "key", values: [], fav: true, scope: "all" },
  { id: "mall", name: "モール", kind: "key", values: [], fav: true, scope: "all" },
  { id: "month", name: "月", kind: "key", values: [], fav: true, scope: "all" },
  { id: "item", name: "科目", kind: "measure", values: ["売上", "手数料"], fav: false, scope: "all" },
];
const seedAxes = (page: import("@playwright/test").Page) =>
  page.addInitScript((a) => { if (!localStorage.getItem("axis-boxes-v2")) localStorage.setItem("axis-boxes-v2", JSON.stringify({ axes: a, boxes: [], sheets: [], saved: [], dict: [], history: [], nextMonth: 10, sampleV: 5 })); }, AXES);

// 入口(/)で「軸の辞書と箱」のダッシュボードが開き、メニューで画面を切り替えられる
test("入口でダッシュボードが開き、画面を切り替えられる", async ({ page }) => {
  // three.js は CDN ではなく手元のものを使う(ネットにつながらない所でも動くように)
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.goto("/");
  await expect(page).toHaveTitle("軸の辞書と箱");
  await expect(page.locator("#crumb")).toHaveText("ホーム");
  await page.locator('.nv[data-go="import"]').click();
  await expect(page.locator("#crumb")).toHaveText("Compose › Import");
  await expect(page.locator(".side .ngh")).toHaveText("Compose");
  await expect(page.locator('.nv[data-go="gather"]')).toContainText("Remix");
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

// 貼り付けたSheetの行から、名前に使う列と単位を選んでBoxを作る
test("Sheetの行からBoxを作る", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  await page.goto("/");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("顧客一覧");
  await page.locator("#newData").fill("顧客番号,法人名,代表者名,電話\n0001,法人C,山田,03-1\n0002,法人D,佐藤,03-2\n0002,法人D,佐藤,03-2");
  await page.locator("#pasteRead").click();
  // 貼り付けた表は「読み取った Sheet」にチェックした状態で出る
  await expect(page.locator("#pickList .pk.on")).toHaveCount(1);
  await page.locator("#pickCards [data-pact]").selectOption("box");
  await page.locator("#pickGo").click();
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
  await expect(page.locator("#tree")).toContainText("お客様単位・Box6");
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}").boxes.filter((b: { levelName?: string }) => b.levelName === "お客様").length);
  expect(n).toBe(2);
  expect(errors).toEqual([]);
});

// スプシから読んだものは、反映するまで Saving に置く。反映の直前に元を読み直し、最新の内容で作る
test("読み取ったものは Saving に置き、反映の前に最新を読み直す", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const rows = [["0001", "法人C", "山田"], ["0002", "法人D", "佐藤"]];
  let reads = 0;
  await page.route("**/api/sheets/read**", (r) => {
    reads++;
    const tab = { name: "顧客", kind: "data", use: true, cols: ["顧客番号", "法人名", "代表者名"], rows, size: { rows: rows.length + 1, cols: 3 }, cf: [], dv: [], formulas: {} };
    return r.fulfill({ json: { book: { name: "顧客台帳", url: "https://docs.google.com/spreadsheets/d/x/edit", real: true, merge: false, gas: [], tabs: [tab] }, serviceAccount: "sa@example.iam.gserviceaccount.com" } });
  });
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#bookUrl").fill("https://docs.google.com/spreadsheets/d/x/edit");
  await page.locator("#bookRead").click();
  await expect(page.locator("#pickList .pk")).toHaveCount(1);
  // 同じスプシを別の形のリンクで読み直しても、タブは重ならない
  await page.locator("#bookUrl").fill("https://docs.google.com/spreadsheets/d/x/edit?gid=0#gid=0");
  await page.locator("#bookRead").click();
  await expect(page.locator("#pickList .pk")).toHaveCount(1);
  // まだ反映していないので Saving に1件
  await expect(page.locator("#nb-saving")).toHaveText("1");
  await page.locator('.nv[data-go="saving"]').click();
  await expect(page.locator(".stash")).toContainText("顧客台帳 › 顧客");
  await expect(page.locator(".stash")).toContainText("まだ反映していない行 2 行");
  // スプシ側で行が増えた。反映の直前に読み直すので、増えた行もBoxになる
  rows.push(["0003", "法人E", "鈴木"]);
  const before = reads;
  await page.locator("[data-svu]").click();
  await expect(page.locator("#unitSec")).toBeVisible();
  await page.locator('[data-ncol="1"]').check();
  await page.locator('[data-ncol="2"]').check();
  await page.locator("#uUnit").fill("お客様");
  await page.locator("#uMake").click();
  await expect(page.locator("#unitSec")).toBeHidden();
  expect(reads).toBe(before + 1);
  await page.locator('.nv[data-go="home"]').click();
  await expect(page.locator("#tree")).toContainText("0003 法人E 鈴木");
  // 全部の列と行を反映したので Saving から外れる
  await expect(page.locator("#nb-saving")).toBeHidden();
  await page.locator('.nv[data-go="saving"]').click();
  await expect(page.locator("#savingList")).toContainText("まだ反映していないものはありません");
  expect(errors).toEqual([]);
});

// 何行目が列名かはSheetによる: 表題・グループ名(口座情報)の行があっても列名の行を推定し、選び直せる。複数の列を同じ項目にまとめられる
test("列名の行を選び、複数の列を同じ項目にまとめる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("顧客台帳");
  await page.locator("#newData").fill("顧客一覧,,,,\n,,,口座情報,\n顧客番号,PartyID,法人名,銀行名,支店名\n0001,,法人C,みずほ,本店\n,P-9,法人D,りそな,新宿");
  await page.locator("#pasteRead").click();
  await page.locator("#pickGo").click();
  await expect(page.locator("#matchSec")).toBeVisible();
  // 3行目が列名、2行目がグループ名の行と推定する
  await expect(page.locator('[data-hr="p"]')).toHaveValue("2");
  await expect(page.locator('[data-gr="p"]')).toHaveValue("1");
  await expect(page.locator("#matches")).toContainText("口座情報 › 銀行名");
  // グループ名の行から「口座情報」をまとめる提案と、選んだ列を「顧客」(どれか1つ)にまとめる
  await page.locator("[data-gsug]").first().click();
  await page.locator('[data-gc="0"]').check();
  await page.locator('[data-gc="1"]').check();
  await page.locator("#gName").fill("顧客");
  await page.locator("#gMode").selectOption("first");
  await page.locator("#gAdd").click();
  await expect(page.locator("#matches")).toContainText("「顧客」= A 顧客番号 + B PartyID");
  await page.locator("#approve").click();
  await expect(page.locator("#matchSec")).toBeHidden();
  const sh = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}").sheets.at(-1));
  expect(sh.cols).toEqual(["顧客番号", "PartyID", "法人名", "口座情報 › 銀行名", "口座情報 › 支店名", "口座情報", "顧客"]);
  expect(sh.rows.map((r: string[]) => r[6])).toEqual(["0001", "P-9"]);
  expect(sh.rows[0][5]).toBe("みずほ 本店");
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
  // 名前で探すと、そのCubeの中(無地)に入り、戻るボタンで世界に戻る
  // 和の庭では探す欄は立て札の中
  await expect(page.locator("#guide.sign")).toBeVisible();
  // 検索・フィルターは 3D の枠の外。枠の中は右上の小さな案内図だけ
  await expect(page.locator("#stageWrap > #guide")).toBeVisible();
  await expect(page.locator("#stage input, #stage select")).toHaveCount(0);
  await expect(page.locator("#miniMap svg")).toBeVisible();
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
  // 見本は代理店・申込者のBoxの中に法人
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
  await expect(page.locator("#cal .vt .chip")).toHaveCount(2);
  await expect(page.locator("#cal .vt")).toContainText("10:30 法人A");
  await expect(page.locator("#cal .dl")).toContainText("法人C");
  // 年: 3×4 の月。何月までのもの(開始予定)は月の見出しに
  await page.locator("#cField").selectOption("開始予定");
  await page.locator('#cal [data-cv="year"]').click();
  await expect(page.locator("#cal h3")).toHaveText("2026年");
  await expect(page.locator("#cal .ym")).toHaveCount(12);
  await expect(page.locator("#cal .ym").nth(6).locator(".mo")).toContainText("法人A");
  // 複数年: 1年が1つの枠。年を押すとその年
  await page.locator('#cal [data-cv="years"]').click();
  await expect(page.locator("#cal h3")).toHaveText("2021〜2032年");
  await expect(page.locator("#cal .ym").nth(5)).toContainText("法人B");
  await page.locator('#cal [data-yy="2026"]').click();
  await expect(page.locator("#cal h3")).toHaveText("2026年");
  // 立体で見る: カレンダーの並びのままCubeにする(上の帯だけ残る)
  await page.locator("#calCube").click();
  await expect(page.locator("#cal")).toHaveClass(/bar/);
  await expect(page.locator("#stage #cal")).toHaveCount(0);
  await expect(page.locator("#cal .yg")).toHaveCount(0);
  await page.locator("#calCube").click();
  await expect(page.locator("#cal .yg")).toHaveCount(1);
  // 日本地図: 地理院タイルの地図に、登録住所のある5つのピン。案内は枠の外
  await page.locator('[data-wm="japan"]').click();
  await expect(page.locator("#jmap .leaflet-interactive")).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator("#stageWrap > #guide")).toContainText("ピン 5 件");
  // 白地図は地理院タイルを読まず、陸・県境・都市部だけを描く
  await expect(page.locator("#jmap .leaflet-tile")).toHaveCount(0);
  await expect(page.locator("#jmap .leaflet-jland-pane path")).toHaveCount(2);
  // 一段寄ると、人口の少ない県(鳥取・島根)も県でいちばん大きい都市を出す
  for (let i = 0; i < 2; i++) { await page.locator("#jmap .leaflet-control-zoom-in").click(); await page.waitForTimeout(600); }
  await expect(page.locator("#jmap .jlab", { hasText: "鳥取" })).toHaveCount(1);
  await expect(page.locator("#jmap .jlab", { hasText: "松江" })).toHaveCount(1);
  for (let i = 0; i < 2; i++) { await page.locator("#jmap .leaflet-control-zoom-out").click(); await page.waitForTimeout(600); }
  // いちばん縮めても、近隣の国の陸が枠いっぱいにあり、地図が途中で切れない
  for (let i = 0; i < 8 && !(await page.locator("#jmap .leaflet-control-zoom-out.leaflet-disabled").count()); i++) { await page.locator("#jmap .leaflet-control-zoom-out").click(); await page.waitForTimeout(500); }
  await expect(page.locator("#jmap .leaflet-control-zoom-out")).toHaveClass(/leaflet-disabled/);
  const [box, near] = await page.evaluate(() => [document.querySelector("#jmap")!.getBoundingClientRect().toJSON(), document.querySelector("#jmap .leaflet-jland-pane path")!.getBoundingClientRect().toJSON()]);
  expect(near.left).toBeLessThanOrEqual(box.left + 1); expect(near.right).toBeGreaterThanOrEqual(box.right - 1);
  expect(near.top).toBeLessThanOrEqual(box.top + 1); expect(near.bottom).toBeGreaterThanOrEqual(box.bottom - 1);
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
  await page.locator('[data-center="corner"]').click();
  await expect(page.locator('[data-center="corner"]')).toHaveClass(/on/);
  await page.locator("#gHide").click();
  await expect(page.locator("#guide")).toHaveClass(/gc/);
  await page.locator("#gShow").click();
  await expect(page.locator("#gFind")).toBeVisible();
  await page.locator("#navToggle").click();
  await expect(page.locator(".shell")).toHaveClass(/navc/);
  expect(errors).toEqual([]);
});

// スプシのリンクを読んだら、Sheet(タブ)ごとに何にするか(SheetとしてCubeへ・1行ずつBox・1行ずつCube・まだ使わない)と入れる先を選ぶ
test("読み取ったSheetごとに、何にするかと入れる先を選ぶ", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tab = (name: string, cols: string[], rows: string[][]) => ({ name, kind: "data", use: true, cols, rows, size: { rows: rows.length + 1, cols: cols.length }, cf: [], dv: [], formulas: {} });
  await page.route("**/api/sheets/read**", (r) =>
    r.fulfill({ json: { book: { name: "全顧客データ", url: "https://docs.google.com/spreadsheets/d/y/edit", real: true, merge: false, gas: [], tabs: [
      tab("売上", ["年月", "売上金額"], [["2026-07", "1000"], ["2026-08", "1200"]]),
      tab("顧客", ["顧客番号", "法人名"], [["0101", "法人X"], ["0102", "法人Y"]]),
      tab("メモ", ["メモ"], [["あとで"]]),
    ] } } }));
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#bookUrl").fill("https://docs.google.com/spreadsheets/d/y/edit");
  await page.locator("#bookRead").click();
  // タブはチェックリストに並び、チェックしたものだけ下にカードで出る
  await expect(page.locator("#pickList .pk")).toHaveCount(3);
  await expect(page.locator("#pickList .pk.on")).toHaveCount(3);
  await expect(page.locator("#pickList .pk").first().locator(".sz")).toHaveText("2行 × 2列");
  const card = (n: number) => page.locator("#pickCards .tab").nth(n);
  await expect(page.locator("#pickCards .tab")).toHaveCount(3);
  // 何にするは Sheet・Box・Cube・Card の4つ
  await expect(card(0).locator("[data-pact] option")).toHaveText(["Sheet として Cube に入れる(列を軸にする)", "1行ずつ Box にする", "1行ずつ Cube にする", "1行ずつ Card にする"]);
  // 列と最初の行は開いたときだけ。貼り付け欄は折り返さない
  await expect(card(0).locator(".pv")).toBeHidden();
  await card(0).locator("summary").click();
  await expect(card(0).locator(".pv")).toContainText("売上金額");
  await expect(page.locator("#newData")).toHaveAttribute("wrap", "off");
  // 売上はSheetとしてCube S-02 へ、顧客は1行ずつBoxにして代理店「東京ネット販売」の中へ、メモはチェックを外す
  await card(0).locator("[data-pdest]").selectOption("c2");
  await card(1).locator("[data-pact]").selectOption("box");
  await card(1).locator("[data-pdest]").selectOption("a1");
  await page.locator("#pickList .pk", { hasText: "メモ" }).locator("input").uncheck();
  await expect(page.locator("#pickCards .tab")).toHaveCount(2);
  await page.locator("#pickGo").click();
  // 1枚目: 売上をCube S-02 に承認
  await expect(page.locator("#matchSec")).toBeVisible();
  await expect(page.locator("#pCube")).toHaveValue("c2");
  await expect(page.locator("#queueInfo")).toContainText("行から作るもの 1 枚");
  await page.locator("#approve").click();
  // 2枚目: 顧客の行からBox(入れる先は選んだBox)
  await expect(page.locator("#unitSec")).toBeVisible();
  await expect(page.locator('input[name=uKind][value="box"]')).toBeChecked();
  await expect(page.locator("#uParent")).toHaveValue("a1");
  await page.locator('[data-ncol="1"]').check();
  await page.locator("#uUnit").fill("お客様");
  await page.locator("#uMake").click();
  await expect(page.locator("#unitSec")).toBeHidden();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.sheets.at(-1).cube).toBe("c2");
  expect(st.boxes.filter((b: { parent?: string; levelName?: string }) => b.parent === "a1" && b.levelName === "お客様").map((b: { name: string }) => b.name)).toEqual(["0101 法人X", "0102 法人Y"]);
  // メモは使っていないので Saving に残る
  await page.locator('.nv[data-go="saving"]').click();
  await expect(page.locator("#savingList")).toContainText("全顧客データ › メモ");
  expect(errors).toEqual([]);
});

// 右の「Sheetを選んで入れる」でも、読み取ったスプシのSheetを選べる(中身は Saving のもの、反映の前に読み直す)
test("読み取ったSheetを右の欄で選んで入れる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let reads = 0;
  const tab = (name: string, cols: string[], rows: string[][]) => ({ name, kind: "data", use: true, cols, rows, size: { rows: rows.length + 1, cols: cols.length }, cf: [], dv: [], formulas: {} });
  await page.route("**/api/sheets/read**", (r) => {
    reads++;
    return r.fulfill({ json: { book: { name: "全顧客データ", url: "https://docs.google.com/spreadsheets/d/z/edit", real: true, merge: false, gas: [], tabs: [
      tab("売上", ["年月", "売上金額"], [["2026-07", "1000"]]),
      tab("顧客", ["顧客番号", "法人名"], [["0201", "法人P"], ["0202", "法人Q"]]),
    ] } } });
  });
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#bookUrl").fill("https://docs.google.com/spreadsheets/d/z/edit");
  await page.locator("#bookRead").click();
  // 顧客だけにチェックを残し、1行ずつBoxにする
  await page.locator("#pickList .pk", { hasText: "売上" }).locator("input").uncheck();
  await expect(page.locator("#pickCards .tab")).toHaveCount(1);
  await expect(page.locator("#pickCards .tab")).toContainText("全顧客データ › 顧客");
  await page.locator("#pickCards [data-pact]").selectOption("box");
  await page.locator("#pickCards [data-pdest]").selectOption("a1");
  await page.locator("#pickGo").click();
  await expect(page.locator("#unitSec")).toBeVisible();
  await expect(page.locator("#uParent")).toHaveValue("a1");
  await page.locator('[data-ncol="1"]').check();
  await page.locator("#uUnit").fill("お客様");
  const before = reads;
  await page.locator("#uMake").click();
  await expect(page.locator("#unitSec")).toBeHidden();
  expect(reads).toBe(before + 1);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.boxes.filter((b: { parent?: string; levelName?: string }) => b.parent === "a1" && b.levelName === "お客様").map((b: { name: string }) => b.name)).toEqual(["0201 法人P", "0202 法人Q"]);
  expect(errors).toEqual([]);
});

// 見本なし: はじめは空。前に見本が入ったまま保存された中身からは見本だけを消し、実データは残す
test("見本なし: はじめは空で、前の中身は一度だけすべて消え、設定から消し直せる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.boxes ?? []).toEqual([]);
  // どの画面も空のまま開ける
  for (const v of ["home", "world", "gather", "import", "saving", "dict", "history"]) {
    const nv = page.locator(`.nv[data-go="${v}"]`);
    if (await nv.count()) await nv.click();
  }
  await page.locator('.nv[data-go="import"]').click();
  await expect(page.locator("#pickList")).toContainText("まだありません");
  // リンクの欄も空(例の URL を入れておかない)
  await expect(page.locator("#bookUrl")).toHaveValue("");
  // 前の見本のまま保存された中身(見本のBoxの中に実データのBox、見本のCubeに実データのSheet)
  await page.evaluate(() => { localStorage.removeItem("axis-boxes-v2"); localStorage.setItem("axis-boxes-v2:demo", "1"); });
  await page.reload();
  const old = await page.evaluate(() => {
    const x = JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}");
    delete x.demo;
    x.boxes.push({ id: "u1", kind: "box", name: "0001 実データ", parent: "a1", own: {}, levelName: "お客様" });
    x.sheets.push({ id: "shX", cube: "c2", name: "実Sheet", tag: {}, cols: ["年月", "売上金額"], rows: [["2026-07", "1"]], bind: [null, null] });
    return JSON.stringify(x);
  });
  // 閉じる時の保存に上書きされないよう、開く前に入れる
  await page.addInitScript((v) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.removeItem("axis-boxes-v2:demo"); localStorage.setItem("axis-boxes-v2", v); } }, old);
  await page.reload();
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  // 2026-10-06 ユーザー指定: 例の軸(法人・ショップ・モール・月・科目)ごと、すべて一度だけ消す。控えはこのブラウザに残す
  expect(st.boxes).toEqual([]);
  expect(st.sheets).toEqual([]);
  expect(st.saved).toEqual([]);
  expect(st.saving).toEqual([]);
  expect(st.axes).toEqual([]);
  expect(st.dict).toEqual([]);
  expect(st.sampleV).toBe(5);
  expect(st.history.map((h: { title: string }) => h.title)).toEqual(["データをすべて消した"]);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("axis-boxes-v2:backup-")))).toBe(true);
  await page.locator('.nv[data-go="home"]').click();
  await expect(page.locator("#tree")).not.toContainText("0001 実データ");
  // 作ったあとに設定の「すべて消して始め直す」で消せる。開き直しても勝手には消えない
  await page.locator('.nv[data-go="create"]').click();
  await page.locator('[data-mk="box"]').click();
  await page.locator("#mkName").fill("あとで消すBox");
  await page.locator("#mkGo").click();
  await page.reload();
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.boxes.map((b: { name: string }) => b.name)).toEqual(["あとで消すBox"]);
  await page.locator('.nv[data-go="settings"]').click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#wipeAll").click();
  await page.waitForLoadState("load");
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"))).boxes.length).toBe(0);
  expect(errors).toEqual([]);
});

// 見本なし: 設定ははじめ何も決めていない。軸の辞書でグループとサブタイトルを作れる
test("見本なし: 設定は未設定から始まり、Column Registry でカラムの登録・グループ・サブタイトル・同義を扱える", async ({ page }) => {
  await seedAxes(page);
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="settings"]').click();
  await expect(page.locator("#pShade")).toHaveValue("");
  for (const i of [0, 1, 2]) await expect(page.locator(`[data-ca="${i}"]`)).toHaveValue("");
  await expect(page.locator("#prefs")).not.toContainText("初期値");
  await expect(page.locator("#prefs .pill", { hasText: "未設定" })).toHaveCount(3);
  // 3つとも選ぶと自分の設定になる
  await page.locator('[data-ca="0"]').selectOption("month");
  await page.locator('[data-ca="1"]').selectOption("mall");
  await expect(page.locator('[data-ca="0"]')).toHaveValue("month");
  await page.locator('[data-ca="2"]').selectOption("item");
  await expect(page.locator("#prefs .pill", { hasText: "自分の設定" })).toHaveCount(1);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.prefs.cubeAxes).toEqual(["month", "mall", "item"]);
  // Column Registry: グループを作り、カラムを入れ、サブタイトルを付ける
  await page.locator('.nv[data-go="dict"]').click();
  await expect(page.locator("#crumb")).toHaveText("Column Registry");
  await page.locator("#axGrpName").fill("売上の情報");
  await page.locator("#axGrpAdd").click();
  await page.locator('[data-lib="month"]').click();
  await page.locator('[data-agrp="month"]').selectOption({ label: "売上の情報" });
  await page.locator('[data-asub="month"]').fill("売上Sheetの計上月(申込月ではない)");
  await page.locator('[data-asub="month"]').blur();
  await expect(page.locator("#axes .agrp")).toContainText("月");
  await expect(page.locator('#axes .agrp [data-lib="month"] small')).toHaveText("売上Sheetの計上月(申込月ではない)");
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.groups.map((g: { name: string }) => g.name)).toEqual(["売上の情報"]);
  expect(st.axes.find((a: { id: string }) => a.id === "month")).toMatchObject({ group: st.groups[0].id, sub: "売上Sheetの計上月(申込月ではない)" });
  // グループを消してもカラムは残る
  page.once("dialog", (d) => d.accept());
  await page.locator("[data-gdel]").click();
  await expect(page.locator("#axes .agrp")).toHaveCount(0);
  await expect(page.locator('[data-asub="month"]')).toHaveValue("売上Sheetの計上月(申込月ではない)");
  // カラムを登録し、同義をつなぐ・外す
  await page.locator("#libNew").click();
  await page.locator("#lnName").fill("申込日");
  await page.locator("#lnSub").fill("申込フォームの申込日");
  await page.locator("#lnGo").click();
  await expect(page.locator("#libHead h2")).toHaveText("申込日");
  await page.locator("#dFrom").fill("申込年月日");
  await page.locator("#dAdd").click();
  await expect(page.locator("#libSyn .sc2")).toHaveCount(1);
  await expect(page.locator("#axes .li.on .cnt")).toHaveText("同義 1");
  await page.locator("#libQ").fill("申込年月");
  await expect(page.locator("#axes .li")).toHaveCount(1);
  await page.locator("#libSyn [data-dd]").click();
  await expect(page.locator("#libSyn .sc2")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 見本なし: Compose › Create でCube・Box・Sheetを1つずつ作る(Sheetは列を軸に照らして承認)
test("見本なし: Create でCube・Box・Sheetを作る", async ({ page }) => {
  await seedAxes(page);
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="create"]').click();
  await expect(page.locator("#crumb")).toHaveText("Compose › Create");
  // SheetはCubeがないと作れない
  await page.locator('[data-mk="sheet"]').click();
  await expect(page.locator("#mkForm")).toContainText("先にCubeを作ってください");
  // Box
  await page.locator('[data-mk="box"]').click();
  await page.locator("#mkName").fill("法人A");
  await page.locator("#mkUnit").fill("法人");
  await page.locator("#mkGo").click();
  // Cube: 3軸を選ばないと作れない
  await page.locator('[data-mk="cube"]').click();
  await page.locator("#mkName").fill("S-01 楽天店");
  await page.locator("#mkIn").selectOption({ label: "Box 法人A" });
  await page.locator("#mkGo").click();
  await expect(page.locator("#note")).toContainText("3軸を3つとも選んでください");
  await page.locator('[data-mka="0"]').selectOption("month");
  await page.locator('[data-mka="1"]').selectOption("mall");
  await page.locator('[data-mka="2"]').selectOption("item");
  await page.locator("#mkGo").click();
  // 作ったら「見る」が出て、押すと World でそのCubeを選ぶ
  await expect(page.locator("#note")).toContainText("Cube「S-01 楽天店」を作りました");
  await expect(page.locator(".mkdone .it")).toHaveCount(2);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  const a = st.boxes.find((b: { name: string }) => b.name === "法人A"), c = st.boxes.find((b: { name: string }) => b.name === "S-01 楽天店");
  expect(a).toMatchObject({ kind: "box", levelName: "法人", parent: null });
  expect(c).toMatchObject({ kind: "cube", axes: ["month", "mall", "item"], parent: a.id });
  // Sheet: 列を入れると Import で軸を照らして承認する
  await page.locator('[data-mk="sheet"]').click();
  await page.locator("#mkName").fill("楽天の売上");
  await page.locator("#mkCols").fill("年月, モール名, 売上金額");
  await expect(page.locator("#mkChips span")).toHaveCount(3);
  await page.locator("#mkGo").click();
  await expect(page.locator("#crumb")).toHaveText("Compose › Import");
  await expect(page.locator("#matchSec")).toBeVisible();
  await expect(page.locator("#matches .match")).toHaveCount(3);
  await page.locator("#approve").click();
  await page.locator("#note button", { hasText: "見る" }).click();
  await expect(page.locator("#viewSec")).toBeVisible();
  await expect(page.locator("#viewTitle")).toContainText("楽天の売上");
  await page.locator("#viewClose").click();
  await page.locator('.nv[data-go="create"]').click();
  await page.locator('.mkdone [data-look="1"]').click();
  await expect(page.locator("#crumb")).toHaveText("World");
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.sheets.map((x: { name: string; cube: string; rows: unknown[] }) => [x.name, x.cube, x.rows.length])).toEqual([["楽天の売上", c.id, 0]]);
  expect(errors).toEqual([]);
});

// 見本なし: 名前に使う列(列の記号の行は列名にしない・値のある列だけ・選んだ順)、Sheetの各行からBox、Card
test("見本なし: 各行からBoxとCardを作り、Cardを見る", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // 1行目が列の記号(A C R …)、2行目が列名の表を貼り付けて Saving に置く
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("全顧客");
  await page.locator("#newData").fill("A\tC\tR\tT\n顧客番号\t代表者名\t営業マン\t備考\n0001\t山田\t佐藤\t\n0002\t田中\t鈴木\t");
  await page.locator("#pasteRead").click();
  // Cube がまだないので、はじめは1行ずつ Box。Sheet を選ぶと入れる先は「新しい Cube を作って入れる」
  await expect(page.locator("#pickCards [data-pact]")).toHaveValue("box");
  await page.locator("#pickCards [data-pact]").selectOption("sheet");
  await expect(page.locator("#pickCards [data-pdest]")).toHaveValue("@new");
  await page.locator("#pickCards [data-pact]").selectOption("box");
  await page.locator("#pickGo").click();
  await expect(page.locator("#unitSec")).toBeVisible();
  // 列名は2行目。値のない「備考」は出さない
  await expect(page.locator(".nch b")).toHaveText(["顧客番号", "代表者名", "営業マン"]);
  await expect(page.locator("#uMode")).toHaveCount(0);
  // 選んだ順につなぐ(はじめは左の列が選ばれている。外して選び直すと後ろに回る)
  await page.locator('[data-ncol="1"]').check();
  await expect(page.locator(".nch.on i")).toHaveText(["1", "2"]);
  await page.locator('[data-ncol="0"]').uncheck();
  await page.locator('[data-ncol="0"]').check();
  await expect(page.locator(".nch.on i")).toHaveText(["2", "1"]);
  await expect(page.locator("#uMode")).toBeVisible();
  await expect(page.locator("#uPreview")).toContainText("山田 0001");
  await page.locator("#uUnit").fill("お客様");
  await page.locator("#uMake").click();
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.boxes.map((b: { name: string }) => b.name)).toEqual(["山田 0001", "田中 0002"]);
  // もう1枚貼り付けて、作らずに Saving に置いておく
  await page.locator("#newName").fill("全顧客2");
  await page.locator("#newData").fill("顧客番号\t代表者名\n0001\t山田\n0002\t田中");
  await page.locator("#pasteRead").click();
  // Create › Card › Sheetの各行から(Saving のSheet)
  await page.locator('.nv[data-go="create"]').click();
  await page.locator('[data-mk="card"]').click();
  await page.locator('[data-rows="1"]').click();
  await expect(page.locator("#mkSrc option")).toHaveCount(1);
  await page.locator("#mkGo").click();
  await expect(page.locator("#unitSec")).toBeVisible();
  await expect(page.locator('input[name=uKind][value="card"]')).toBeChecked();
  await page.locator('[data-ncol="0"]').check();
  await page.locator("#uUnit").fill("顧客Card");
  await page.locator("#uMake").click();
  await page.locator("#note button", { hasText: "見る" }).click();
  await expect(page.locator("#cardSec")).toBeVisible();
  await expect(page.locator("#cardBody dl")).toContainText("山田");
  await page.locator("#cardClose").click();
  // Cardを1枚作る
  await page.locator('.nv[data-go="create"]').click();
  await page.locator('[data-mk="card"]').click();
  await page.locator('[data-rows="0"]').click();
  await page.locator("#mkName").fill("契約条件");
  await page.locator("#mkFields").fill("担当: 山田\n契約開始：2026-10-01");
  await page.locator("#mkGo").click();
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.cards.find((c: { name: string }) => c.name === "契約条件").fields).toEqual([["担当", "山田"], ["契約開始", "2026-10-01"]]);
  await page.locator('.nv[data-go="home"]').click();
  await expect(page.locator("#tree [data-card]")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("見本なし: 作ったBoxを中身ごと消す", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="create"]').click();
  await page.locator('[data-mk="box"]').click();
  await page.locator("#mkName").fill("BoxX");
  await page.locator("#mkUnit").fill("法人");
  await page.locator("#mkGo").click();
  await page.locator('[data-mk="box"]').click();
  await page.locator("#mkName").fill("BoxY");
  await page.locator("#mkUnit").fill("店");
  await page.locator("#mkIn").selectOption({ label: "Box BoxX" });
  await page.locator("#mkGo").click();
  await page.locator('[data-mk="box"]').click();
  await page.locator("#mkName").fill("BoxZ");
  await page.locator("#mkUnit").fill("法人");
  await page.locator("#mkGo").click();
  await page.locator('.nv[data-go="home"]').click();
  await expect(page.locator("#tree [data-udel]")).toHaveCount(3);
  // 確かめる文に中身の数が出る。キャンセルなら消えない
  let msg = "";
  page.once("dialog", (d) => { msg = d.message(); d.dismiss(); });
  await page.locator('#tree [data-unit] b', { hasText: "BoxX" }).locator("..").locator("[data-udel]").click();
  expect(msg).toContain("Box「BoxX」を消しますか");
  expect(msg).toContain("Box・Cube 1個");
  await expect(page.locator("#tree [data-udel]")).toHaveCount(3);
  page.once("dialog", (d) => d.accept());
  await page.locator('#tree [data-unit] b', { hasText: "BoxX" }).locator("..").locator("[data-udel]").click();
  await expect(page.locator("#note")).toContainText("Box「BoxX」を消しました");
  await expect(page.locator("#tree [data-udel]")).toHaveCount(1);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.boxes.map((b: { name: string }) => b.name)).toEqual(["BoxZ"]);
  // 選んで「選んだものを消す」でも消せる
  await page.locator('.nv[data-go="world"]').click();
  await expect(page.locator("#selDel")).toBeHidden();
  const zv = await page.locator('#selUnit optgroup[label="1つずつ"] option', { hasText: "BoxZ" }).getAttribute("value");
  await page.locator("#selUnit").selectOption(zv!);
  await expect(page.locator("#selDel")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator("#selDel").click();
  await expect(page.locator("#tree [data-udel]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("見本なし: Library は種類から実体へたどり、Column Registry と行き来できる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="create"]').click();
  for (const [n, u] of [["株式会社A", "法人"], ["株式会社B", "法人"], ["渋谷店", "ショップ"]]) {
    await page.locator('[data-mk="box"]').click();
    await page.locator("#mkName").fill(n);
    await page.locator("#mkUnit").fill(u);
    await page.locator("#mkGo").click();
  }
  for (const [n, no] of [["Aの基本", "111"], ["Bの基本", "222"]]) {
    await page.locator('[data-mk="card"]').click();
    await page.locator("#mkName").fill(n);
    await page.locator("#mkFields").fill(`法人名: ${n[0]}社\n法人番号: ${no}`);
    await page.locator("#mkGo").click();
  }
  // いちばん上は種類だけ。実体(株式会社A など)は並べない
  await page.locator('.nv[data-go="library"]').click();
  await expect(page.locator("#crumb")).toHaveText("Library");
  await expect(page.locator("#libCat .dfc")).toHaveCount(3);
  await expect(page.locator("#libCat .ir")).toHaveCount(0);
  await expect(page.locator("#libCat")).not.toContainText("株式会社A");
  await page.locator('[data-lbk="box"]').click();
  await expect(page.locator("#libCat .dfc")).toHaveCount(2);
  await expect(page.locator("#libCat .dfc", { hasText: "法人" })).toContainText("2件");
  // 中身で探すと、一致した実体を持つ種類が出る
  await page.locator('[data-lbk="all"]').click();
  await page.locator("#lbQ").fill("株式会社B");
  await expect(page.locator("#libCat .dfc")).toHaveCount(1);
  await expect(page.locator("#libCat .dfc")).toContainText("中身が一致 1件");
  await page.locator("#libCat .dfc").click();
  await expect(page.locator(".lbcrumb")).toContainText("Library›Box›法人");
  await expect(page.locator("#lbList .ir")).toHaveCount(1);
  await page.locator("#lbIQ").fill("");
  await expect(page.locator("#lbList .ir")).toHaveCount(2);
  // 種類の名前を変えられる
  await page.locator("[data-defname]").fill("法人Box");
  await page.locator("[data-defname]").blur();
  await expect(page.locator(".lbcrumb b")).toHaveText("法人Box");
  // Card の種類: カラムは未登録 → 押すと Column Registry で登録
  await page.locator("[data-lbtop]").click();
  await page.locator("#lbQ").fill("");
  await page.locator('[data-lbk="card"]').click();
  await page.locator("#libCat .dfc").click();
  await expect(page.locator("#lbList .ir")).toHaveCount(2);
  await page.locator("#lbCol").selectOption("法人番号");
  await page.locator("#lbVal").fill("222");
  await expect(page.locator("#lbList .ir")).toHaveCount(1);
  // はじめは空なので、法人名も法人番号も未登録
  await expect(page.locator('#libCat [data-colnew="法人名"]')).toHaveCount(1);
  await page.locator('[data-colnew="法人番号"]').click();
  await expect(page.locator("#crumb")).toHaveText("Column Registry");
  await expect(page.locator("#lnName")).toHaveValue("法人番号");
  await page.locator("#lnGo").click();
  // 逆引き: 法人番号を使っている Card の種類
  await expect(page.locator("#libUse [data-defgo]")).toHaveCount(1);
  await expect(page.locator("#libUse [data-defgo]")).toContainText("2件");
  // 意味・型・状態
  await page.locator('[data-af="desc"]').fill("国税庁の13桁の法人番号");
  await page.locator('[data-af="desc"]').blur();
  await page.locator('[data-af="dtype"]').selectOption("ID・コード");
  // 別カラム「法人コード」を登録し、Equivalent でつなぐ(Alias とは別)
  await page.locator("#libNew").click();
  await page.locator("#lnName").fill("法人コード");
  await page.locator("#lnGo").click();
  await page.locator("#lkRel").selectOption("equiv");
  await page.locator("#lkTo").selectOption({ label: "法人番号" });
  await page.locator("#lkAdd").click();
  await expect(page.locator("#libRel .lk")).toContainText("Equivalent");
  await expect(page.locator("#libSyn .sc2")).toHaveCount(0);
  await page.locator('[data-af="status"]').selectOption("deprecated");
  await expect(page.locator("#axes .li.dep")).toContainText("法人コード");
  await page.locator("#libRel .lkn").click();
  await expect(page.locator("#libHead h2")).toHaveText("法人番号");
  await expect(page.locator("#libRel .lk")).toContainText("法人コード");
  // Column Registry から Library の種類へ
  await page.locator("#libUse [data-defgo]").click();
  await expect(page.locator("#crumb")).toHaveText("Library");
  await expect(page.locator(".lbcrumb")).toContainText("Card");
  await expect(page.locator('#libCat [data-colgo]', { hasText: "法人番号" })).toHaveCount(1);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  expect(st.defs.find((d: { name: string }) => d.name === "法人Box")).toMatchObject({ kind: "box", kept: true });
  expect(st.links).toHaveLength(1);
  expect(st.axes.find((a: { name: string }) => a.name === "法人番号")).toMatchObject({ desc: "国税庁の13桁の法人番号", dtype: "ID・コード" });
  expect(st.axes.find((a: { name: string }) => a.name === "法人コード")).toMatchObject({ status: "deprecated" });
  expect(errors).toEqual([]);
});

// 軸がまだないところで Sheet を「新しい Cube」に入れても、その Cube が World に出て、Library から開ける
test("見本なし: Sheet を入れるために作った Cube が World に出て、Library から開ける", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("全顧客");
  await page.locator("#newData").fill("顧客番号\t代表者名\t営業マン\n0001\t山田\t佐藤\n0002\t田中\t鈴木");
  await page.locator("#pasteRead").click();
  await page.locator("#pickCards [data-pact]").selectOption("sheet");
  await page.locator("#pickGo").click();
  await page.locator("#approve").click();
  await expect(page.locator("#matchSec")).toBeHidden();
  // Cube の3軸は、Sheet の分類の列から埋める(数の列「顧客番号」は軸にしない)
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("axis-boxes-v2") || "{}"));
  const cube = st.boxes.find((b: { kind: string }) => b.kind === "cube");
  expect(cube.parent).toBeNull();
  expect(cube.axes.map((a: string) => st.axes.find((x: { id: string }) => x.id === a).name)).toEqual(["代表者名", "営業マン"]);
  // Library の Cube の種類から開くと、World でその Cube を選んだ状態になる
  await page.locator('.nv[data-go="library"]').click();
  await page.locator('[data-lbk="cube"]').click();
  await page.locator("[data-def]").first().click();
  await page.locator("[data-iopen]").first().click();
  await expect(page.locator('.view[data-view="world"]')).toBeVisible();
  await expect(page.locator("#selUnit")).toHaveValue(cube.id);
  // Sheet の種類から開くと、Sheet の中身が出る
  await page.locator('.nv[data-go="library"]').click();
  await page.locator('[data-lbtop]').click();
  await page.locator('[data-lbk="sheet"]').click();
  await page.locator("[data-def]").first().click();
  await page.locator("[data-iopen]").first().click();
  await expect(page.locator("#viewSec")).toBeVisible();
  await expect(page.locator("#viewGrid")).toContainText("山田");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

// 同じ単位のBoxの中に、同じ単位のBoxを入れても World が止まらずに描ける(前は大きさの計算が終わらず何も映らなかった)
test("見本なし: 同じ単位のBoxを入れ子にしても World に出る", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.text().includes("視点を戻しました")) errors.push(m.text()); });
  await page.goto("/");
  const rowsToBoxes = async (name: string, data: string) => {
    await page.locator('.nv[data-go="import"]').click();
    await page.locator("#newName").fill(name);
    await page.locator("#newData").fill(data);
    await page.locator("#pasteRead").click();
    await page.locator("#pickCards [data-pact]").selectOption("box");
    await page.locator("#pickGo").click();
    await page.locator("#uUnit").fill("法人");
    await page.locator("#uMake").click();
    await expect(page.locator("#unitSec")).toBeHidden();
  };
  await rowsToBoxes("法人一覧", "法人名\n法人A\n法人B");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("支店");
  await page.locator("#newData").fill("法人名\n法人A 支店");
  await page.locator("#pasteRead").click();
  await page.locator("#pickCards [data-pact]").selectOption("box");
  const opt = await page.locator('#pickCards [data-pdest] option', { hasText: "法人A" }).first().getAttribute("value");
  await page.locator("#pickCards [data-pdest]").selectOption(opt!);
  await page.locator("#pickGo").click();
  await page.locator("#uUnit").fill("法人");
  await page.locator("#uMake").click();
  await expect(page.locator("#unitSec")).toBeHidden();
  await page.locator('.nv[data-go="world"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator("#gizmo text").first()).toBeVisible();
  // 引いたり寄ったりしても止まらない(遠いと中身は数だけ、近いと中身が出る)
  await page.locator("#stage canvas").hover();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
