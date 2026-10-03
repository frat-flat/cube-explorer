import { expect, test } from "@playwright/test";

// スプリント1の完了条件:「店舗 × 月(奥行き:商品カテゴリを集約)」の売上合計が表で見られ、
// 行・列・奥行きの軸を入れ替えられる
test("店舗 × 月 の売上合計を表示し、軸を入れ替えられる", async ({ page }) => {
  await page.goto("/");
  const face = page.getByTestId("face");

  // 既定:行=店舗、列=月、奥行き=商品カテゴリを集約
  await expect(page.getByText("店舗 × 月 ／ 奥行き:商品カテゴリを集約")).toBeVisible();
  await expect(face.getByRole("rowheader", { name: "A店" })).toBeVisible();
  await expect(face.getByRole("columnheader", { name: "2025年10月" })).toBeVisible();
  await expect(face.getByRole("row", { name: /^A店/ }).getByRole("cell").first()).toHaveText("2,113,600");

  // 回転:行と列を入れ替える
  await page.getByRole("button", { name: "行と列を入れ替える" }).click();
  await expect(page.getByText("月 × 店舗 ／ 奥行き:商品カテゴリを集約")).toBeVisible();
  await expect(face.getByRole("rowheader", { name: "2025年10月" })).toBeVisible();

  // 回転:列と奥行きを入れ替える(列=商品カテゴリ、奥行き=店舗)
  await page.getByRole("button", { name: "列と奥行きを入れ替える" }).click();
  await expect(page.getByText("月 × 商品カテゴリ ／ 奥行き:店舗を集約")).toBeVisible();
  await expect(face.getByRole("columnheader", { name: "飲料" })).toBeVisible();

  // 断面:奥行き(店舗)を A店 で切る
  await page.getByRole("button", { name: "断面" }).click();
  await expect(page.getByLabel("断面の値")).toHaveValue("S001");
  await expect(page.getByText("奥行き:店舗「A店」で断面")).toBeVisible();

  // 軸の入れ替え:奥行きを別の軸(商品)に置き換える
  await page.getByLabel("奥行き", { exact: true }).selectOption("product");
  await expect(page.getByText("月 × 商品カテゴリ ／ 奥行き:商品を集約")).toBeVisible();
});
