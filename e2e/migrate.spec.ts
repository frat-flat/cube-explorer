import { copyFile, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// スプシから 4D Base へ移す画面(/migrate)。手元のデータベースと試験用のスプシで動いている画面を相手にする:
//   1) 手元の使い捨てデータベースに fourdb を作る(npm run fourdb:migrate。docs/deployment/ENVIRONMENT.md)
//   2) node scripts/dev-fourdb.mjs --fixture --port 3100 で起動する
//   3) E2E_4DB_URL=http://localhost:3100 npx playwright test e2e/migrate.spec.ts
// E2E_4DB_URL がなければ飛ばす(データベースのない所では動かせないため)
const BASE = process.env.E2E_4DB_URL;
const FIXTURES = "e2e/fixtures/sheets";
// 毎回まっさらなスプシとして試すため、試験用のスプシを別の ID で写す(新しく読んだスプシは一覧のいちばん上に来る)
const id = `e2e-${Date.now()}`;

test.describe("スプシから 4D Base へ移す", () => {
  test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
  test.beforeAll(async () => {
    await copyFile(`${FIXTURES}/fixture-uriage-2026.json`, `${FIXTURES}/${id}.json`);
  });
  test.afterAll(async () => {
    await rm(`${FIXTURES}/${id}.json`, { force: true });
  });

  test("リンクを読み、タブを取り込み、候補を確かめて反映し、照合が一致する。読み直して役割を直すと確かめの結果が変わる", async ({ page }) => {
    await page.goto(`${BASE}/migrate`);
    // 開いた直後(開発用のサーバーが画面を作っている間)は入力が効かないことがあるので、ボタンが押せるまで入れ直す
    await expect(async () => {
      await page.getByLabel("スプシのリンク").fill(`https://docs.google.com/spreadsheets/d/${id}/edit`);
      await expect(page.getByRole("button", { name: "読み取る" })).toBeEnabled({ timeout: 1000 });
    }).toPass();
    await page.getByRole("button", { name: "読み取る" }).click();
    await expect(page.getByText("「店舗別売上(試験用)」を読み取りました")).toBeVisible();
    // タブの一覧はスプシごとにまとまる(見出しにスプシの名前)
    await expect(page.getByText("スプシ「店舗別売上(試験用)」").first()).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "2026年度" }).filter({ hasText: "7 行 × 13 列" }).first();
    await row.getByRole("button", { name: "取り込む" }).click();
    await expect(page.getByRole("heading", { name: "2. 「2026年度」の承認(Saving)" })).toBeVisible();

    // 候補: 年度のタブ名から月、合計の列(足している列)、合計の行、計算された値
    await expect(page.getByLabel("D 列の月")).toHaveValue("2026-04");
    await expect(page.getByLabel("J 列の月")).toHaveValue("2026-09");
    await expect(page.getByLabel("G 列の役割")).toHaveValue("aggregate");
    await expect(page.getByLabel("L 列が足している列")).toHaveValue("G,K");
    await expect(page.getByText("7 行目を合計の行にする")).toBeVisible();
    await expect(page.getByText("関数で計算された値が 3 個あります")).toBeVisible();

    // 確かめてから反映する(確かめるまでは反映できない)
    await expect(page.getByRole("button", { name: "この内容で反映する" })).toBeDisabled();
    await page.getByRole("button", { name: "全行で確かめる" }).click();
    await expect(page.getByText("問題はありません")).toBeVisible();
    await page.getByRole("button", { name: "この内容で反映する" }).click();

    await expect(page.getByRole("heading", { name: "反映しました" })).toBeVisible();
    await expect(page.getByText("スプシの合計 19 個のうち 19 個が、4D Base が元の値から計算した合計と一致しました")).toBeVisible();
    await expect(row.getByText("取り込み済み(移行中)")).toBeVisible();
    await expect(page.getByRole("cell", { name: "7 行目(合計の行)" })).toBeVisible();

    // 読み直し: 合計の列(Q1計)を数値の列にすると、合計の関数のセルは値にせず知らせる(二重に数えない)
    await row.getByRole("button", { name: "読み直す" }).click();
    await expect(page.getByLabel("G 列の役割")).toHaveValue("aggregate");
    await page.getByLabel("G 列の役割").selectOption("measure");
    await page.getByRole("button", { name: "全行で確かめる" }).click();
    await expect(page.getByText("入れずに知らせるセルが 3 個あります")).toBeVisible();
  });
});
