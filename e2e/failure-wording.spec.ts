import { expect, test, type Page } from "@playwright/test";

// 共有の api()(src/app/(app)/api.ts)を使う画面(履歴・Task・ホーム)の、読み込みに失敗したときの文。手元のデータベースで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/failure-wording.spec.ts
// api() は、API が返した文(error)があればそれを、なければ「うまくいきませんでした(<状態の番号>)」を出す。M-4 の直しで、成功(200)でも本文が空・JSON でない・null なら、
// 成功として画面に渡さず、同じ「うまくいきませんでした(200)」の失敗にする。ここでは、3 つの画面で、返事ごとの文が同じで、画面が壊れない(ページの例外が出ない)ことを確かめる。
// Table は sheet.spec.ts(集計の返事が 200 で本文が空)で確かめる。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 90_000 });

const SERVER_TEXT = "処理できませんでした。少し時間をおいてもう一度試してください";

type Reply = { status: number; body: string; contentType: string };
const REPLIES: { name: string; reply: Reply; expected: string }[] = [
  { name: "500 と API の文(error)", reply: { status: 500, body: JSON.stringify({ error: SERVER_TEXT }), contentType: "application/json" }, expected: SERVER_TEXT },
  { name: "503 と API の文と code(未設定)", reply: { status: 503, body: JSON.stringify({ error: "4DB のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)", code: "not_configured" }), contentType: "application/json" }, expected: "4DB のデータベースがまだ設定されていません" },
  { name: "500 で文のない JSON({})", reply: { status: 500, body: "{}", contentType: "application/json" }, expected: "うまくいきませんでした(500)" },
  { name: "502 で HTML(JSON でない)", reply: { status: 502, body: "<html>bad gateway</html>", contentType: "text/html" }, expected: "うまくいきませんでした(502)" },
  { name: "404 で本文なし", reply: { status: 404, body: "", contentType: "text/plain" }, expected: "うまくいきませんでした(404)" },
  { name: "200 で本文が空", reply: { status: 200, body: "", contentType: "application/json" }, expected: "うまくいきませんでした(200)" },
  { name: "200 で本文が null", reply: { status: 200, body: "null", contentType: "application/json" }, expected: "うまくいきませんでした(200)" },
  { name: "200 で JSON でない本文", reply: { status: 200, body: "<html>not json</html>", contentType: "text/html" }, expected: "うまくいきませんでした(200)" },
];

const SCREENS: { name: string; path: string; api: string; alert: (page: Page) => ReturnType<Page["locator"]> }[] = [
  { name: "履歴", path: "/history", api: "**/api/4db/history*", alert: (page) => page.locator("main").getByRole("alert") },
  { name: "Task", path: "/tasks", api: "**/api/4db/tasks", alert: (page) => page.locator("main").getByRole("alert") },
  { name: "ホーム", path: "/", api: "**/api/4db/home", alert: (page) => page.getByRole("alert") },
];

for (const screen of SCREENS) {
  test.describe(`${screen.name}: 読み込めなかったときの文`, () => {
    for (const { name, reply, expected } of REPLIES) {
      test(`${name} → 「${expected}」を出し、画面は壊れない`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(screen.api, (route) => route.fulfill({ status: reply.status, body: reply.body, contentType: reply.contentType }));
        await page.goto(screen.path);
        const alert = screen.alert(page).filter({ hasText: expected });
        await expect(alert).toBeVisible({ timeout: 30_000 });
        // 文は 1 つだけ(二重に出ない)。ほかの失敗の文(別の状態の番号)に化けない
        await expect(alert).toHaveCount(1);
        if (screen.path === "/") await expect(page.locator("section[data-mode]")).toHaveAttribute("data-mode", "error");
        await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
        expect(errors, "ページの例外").toEqual([]);
      });
    }

    test("読めたとき(本物のサーバー)は、失敗の文を出さない", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(screen.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      await expect(screen.alert(page).filter({ hasText: /うまくいきませんでした|処理できませんでした/ })).toHaveCount(0);
      expect(errors, "ページの例外").toEqual([]);
    });
  });
}
