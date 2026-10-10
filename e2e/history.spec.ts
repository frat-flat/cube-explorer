import { expect, test } from "@playwright/test";
import { copyFixture, importFixture, removeFixture } from "./support";

// 履歴(/history)と読み取り API(history・boxes)。手元のデータベースと試験用のスプシで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/history.spec.ts
// (P2 の前半で e2e/home.spec.ts にあった履歴の試験を、ホームを作り替えたときにここへ移した。内容は同じ)
// 手元のデータベースには前の試験の取り込みも残るので、数は「API の値と画面の値が同じ」で確かめる。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
const stamp = Date.now();
const id = `e2e-history-${stamp}`; // 売上・精算額(店舗別売上(試験用)。タブは 2026年度 と メモ の 2 枚)

type HistoryItem = { id: string; at: string; kind: string; title: string; sheetId: string | null; definitionId: string | null; lines: string[] };
type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };

test.describe("履歴・API", () => {
  test.beforeAll(() => copyFixture(id));
  test.afterAll(() => removeFixture(id));

  test("取り込むと、履歴のいちばん上に「取り込み」の記録が出る(新しい順)。取り込みの記録からは Import へ移れる", async ({ page }) => {
    test.setTimeout(120_000);
    await importFixture(page, id);
    const first = ((await (await page.request.get("/api/4db/history?limit=1")).json()) as HistoryPage).items[0];
    expect(first.title).toBe("「2026年度」を取り込んだ");
    expect(first.kind).toBe("import");
    await page.goto("/history");
    await expect(page).toHaveTitle("履歴 | 4DB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("履歴");
    await expect(page.getByRole("banner").getByText("履歴", { exact: true })).toBeVisible();
    const row = page.getByTestId("history-table").locator("tbody tr").first();
    await expect(row).toContainText("「2026年度」を取り込んだ");
    await expect(row.locator(".pill")).toHaveText("取り込み");
    await row.getByRole("link", { name: "Import を開く" }).click();
    await expect(page).toHaveURL(/\/migrate$/);
  });

  test("履歴: 50 件ずつ。「続きを読む」で古いものが足され、最後まで読める。種類は日本語。表の保存からは、その表を開いた Table へ移れる", async ({ page }) => {
    test.setTimeout(180_000);
    await importFixture(page, id); // 表を保存できるように、数値のあるデータを用意する
    const cat = await (await page.request.get("/api/4db/catalog")).json();
    const name = `試験 履歴 ${stamp}`;
    const saved = await page.request.post("/api/4db/sheet-definitions", { data: { name, request: { measureId: cat.measures[0].id, fn: "SUM", rows: null, columns: null, filters: [], sheetIds: null } } });
    expect(saved.ok()).toBe(true);
    const { id: definitionId } = (await saved.json()) as { id: string };

    // API で最後まで読んで、全件の並びを知る(50 件ずつ)
    const all: HistoryItem[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await page.request.get(`/api/4db/history?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.ok()).toBe(true);
      const p = (await res.json()) as HistoryPage;
      expect(p.items.length).toBeLessThanOrEqual(50);
      if (p.nextCursor) expect(p.items).toHaveLength(50);
      all.push(...p.items);
      cursor = p.nextCursor;
      if (!cursor) break;
    }
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((h) => h.id)).size).toBe(all.length);
    expect(all[0].title).toBe(`表「${name}」を保存した(版 1)`);

    // 画面: 最初は 50 件(全件が 50 以下ならその数)。続きを読むたびに 50 件ずつ増え、最後でボタンが消える
    await page.goto("/history");
    const rows = page.getByTestId("history-table").locator("tbody tr");
    await expect(rows).toHaveCount(Math.min(50, all.length));
    for (let shown = 50; shown < all.length; shown += 50) {
      await page.getByRole("button", { name: "続きを読む" }).click();
      await expect(rows).toHaveCount(Math.min(shown + 50, all.length));
    }
    await expect(page.getByRole("button", { name: "続きを読む" })).toHaveCount(0);
    await expect(rows).toHaveCount(all.length);
    // 並びは API と同じ(新しい順)
    const titles = await rows.locator("td:nth-child(3)").allInnerTexts();
    expect(titles.map((t) => t.split("\n")[0])).toEqual(all.map((h) => h.title));
    // 種類は日本語(取り込み・表の保存・その他のどれか)
    const kinds = new Set(await rows.locator(".pill").allInnerTexts());
    for (const k of kinds) expect(["取り込み", "表の保存", "その他"]).toContain(k);
    expect(kinds.has("取り込み")).toBe(true);
    expect(kinds.has("表の保存")).toBe(true);

    // 表の保存 → その表を開いた Table
    const row = rows.filter({ hasText: `表「${name}」を保存した(版 1)` });
    await expect(row.locator(".pill")).toHaveText("表の保存");
    await expect(row.getByRole("link", { name: "Table で開く" })).toHaveAttribute("href", `/table?def=${definitionId}`);
    await row.getByRole("link", { name: "Table で開く" }).click();
    await expect(page).toHaveURL(new RegExp(`/table\\?def=${definitionId}$`));
    await expect(page.getByRole("heading", { name: "Table", level: 1 })).toBeVisible();
    await expect(page.getByText(`「${name}」を開きました(版 1)`)).toBeVisible();
    await expect(page.getByLabel("表の名前")).toHaveValue(name);
  });

  test("API: limit の上限・形の違う問い合わせは断る(history・boxes)。親が見つからなければ 404", async ({ page }) => {
    const get = (path: string) => page.request.get(path);
    // history: limit は 100 まで(多い指定は丸める)。0・負・数でないもの・形の違う cursor・kind は 400
    const big = (await (await get("/api/4db/history?limit=100000")).json()) as HistoryPage;
    expect(big.items.length).toBeLessThanOrEqual(100);
    for (const bad of ["limit=0", "limit=-1", "limit=abc", "limit=1.5", "cursor=abc", "cursor=1;drop", "kind=Import", "kind=a-b"]) {
      const res = await get(`/api/4db/history?${bad}`);
      expect(res.status(), bad).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    // 履歴の kind で絞れる
    const imports = (await (await get("/api/4db/history?kind=import&limit=100")).json()) as HistoryPage;
    expect(imports.items.every((h) => h.kind === "import")).toBe(true);
    // boxes: limit は 200 まで。形の違うものは 400。親がないものは 404
    const boxes = (await (await get("/api/4db/boxes?limit=100000")).json()) as { parent: unknown; boxes: unknown[]; nextCursor: string | null };
    expect(boxes.parent).toBeNull();
    expect(boxes.boxes.length).toBeLessThanOrEqual(200);
    // NUL(%00)の入った q・unitType・cursor は 500 ではなく 400。history の cursor・kind も
    for (const bad of ["limit=0", "limit=x", "parent=abc", "parent=ROOT", "cursor=!!!", "cursor=bm90LWpzb24", "q=%00", "q=a%00b", "unitType=%00", "cursor=%00"]) {
      const res = await get(`/api/4db/boxes?${bad}`);
      expect(res.status(), bad).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    for (const bad of ["cursor=1%00", "kind=a%00"]) expect((await get(`/api/4db/history?${bad}`)).status(), bad).toBe(400);
    expect((await get("/api/4db/boxes?parent=00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    expect((await get("/api/4db/boxes?parent=root&limit=1")).status()).toBe(200);
    // cursor は Box の id(uuid)。続きの Box は前のページと重ならない。この workspace にない Box の id は、存在を知らせない同じ 400
    const p1 = (await (await get("/api/4db/boxes?limit=1")).json()) as { boxes: { id: string }[]; nextCursor: string | null };
    if (p1.nextCursor) {
      expect(p1.nextCursor).toBe(p1.boxes[0].id);
      const p2 = (await (await get(`/api/4db/boxes?limit=1&cursor=${p1.nextCursor}`)).json()) as { boxes: { id: string }[] };
      expect(p2.boxes).toHaveLength(1);
      expect(p2.boxes[0].id).not.toBe(p1.boxes[0].id);
    }
    const ghost = await get("/api/4db/boxes?cursor=00000000-0000-4000-8000-000000000000");
    expect(ghost.status()).toBe(400);
    expect(await ghost.json()).toEqual({ error: "cursor が見つかりません。最初から読み直してください" });
  });

  test("履歴が空のとき、文が出る。履歴の API が失敗したとき、エラーが出る", async ({ page }) => {
    await page.route("**/api/4db/history*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
    await page.goto("/history");
    await expect(page.getByText("まだ履歴はありません。取り込みや表の保存をすると、ここに記録されます。")).toBeVisible();
    await page.unroute("**/api/4db/history*");
    await page.route("**/api/4db/history*", (route) => route.fulfill({ status: 503, json: { error: "4DB のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)", code: "not_configured" } }));
    await page.goto("/history");
    await expect(page.locator("main").getByRole("alert")).toContainText("4DB のデータベースがまだ設定されていません");
  });

  test("ホームの API の旧形(summary)は外れた: GET /api/4db/summary は 404。summary を呼ぶ画面はない", async ({ page }) => {
    expect((await page.request.get("/api/4db/summary")).status()).toBe(404);
    const apis: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/")) apis.push(u.pathname);
    });
    for (const path of ["/", "/history", "/tasks", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(apis.filter((p) => p.includes("summary"))).toEqual([]);
  });
});
