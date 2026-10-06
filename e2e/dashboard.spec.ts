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
  await page.locator("#pAct").selectOption("box");
  await page.locator("#read").click();
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
  await expect(page.locator("#bookSec")).toBeVisible();
  // まだ反映していないので Saving に1件
  await expect(page.locator("#nb-saving")).toHaveText("1");
  await page.locator('.nv[data-go="saving"]').click();
  await expect(page.locator(".stash")).toContainText("顧客台帳 › 顧客");
  await expect(page.locator(".stash")).toContainText("まだ反映していない行 2 行");
  // スプシ側で行が増えた。反映の直前に読み直すので、増えた行も箱になる
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

// 何行目が列名かはシートによる: 表題・グループ名(口座情報)の行があっても列名の行を推定し、選び直せる。複数の列を同じ項目にまとめられる
test("列名の行を選び、複数の列を同じ項目にまとめる", async ({ page }) => {
  await page.route("**/three.min.js", (r) => r.fulfill({ path: "node_modules/three/build/three.min.js", contentType: "text/javascript" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.nv[data-go="import"]').click();
  await page.locator("#newName").fill("顧客台帳");
  await page.locator("#newData").fill("顧客一覧,,,,\n,,,口座情報,\n顧客番号,PartyID,法人名,銀行名,支店名\n0001,,法人C,みずほ,本店\n,P-9,法人D,りそな,新宿");
  await page.locator("#read").click();
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
  // 名前で探すと、そのキューブの中(無地)に入り、戻るボタンで世界に戻る
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
  // 立体で見る: カレンダーの並びのままキューブにする(上の帯だけ残る)
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

// スプシのリンクを読んだら、シート(タブ)ごとに何にするか(シートとしてキューブへ・1行ずつ箱・1行ずつキューブ・まだ使わない)と入れる先を選ぶ
test("読み取ったシートごとに、何にするかと入れる先を選ぶ", async ({ page }) => {
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
  await expect(page.locator("#bookSec")).toBeVisible();
  // 売上はシートとしてキューブ S-02 へ、顧客は1行ずつ箱にして代理店「東京ネット販売」の中へ、メモはまだ使わない
  await page.locator('[data-dest="0"]').selectOption("c2");
  await page.locator('[data-act="1"]').selectOption("box");
  await page.locator('[data-dest="1"]').selectOption("a1");
  await page.locator('[data-act="2"]').selectOption("none");
  await expect(page.locator('[data-dest="2"]')).toHaveCount(0);
  await page.locator("#bookGo").click();
  // 1枚目: 売上をキューブ S-02 に承認
  await expect(page.locator("#matchSec")).toBeVisible();
  await expect(page.locator("#pCube")).toHaveValue("c2");
  await expect(page.locator("#queueInfo")).toContainText("行から作るもの 1 枚");
  await page.locator("#approve").click();
  // 2枚目: 顧客の行から箱(入れる先は選んだ箱)
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
