import { expect, test } from "@playwright/test";

// ログインでコードの送信・確認の通信が失敗したとき、ボタンが「送信中…」のまま止まらず、元に戻ってエラーが出る(以前の不具合)。
// ログインの設定を空にした npm run dev(または scripts/dev-fourdb.mjs)で動かす。/api/auth/ への通信を止めたり、エラーで返したりして試す。
// E2E_4DB_URL があれば、そのサーバーを相手にする(なければ playwright.config.ts の localhost:3000)
test.use({ baseURL: process.env.E2E_4DB_URL ?? "http://localhost:3000" });

const ADDRESS = "someone@example.com";

/** 画面の準備(hydration)が終わってから入力する(終わる前の入力や送信は、効かない・消える) */
async function fillEmail(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#email");
    return Boolean(el) && Object.keys(el!).some((k) => k.startsWith("__reactProps"));
  });
  const email = page.getByLabel("メールアドレス");
  await email.fill(ADDRESS);
  await expect(email).toHaveValue(ADDRESS);
}

test.describe("ログイン: 通信が失敗したとき", () => {
  test("コードの送信の通信が失敗(止められた)しても、ボタンが元に戻り、何が起きたかと次にすることが出る", async ({ page }) => {
    await page.route("**/api/auth/**", (route) => route.abort("failed"));
    await page.goto("/login");
    await fillEmail(page);
    const send = page.getByRole("button", { name: "ログイン用のコードを送る" });
    await send.click();
    // ボタンは「送信中…」のまま止まらず、元の文字・押せる状態に戻る
    await expect(send).toBeEnabled();
    await expect(page.getByRole("button", { name: "送信中…" })).toHaveCount(0);
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("コードを送れませんでした");
    await expect(alert).toContainText("通信できなかったようです");
    await expect(alert).toContainText("もう一度送ってください");
    // 入力は残り、もう一度押せる(まだメールアドレスの段階)
    await expect(page.getByLabel("メールアドレス")).toHaveValue(ADDRESS);
    await send.click();
    await expect(send).toBeEnabled();
    await expect(alert).toContainText("コードを送れませんでした");
  });

  test("サーバーが断った(400)ときは、ボタンが元に戻り、メールアドレスを確かめるよう知らせる(上流の文はそのまま見せない)", async ({ page }) => {
    // 上流が返す文(内部の事情・英語)が画面に出ないことを、目印の語で確かめる
    await page.route("**/api/auth/**", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "boom-upstream-detail", code: "SECRET_INTERNAL_CODE" }) }));
    await page.goto("/login");
    await fillEmail(page);
    const send = page.getByRole("button", { name: "ログイン用のコードを送る" });
    await send.click();
    await expect(send).toBeEnabled();
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toHaveText("コードを送れませんでした。メールアドレスを確かめて、もう一度送ってください。");
    await expect(page.locator("main")).not.toContainText("boom-upstream-detail");
    await expect(page.locator("main")).not.toContainText("SECRET_INTERNAL_CODE");
  });

  // L-1: サーバー側の失敗(500・503)なのに「メールアドレスを確かめて」と出ていた。原因に合う文にする
  for (const status of [500, 502, 503]) {
    test(`サーバー側の失敗(${status})のときは、サーバー側の問題と知らせる。メールアドレスのせいにしない。上流の文は出さない`, async ({ page }) => {
      await page.route("**/api/auth/**", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: "boom-upstream-detail", code: "SECRET_INTERNAL_CODE" }) }));
      await page.goto("/login");
      await fillEmail(page);
      const send = page.getByRole("button", { name: "ログイン用のコードを送る" });
      await send.click();
      await expect(send).toBeEnabled();
      const alert = page.locator("main").getByRole("alert");
      await expect(alert).toHaveText("コードを送れませんでした。サーバー側で問題が起きているようです。しばらく待ってから、もう一度送ってください。");
      await expect(alert).not.toContainText("メールアドレス");
      await expect(page.locator("main")).not.toContainText("boom-upstream-detail");
      await expect(page.locator("main")).not.toContainText("SECRET_INTERNAL_CODE");
    });
  }

  test("送りすぎ(429)のときは、しばらく待つよう知らせる。上流の文は出さない", async ({ page }) => {
    await page.route("**/api/auth/**", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ message: "Too many requests: boom-upstream-detail" }) }));
    await page.goto("/login");
    await fillEmail(page);
    const send = page.getByRole("button", { name: "ログイン用のコードを送る" });
    await send.click();
    await expect(send).toBeEnabled();
    await expect(page.locator("main").getByRole("alert")).toHaveText("コードを送れませんでした。しばらく待ってから、もう一度送ってください。");
    await expect(page.locator("main")).not.toContainText("boom-upstream-detail");
  });

  test("コードが違う(サーバーが断った)ときは、「コードが違うか…」と知らせ、ボタンが元に戻る(通信の失敗とは別の文。上流の文は出さない)", async ({ page }) => {
    await page.route("**/api/auth/**", (route) => {
      if (route.request().url().includes("send-verification-otp")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "boom-upstream-detail", code: "INVALID_OTP" }) });
    });
    await page.goto("/login");
    await fillEmail(page);
    await page.getByRole("button", { name: "ログイン用のコードを送る" }).click();
    await page.getByLabel(/に届いた6桁のコード/).fill("000000");
    const signIn = page.getByRole("button", { name: "ログイン", exact: true });
    await signIn.click();
    await expect(signIn).toBeEnabled();
    await expect(page.locator("main").getByRole("alert")).toHaveText("コードが違うか、期限が切れています。もう一度確かめるか、コードを送り直してください。");
    await expect(page.locator("main")).not.toContainText("boom-upstream-detail");
  });

  // L-1: コードの確認が 429・500 で失敗しても「コードが違うか、期限が切れています」と出ていた。原因に合う文にする
  for (const [status, expected] of [
    [429, "ログインできませんでした。確認の回数が多すぎます。しばらく待ってから、もう一度試してください。"],
    [500, "ログインできませんでした。サーバー側で問題が起きているようです。しばらく待ってから、もう一度試してください。"],
    [503, "ログインできませんでした。サーバー側で問題が起きているようです。しばらく待ってから、もう一度試してください。"],
  ] as const) {
    test(`コードの確認が ${status} で失敗したときは、コードが違うとは言わず、原因に合う文を出す。ボタンが元に戻る。上流の文は出さない`, async ({ page }) => {
      await page.route("**/api/auth/**", (route) => {
        if (route.request().url().includes("send-verification-otp")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
        return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: "boom-upstream-detail" }) });
      });
      await page.goto("/login");
      await fillEmail(page);
      await page.getByRole("button", { name: "ログイン用のコードを送る" }).click();
      await page.getByLabel(/に届いた6桁のコード/).fill("000000");
      const signIn = page.getByRole("button", { name: "ログイン", exact: true });
      await signIn.click();
      await expect(signIn).toBeEnabled();
      const alert = page.locator("main").getByRole("alert");
      await expect(alert).toHaveText(expected);
      await expect(alert).not.toContainText("コードが違う");
      await expect(page.locator("main")).not.toContainText("boom-upstream-detail");
    });
  }

  test("コードの確認の通信が失敗しても、ボタンが元に戻り、エラーが出る", async ({ page }) => {
    // 送信は成功させて(中継を空の成功で返す)、コードの入力の段階へ進む
    await page.route("**/api/auth/**", (route) => {
      if (route.request().url().includes("send-verification-otp")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      return route.abort("failed");
    });
    await page.goto("/login");
    await fillEmail(page);
    await page.getByRole("button", { name: "ログイン用のコードを送る" }).click();
    const code = page.getByLabel(/に届いた6桁のコード/);
    await expect(code).toBeVisible();
    await code.fill("123456");
    const signIn = page.getByRole("button", { name: "ログイン", exact: true });
    await signIn.click();
    await expect(signIn).toBeEnabled();
    await expect(page.getByRole("button", { name: "確認中…" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toContainText("通信できなかったようです");
  });
});
