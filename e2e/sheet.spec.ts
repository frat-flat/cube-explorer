import { copyFile, rm } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// 表で見る画面(/sheet、Projected Sheet)。e2e/migrate.spec.ts と同じく、手元のデータベースと試験用のスプシで動いている画面を相手にする:
//   E2E_4DB_URL=http://localhost:3100 npx playwright test e2e/sheet.spec.ts
// 手元のデータベースには前の試験の取り込みも残るので、この試験で取り込んだタブだけを「対象のタブ」で選んで確かめる。
// E2E_4DB_URL がなければ飛ばす(データベースのない所では動かせないため)
const BASE = process.env.E2E_4DB_URL;
const FIXTURES = "e2e/fixtures/sheets";
const id = `e2e-sheet-${Date.now()}`;
const BOOK = "店舗別売上(試験用)";

/** 試験用のスプシを /migrate で取り込み、照合が一致するところまで進める */
async function importFixture(page: Page) {
  await page.goto(`${BASE}/migrate`);
  // 開いた直後(開発用のサーバーが画面を作っている間)は入力が効かないことがあるので、ボタンが押せるまで入れ直す
  await expect(async () => {
    await page.getByLabel("スプシのリンク").fill(`https://docs.google.com/spreadsheets/d/${id}/edit`);
    await expect(page.getByRole("button", { name: "読み取る" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByText(`「${BOOK}」を読み取りました`)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "2026年度" }).filter({ hasText: "7 行 × 13 列" }).first();
  await row.getByRole("button", { name: "取り込む" }).click();
  await page.getByRole("button", { name: "全行で確かめる" }).click();
  await expect(page.getByText("問題はありません")).toBeVisible();
  await page.getByRole("button", { name: "この内容で反映する" }).click();
  await expect(page.getByText("スプシの合計 19 個のうち 19 個が、4D Base が元の値から計算した合計と一致しました")).toBeVisible();
}

/** 表の「Σ 総計」の行 */
const grandRow = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Σ 総計" }) });

test.describe("表で見る(Projected Sheet)", () => {
  test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
  test.beforeAll(async () => {
    await copyFile(`${FIXTURES}/fixture-uriage-2026.json`, `${FIXTURES}/${id}.json`);
  });
  test.afterAll(async () => {
    await rm(`${FIXTURES}/${id}.json`, { force: true });
  });

  test("取り込んだタブを表で見る: 総計がスプシと同じ、段の切り替え・入れ替え・小計・計算された値の印・絞り込み・保存と開き直し", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page);
    await page.getByRole("link", { name: "取り込んだデータを表で見る" }).click();
    await expect(page.getByRole("heading", { name: "表で見る" })).toBeVisible();

    // この試験で取り込んだタブだけにする(新しく読んだスプシがいちばん上)
    await page.getByText(/すべてのタブ/).click();
    await page.getByLabel(`${BOOK} の 2026年度`).first().check();
    await expect(page.getByText("選んだタブ 1 個")).toBeVisible();

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
    const name = `試験 ${id}`;
    await page.getByLabel("表の名前").fill(name);
    await page.getByRole("button", { name: "新しく保存" }).click();
    await expect(page.getByText(`「${name}」を保存しました(版 1)`)).toBeVisible();

    await page.reload();
    await page.getByLabel("保存した表を開く").selectOption({ label: `${name}(版 1)` });
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "売上 の合計" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Σ 小計 2026-Q2" })).toBeVisible();
    await expect(page.getByText("選んだタブ 1 個")).toBeVisible();
    await expect(grandRow(page)).toContainText("750");

    await page.getByRole("button", { name: "上書き保存" }).click();
    await expect(page.getByText(`「${name}」を保存しました(版 2)`)).toBeVisible();
  });
});

/** 「数値」を名前で選ぶ(選択肢にはタブの数が付き、前の試験の取り込みで変わるため、名前の始まりで探す) */
async function selectMeasure(page: Page, name: string) {
  const select = page.getByLabel("数値");
  const value = await select.locator("option", { hasText: new RegExp(`^${name}\\(`) }).getAttribute("value");
  await select.selectOption(value!);
}
