import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Table の画面(/table。以前は /sheet。中の名前は Projected Sheet)。e2e/migrate.spec.ts と同じく、手元のデータベースと試験用のスプシで動いている画面を相手にする:
//   E2E_4DB_URL=http://localhost:3100 npx playwright test e2e/sheet.spec.ts
// 手元のデータベースには前の試験の取り込みも残るので、この試験で取り込んだシートだけを「対象のシート」で選んで確かめる。
// E2E_4DB_URL がなければ飛ばす(データベースのない所では動かせないため)
const BASE = process.env.E2E_4DB_URL;
const FIXTURES = "e2e/fixtures/sheets";
const stamp = Date.now();
const id = `e2e-sheet-${stamp}`; // 売上・精算額(店舗別売上(試験用)の 2026年度)
const id2 = `e2e-sheet-keihi-${stamp}`; // 経費(店舗別経費(試験用)の 2026年度)。数値の一覧をシートで絞る試験で使う
const id3 = `e2e-sheet-gone-${stamp}`; // あとで数値の列を「使わない」に読み直す(その数値は、データ全体からなくなる)
const GONE = `消える数値${stamp}`; // id3 の数値の名前(この試験だけの名前にして、ほかの取り込みにはない数値にする)
const BOOK = "店舗別売上(試験用)";
const BOOK2 = "店舗別経費(試験用)";
const LINK = "ファイル(Google スプレッドシート)のリンク";

/** 試験用のファイルを /migrate で取り込み、反映するところまで進める。rowsCols = 一覧での大きさ(同じ名前のシートを見分けるため) */
async function importFixture(page: Page, fileId: string, rowsCols: string) {
  await page.goto(`${BASE}/migrate`);
  // 開いた直後(開発用のサーバーが画面を作っている間)は入力が効かないことがあるので、ボタンが押せるまで入れ直す
  await expect(async () => {
    await page.getByLabel(LINK).fill(`https://docs.google.com/spreadsheets/d/${fileId}/edit`);
    await expect(page.getByRole("button", { name: "読み取る" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "読み取る" }).click();
  // 新しく読んだファイルは一覧のいちばん上に来る
  const row = page.getByRole("row").filter({ hasText: "2026年度" }).filter({ hasText: rowsCols }).first();
  // 同じ試験用のファイルを前の試験で取り込んでいれば、ボタンは「読み直す」になる
  await row.getByRole("button", { name: /^(取り込む|読み直す)$/ }).click();
  await page.getByRole("button", { name: "全行で確かめる" }).click();
  await expect(page.getByText("問題はありません")).toBeVisible();
  await page.getByRole("button", { name: "この内容で反映する" }).click();
  await expect(page.getByText("が、4DB が元の値から計算した合計と一致しました")).toBeVisible();
}

/** 表の「Σ 総計」の行 */
const grandRow = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Σ 総計" }) });

test.describe("Table(Projected Sheet)", () => {
  test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
  test.beforeAll(async () => {
    await copyFile(`${FIXTURES}/fixture-uriage-2026.json`, `${FIXTURES}/${id}.json`);
    await copyFile(`${FIXTURES}/fixture-keihi-2026.json`, `${FIXTURES}/${id2}.json`);
    // 経費の試験用ファイルの、数値のグループ名(2 行目の D 列)をこの試験だけの名前にする
    const keihi = JSON.parse(await readFile(`${FIXTURES}/fixture-keihi-2026.json`, "utf8"));
    keihi.tabs[0].rows[1][3] = GONE;
    await writeFile(`${FIXTURES}/${id3}.json`, JSON.stringify(keihi));
  });
  test.afterAll(async () => {
    await rm(`${FIXTURES}/${id}.json`, { force: true });
    await rm(`${FIXTURES}/${id2}.json`, { force: true });
    await rm(`${FIXTURES}/${id3}.json`, { force: true });
  });

  test("取り込んだシートを表で見る: 総計がスプシと同じ、段の切り替え・入れ替え・小計・計算された値の印・絞り込み・保存と開き直し", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page, id, "7 行 × 13 列");
    await page.getByRole("link", { name: "取り込んだデータを表で見る" }).click();
    await expect(page).toHaveURL(/\/table$/);
    await expect(page).toHaveTitle("Table | 4DB");
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();

    // この試験で取り込んだシートだけにする(新しく読んだファイルがいちばん上)
    await page.getByText(/すべてのシート/).click();
    await page.getByLabel(`${BOOK} の 2026年度`).first().check();
    await expect(page.getByText("選んだシート 1 個")).toBeVisible();
    await expect(page.getByText(`ファイル「${BOOK}」`).first()).toBeVisible();

    // 店舗 × 月: 明細と、Σ の合計の列・総計の行。総計はスプシの合計の行(7 行目の L 列)と同じ 1,410
    await selectMeasure(page, "売上");
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Σ 合計" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "S-01" })).toContainText("750");
    await expect(grandRow(page)).toContainText("1,410");

    // 段を上げる: 月 → 四半期(スプシの Q1計 330・Q2計 420 と同じ。名前は暦の四半期)
    await page.getByLabel("列の段").selectOption("1");
    await expect(page.getByRole("columnheader", { name: "2026-Q2" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "S-01" })).toContainText(/330\s*420\s*750/);
    await expect(grandRow(page)).toContainText("1,410");

    // 行と列を入れ替える
    await page.getByRole("button", { name: "行と列を入れ替える" }).click();
    await expect(page.getByRole("rowheader", { name: "2026-Q2" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "S-01" })).toBeVisible();
    await expect(grandRow(page)).toContainText("1,410");

    // 小計: 行を月にして、四半期ごとに Σ の小計の行を入れる(小計は軸の値の行ではない)
    await page.getByLabel("行の段").selectOption("2");
    await page.getByLabel("小計の段").selectOption("1");
    await expect(page.getByRole("rowheader", { name: "Σ 小計 2026-Q2" })).toBeVisible();
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Σ 小計 2026-Q2" }) })).toContainText("570");
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Σ 小計 2026-Q3" }) })).toContainText("840");
    await expect(grandRow(page)).toContainText("1,410");

    // 計算された値(精算額 = スプシの関数)には ƒ の印。675 + 405 + 189 = 1,269
    await selectMeasure(page, "精算額");
    await expect(page.getByRole("heading", { name: "精算額 の合計" })).toBeVisible();
    await expect(grandRow(page)).toContainText("1,269");
    await expect(grandRow(page)).toContainText("ƒ");

    // 絞り込み: 売上を S-01 だけ(750)
    await selectMeasure(page, "売上");
    await page.getByLabel("絞り込む軸を足す").selectOption({ label: "店舗コード" });
    await page.getByLabel("店舗コードを名前で探す").fill("S-01");
    await page.getByRole("checkbox", { name: "S-01" }).check();
    await expect(grandRow(page)).toContainText("750");

    // 名前を付けて保存し、開き直すと同じ表になる。上書きすると版が上がる
    const name = `試験 ${stamp}`;
    await page.getByLabel("表の名前").fill(name);
    await page.getByRole("button", { name: "新しく保存" }).click();
    await expect(page.getByText(`「${name}」を保存しました(版 1)`)).toBeVisible();

    await page.reload();
    await page.getByLabel("保存した表を開く").selectOption({ label: `${name}(版 1)` });
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Σ 小計 2026-Q2" })).toBeVisible();
    await expect(page.getByText("選んだシート 1 個")).toBeVisible();
    await expect(grandRow(page)).toContainText("750");

    await page.getByRole("button", { name: "上書き保存" }).click();
    await expect(page.getByText(`「${name}」を保存しました(版 2)`)).toBeVisible();
  });

  test("数値の一覧は選んだシートで絞られる。選んでいる数値がそのシートにないときは知らせ、別の数値に切り替えない", async ({ page }) => {
    test.setTimeout(180_000);
    await importFixture(page, id, "7 行 × 13 列");
    await importFixture(page, id2, "5 行 × 6 列"); // 後に取り込んだ経費のファイルが一覧のいちばん上になる
    await page.goto(`${BASE}/table`);
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    await page.getByText(/すべてのシート/).click();

    const optionsOf = () => page.getByLabel("数値").locator("option").allTextContents();
    const salesSheet = page.getByLabel(`${BOOK} の 2026年度`).first();
    const costSheet = page.getByLabel(`${BOOK2} の 2026年度`).first();

    // 売上のシートだけ: 売上・精算額があり、経費はない。添え書きは「(シート N 個)」
    await salesSheet.check();
    await expect(page.getByText("選んだシート 1 個")).toBeVisible();
    await expect.poll(optionsOf).toEqual(expect.arrayContaining(["売上(シート 1 個)", "精算額(シート 1 個)"]));
    expect((await optionsOf()).some((t) => t.startsWith("経費"))).toBe(false);
    await selectMeasure(page, "売上");
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();

    // 経費のシートも選ぶと、数値の一覧に経費が加わる
    await costSheet.check();
    await expect(page.getByText("選んだシート 2 個")).toBeVisible();
    await expect.poll(optionsOf).toEqual(expect.arrayContaining(["売上(シート 1 個)", "経費(シート 1 個)", "精算額(シート 1 個)"]));

    // 売上のシートを外して経費のシートだけにすると、選んでいる売上がないので知らせる。別の数値には切り替えない
    await salesSheet.uncheck();
    await expect(page.getByText("選んだシート 1 個")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "選んだシートには『売上』がありません。数値かシートを選び直してください" })).toBeVisible();
    const salesValue = await page.getByLabel("数値").locator("option", { hasText: /^売上$/ }).getAttribute("value");
    await expect(page.getByLabel("数値")).toHaveValue(salesValue!);
    await expect(page.getByRole("heading", { name: /の合計$/ })).toHaveCount(0); // 売上の表は出さない(古い表を残さない)
    await expect(page.getByRole("button", { name: "新しく保存" })).toBeDisabled();

    // 数値を選び直すと、そのシートの表が出る
    await selectMeasure(page, "経費");
    await expect(page.getByRole("heading", { name: "経費 の合計" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "選んだシートには" })).toHaveCount(0);
    await expect(grandRow(page)).toContainText("78"); // 10+20+30 + 5+6+7

    // すべてのシートに戻すと、売上も選べる
    await page.getByRole("button", { name: "すべてのシートにする" }).click();
    await expect(page.getByText(/すべてのシート\(\d+ 個\)/)).toBeVisible();
    expect((await optionsOf()).some((t) => t.startsWith("売上("))).toBe(true);
  });

  test("1280×800 で、左に組み方の欄(畳める)・右に結果。読み込んだあと、結果の表の見出しが最初の画面に見える", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page, id, "7 行 × 13 列");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/table`);
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    // 読み込んだ(いちばん上に出る最初の表)あと、スクロールなしで表の見出し行と最初の行が見える(横に長い表は表の中で動く)
    const header = page.locator("table.table thead th").first();
    await expect(header).toBeVisible();
    await expect(header).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("rowheader").first()).toBeInViewport({ ratio: 1 }); // 最初の行(行は横に長いので、行の見出しで見る)
    expect(await page.evaluate(() => document.querySelector(".content")!.scrollTop)).toBe(0);

    // 結果の枠は、短い表の下に空きを作らず、表の高さに合わせる(表が低いので、枠は画面の下まで伸びない)
    const card = (await page.locator("section.card", { has: page.getByRole("heading", { name: /の合計$/ }) }).boundingBox())!;
    const wrap = (await page.locator("section.card .tableWrap").boundingBox())!;
    const tbl = (await page.locator("section.card table.table").boundingBox())!;
    expect(wrap.height - tbl.height, "表の入れ物は表の高さに合う").toBeLessThan(24);
    expect(card.y + card.height - (wrap.y + wrap.height), "枠の下に空きがない").toBeLessThan(40);
    expect(card.y + card.height).toBeLessThan(700);

    // 左(組み方)・右(結果)の並び
    const setup = await page.locator("#table-setup").boundingBox();
    const result = await page.getByRole("heading", { name: /の合計$/ }).boundingBox();
    expect(setup && result && setup.x + setup.width <= result.x).toBe(true);

    // 組み方の欄を畳むと、結果だけが広がる。開き直すと戻る
    const before = await page.locator("table.table").boundingBox();
    await page.getByRole("button", { name: "組み方の欄を畳む" }).click();
    await expect(page.locator("#table-setup")).toBeHidden();
    const after = await page.locator("table.table").boundingBox();
    expect(after!.x).toBeLessThan(before!.x);
    await page.getByRole("button", { name: "組み方の欄を開く" }).click();
    await expect(page.locator("#table-setup")).toBeVisible();
  });

  test("保存した表の数値が、あとで読み直した取り込みでなくなっていたら、開いたときに知らせる(別の数値に切り替えず、表を出さず、保存もできない)", async ({ page }) => {
    test.setTimeout(180_000);
    await importFixture(page, id3, "5 行 × 6 列");
    await page.goto(`${BASE}/table`);
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    await page.getByText(/すべてのシート/).click();
    await page.getByLabel(`${BOOK2} の 2026年度`).first().check(); // 新しく取り込んだファイルがいちばん上
    await selectMeasure(page, GONE);
    await expect(page.getByRole("heading", { name: `${GONE} の合計` })).toBeVisible();
    const name = `試験 数値がなくなる ${stamp}`;
    await page.getByLabel("表の名前").fill(name);
    await page.getByRole("button", { name: "新しく保存" }).click();
    await expect(page.getByText(`「${name}」を保存しました(版 1)`)).toBeVisible();

    // 取り込みを読み直し、その数値の列(D〜F)を「使わない」にして反映する(数値は、データ全体からなくなる)
    await page.goto(`${BASE}/migrate`);
    const row = page.getByRole("row").filter({ hasText: "2026年度" }).filter({ hasText: "5 行 × 6 列" }).first();
    await row.getByRole("button", { name: "読み直す" }).click();
    for (const c of ["D", "E", "F"]) await page.getByLabel(`${c} 列の役割`).selectOption("ignore");
    await page.getByRole("button", { name: "全行で確かめる" }).click();
    await expect(page.getByText("問題はありません")).toBeVisible();
    await page.getByRole("button", { name: "この内容で反映する" }).click();
    await expect(page.getByRole("heading", { name: "反映しました" })).toBeVisible();

    // 保存した表を開く: その数値がないと、はっきり知らせる
    await page.goto(`${BASE}/table`);
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    await page.getByLabel("保存した表を開く").selectOption({ label: `${name}(版 1)` });
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    await expect(page.locator("main").getByRole("alert").filter({ hasText: `保存した表の数値『${GONE}』が見つかりません。数値を選び直してください。` })).toBeVisible();
    // 表は出さない・保存もできない・別の数値には切り替えない(選んでいる数値は、保存したままの名前で残る)
    await expect(page.getByRole("heading", { name: /の合計$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新しく保存" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "上書き保存" })).toBeDisabled();
    expect(await page.getByLabel("数値").evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex].text)).toBe(GONE);

    // 数値を選び直せば、表が出る(保存した表のシートにはもう数値がないので、すべてのシートに戻してから)
    await page.getByText(/選んだシート \d+ 個/).click(); // 折りたたみを開く
    await page.getByRole("button", { name: "すべてのシートにする" }).click();
    await selectMeasure(page, "売上");
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();
    await expect(page.locator("main").getByRole("alert").filter({ hasText: "見つかりません" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新しく保存" })).toBeEnabled();
  });

  test("保存した表のシートが一部なくなっているとき、折りたたみを開く前から知らせる", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page, id, "7 行 × 13 列");
    // 保存した表の定義に、今は見つからないシートの指定が混じっている状態を、API で作る
    const catalog = await (await page.request.get(`${BASE}/api/4db/catalog`)).json();
    const sales = catalog.measures.find((m: { name: string }) => m.name === "売上");
    const ghost = "00000000-0000-4000-8000-0000000000aa";
    const name = `試験 見つからないシート ${stamp}`;
    const saved = await page.request.post(`${BASE}/api/4db/sheet-definitions`, {
      data: { name, request: { measureId: sales.id, fn: "SUM", rows: null, columns: null, filters: [], sheetIds: [ghost, sales.sheetIds[0]] } },
    });
    expect(saved.ok()).toBe(true);

    await page.goto(`${BASE}/table`);
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    await page.getByLabel("保存した表を開く").selectOption({ label: `${name}(版 1)` });
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    // 「対象のシート」の折りたたみは閉じたまま。知らせは、折りたたみの外にあり、見えている
    await expect(page.getByText("選んだシート 2 個")).toBeVisible();
    expect(await page.locator("details").evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    const notice = page.getByText("保存した表の指定に、今は見つからないシートがあります。");
    await expect(notice).toBeVisible();
    expect(await notice.evaluate((el) => el.closest("details"))).toBeNull();
    // 見つかるシートの分で、表は出る
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();
  });

  test("/table?def=<id>: 保存した表を開いた状態で出る(履歴からの移動)。id の形でないものは、ないものとして扱い、エラーを出さない", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page, id, "7 行 × 13 列");
    const catalog = await (await page.request.get(`${BASE}/api/4db/catalog`)).json();
    const sales = catalog.measures.find((m: { name: string }) => m.name === "売上");
    const name = `試験 def ${stamp}`;
    const saved = await page.request.post(`${BASE}/api/4db/sheet-definitions`, {
      data: { name, request: { measureId: sales.id, fn: "AVG", rows: null, columns: null, filters: [], sheetIds: [sales.sheetIds[0]] } },
    });
    expect(saved.ok()).toBe(true);
    const { id: defId } = (await saved.json()) as { id: string };

    // 開いた状態で出る: 名前・集計のしかた・対象のシートが保存したとおりで、初めの組み方に上書きされない
    await page.goto(`${BASE}/table?def=${defId}`);
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    await expect(page.getByLabel("表の名前")).toHaveValue(name);
    await expect(page.getByLabel("集計のしかた")).toHaveValue("AVG");
    await expect(page.getByText("選んだシート 1 個")).toBeVisible();
    await expect(page.getByRole("heading", { name: "売上 の平均" })).toBeVisible();
    await expect(page.getByRole("button", { name: "上書き保存" })).toBeEnabled();

    // 形の違う def・ない id・def なし: 開かない。「見つかりません」などのエラーも出さない(形の違うものは、そもそも API に渡さない)
    for (const q of ["?def=abc", "?def=", "?def=1&def=2", ""]) {
      await page.goto(`${BASE}/table${q}`);
      await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
      await expect(page.getByLabel("保存した表を開く")).toBeVisible();
      await expect(page.getByText("を開きました")).toHaveCount(0);
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    }
    // 形は正しいが、ない id: 開けなかったと知らせる(別の表を開いたりしない)
    await page.goto(`${BASE}/table?def=00000000-0000-4000-8000-0000000000bb`);
    await expect(page.getByText("表の定義が見つかりません")).toBeVisible();
    await expect(page.getByText("を開きました")).toHaveCount(0);
  });

  // L-2: 保存した表のシートがすべてなくなって、選べる数値が 1 つもないとき、選びようがないのに「数値を選び直してください」と出ていた。
  // 上の「まだ表にできるデータがありません」に任せる(データのない状態は、API の返事を差し替えて作る)
  test("表にできるデータが 1 つもないとき、保存した表を開いても「数値を選び直してください」とは出さない(「まだ表にできるデータがありません」だけ)", async ({ page }) => {
    const defId = "11111111-2222-4333-8444-555555555555";
    const ghostMeasure = "22222222-3333-4444-8555-666666666666";
    await page.route("**/api/4db/catalog", (route) => route.fulfill({ json: { measures: [], dimensions: [] } }));
    await page.route("**/api/4db/sheets", (route) => route.fulfill({ json: { sheets: [] } }));
    await page.route("**/api/4db/sheet-definitions", (route) => route.fulfill({ json: { definitions: [{ id: defId, name: "消えた表", version: 1, updated_at: "2026-10-08T00:00:00.000Z" }] } }));
    await page.route(`**/api/4db/sheet-definitions/${defId}`, (route) =>
      route.fulfill({
        json: { id: defId, name: "消えた表", version: 1, request: { measureId: ghostMeasure, fn: "SUM", rows: null, columns: null, filters: [], sheetIds: [ghostMeasure] }, filterMembers: [], measureName: "売上" },
      }),
    );
    await page.goto(`${BASE}/table?def=${defId}`);
    await expect(page.getByText("まだ表にできるデータがありません。")).toBeVisible();
    await expect(page.getByText("「消えた表」を開きました(版 1)")).toBeVisible(); // 開く処理は終わっている
    await expect(page.getByText("数値を選び直してください")).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });
});

/** 「数値」を名前で選ぶ(選択肢にはシートの数が付き、前の試験の取り込みで変わるため、名前の始まりで探す) */
async function selectMeasure(page: Page, name: string) {
  const select = page.getByLabel("数値");
  const value = await select.locator("option", { hasText: new RegExp(`^${name}(\\(|$)`) }).first().getAttribute("value");
  await select.selectOption(value!);
}
