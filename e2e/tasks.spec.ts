import { expect, test, type Page } from "@playwright/test";
import type { TaskOverview } from "@/fourdb/core/tasks";
import { applyImport, copyFixture, hydrated, openMenu, readFile, removeFixture, startImport, taskCount, watch } from "./support";

// Task(/tasks)とメニューの件数の印。手元のデータベースと試験用のスプシで動いている画面を相手にする(home.spec.ts と同じ起動):
//   E2E_4DB_URL=http://localhost:3200 npx playwright test e2e/tasks.spec.ts
// 本物のデータの試験は「取り込む前の API の値からの増え方」で確かめる(手元のデータベースには前の試験の取り込みも残るため)。
// 件数が 0 のとき・99 を超えるとき・通信の回数などは、API の答えを差し替えて(route)確かめる。
const BASE = process.env.E2E_4DB_URL;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE, "E2E_4DB_URL がないので飛ばす");
test.describe.configure({ timeout: 120_000 });

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const badgeOf = (page: Page) => page.locator('a[href="/tasks"] .nvbadge');
const stubCount = (page: Page, count: unknown, status = 200) => page.route("**/api/4db/tasks/count", (route) => route.fulfill({ status, json: { count } }));
const tokyoMinute = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false }).slice(0, 16);

const emptyOverview = (over: Partial<TaskOverview> = {}): TaskOverview => ({ count: 0, items: { items: [], more: 0 }, files: { items: [], more: 0 }, ...over });

test.describe("Task: 本物のデータ", () => {
  const stamp = Date.now();
  const id = `e2e-tasks-${stamp}`;
  const title = `Task試験 ${stamp}`;
  test.beforeAll(() => copyFixture(id, "fixture-uriage-2026.json", title));
  test.afterAll(() => removeFixture(id));

  test("読み取りを終えて承認待ちになると、Task に出て、メニューの印が 1 増える(Import の画面のままで)。反映すると、一覧から消え、印は元に戻り、進み具合は「取り込み済み」になる", async ({ page, context, request, baseURL }) => {
    const w = watch(page);
    const before = await taskCount(request);
    await readFile(page, id);
    const nav = await openMenu(page);
    const badge = nav.locator('a[href="/tasks"] .nvbadge');
    // ファイルを読んだだけ(シートを取り込んでいない)では、やることは増えない
    await expect(page.getByText(`ファイル「${title}」`).first()).toBeVisible();
    expect(await taskCount(request)).toBe(before);
    await startImport(page); // 読み取りが終わり、承認待ち
    await expect(badge).toHaveAttribute("aria-label", `${before + 1} 件`);
    expect(await taskCount(request), "API の件数").toBe(before + 1);
    await expect(badge).toHaveText(before + 1 > 99 ? "99+" : String(before + 1));
    await expect(badge).toHaveAttribute("role", "img");

    // 別のタブで Task を開く(Import の画面は承認の途中のまま)
    const second = await context.newPage();
    await second.goto("/tasks");
    await expect(second).toHaveTitle("Task | 4DB");
    await expect(second.getByRole("heading", { level: 1 })).toHaveText("Taskやること");
    await expect(second.getByRole("heading", { level: 1 }).locator("small")).toHaveText("やること");
    const api = (await (await request.get("/api/4db/tasks")).json()) as TaskOverview;
    expect(api.count).toBe(before + 1);
    const mine = api.items.items.find((t) => t.file === title)!;
    expect(mine, "API の一覧に今の取り込みがある").toBeTruthy();
    expect(mine.kind).toBe("approval");
    expect(mine.runStatus).toBe("staged");
    const item = second.getByTestId("task-item").filter({ hasText: title });
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute("data-kind", "approval");
    await expect(item.locator(".pill")).toHaveText("承認待ち");
    expect(norm(await item.innerText())).toContain(`${title} › 2026年度`);
    // 始めた日時は日本時間(YYYY-MM-DD HH:mm)。API の値を、ブラウザの時刻帯と関係なく別に直して比べる
    expect(norm(await item.locator("time").innerText())).toBe(tokyoMinute(mine.startedAt));
    expect(norm(await item.innerText())).toMatch(/開始 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(item.getByRole("link", { name: "Import で開く" })).toHaveAttribute("href", "/migrate");
    // 並びは API と同じ(承認待ちが先)。件数の印は、Task の画面が読んだ件数と同じ
    const kinds = await second.getByTestId("task-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds).toEqual(api.items.items.map((t) => t.kind));
    await openMenu(second);
    await expect(badgeOf(second)).toHaveAttribute("aria-label", `${api.count} 件`);
    // ファイルごとの進み具合: このファイルは「取り込みを始めたシート 1 枚(途中)」と「まだ始めていないシート 1 枚(メモ)」
    const file = second.getByTestId("file-progress-item").filter({ hasText: title });
    await expect(file).toHaveCount(1);
    await expect(file.getByText("途中", { exact: false }).first()).toBeVisible();
    for (const [bucket, n] of [["migrated", "0"], ["inProgress", "1"], ["imported", "0"], ["failed", "0"]] as const) {
      await expect(file.locator(`[data-bucket="${bucket}"] b`), bucket).toHaveText(n);
    }
    await expect(file).toContainText("まだ取り込みを始めていないシート 1 枚");
    await expect(second.getByText("取り込みを始めたシートで数えます。")).toBeVisible();
    await expect(second.getByRole("heading", { name: /移行の進み具合/ })).toBeVisible();

    // Import の画面で反映する → 印が元に戻る(反映し終えたとき)
    await applyImport(page);
    if (before === 0) await expect(badge).toHaveCount(0);
    else await expect(badge).toHaveAttribute("aria-label", `${before} 件`);
    expect(await taskCount(request)).toBe(before);
    // Task を読み直すと、一覧から消え、進み具合は「取り込み済み」
    await second.reload();
    await expect(second.getByTestId("task-item").filter({ hasText: title })).toHaveCount(0);
    const file2 = second.getByTestId("file-progress-item").filter({ hasText: title });
    for (const [bucket, n] of [["migrated", "0"], ["inProgress", "0"], ["imported", "1"], ["failed", "0"]] as const) {
      await expect(file2.locator(`[data-bucket="${bucket}"] b`), bucket).toHaveText(n);
    }
    if (before === 0) await expect(second.getByTestId("tasks-empty")).toHaveText("やることはありません。");
    expect(w.problems, "コンソールの error・warning").toEqual([]);
    await second.close();
    expect([...w.hosts].filter((h) => h !== new URL(baseURL!).host)).toEqual([]);
  });

  test("メニューの印は API の件数と同じ(開いたとき)。0 なら出ない", async ({ page, request }) => {
    const n = await taskCount(request);
    await page.goto("/settings");
    await hydrated(page);
    const nav = await openMenu(page);
    if (n === 0) await expect(nav.locator(".nvbadge")).toHaveCount(0);
    else await expect(nav.locator('a[href="/tasks"] .nvbadge')).toHaveAttribute("aria-label", `${n} 件`);
    // 印は Task の横だけ(ほかの項目にはない)
    await expect(nav.locator(".nvbadge")).toHaveCount(n === 0 ? 0 : 1);
  });
});

test.describe("メニューの件数の印(API の答えを差し替える)", () => {
  test("件数 3: Task の横に「3」(読み上げは「3 件」)。閉じた ☰ には出ない(メニューを閉じると見えない)", async ({ page }) => {
    await stubCount(page, 3);
    await page.goto("/settings");
    await hydrated(page);
    // メニューは閉じている: ☰ の中は「☰」だけ。印はメニューの中にしかない
    await expect(page.getByRole("button", { name: "メニューを開く" })).toHaveText("☰");
    await expect(page.locator("header .nvbadge")).toHaveCount(0);
    await expect(page.locator("header").locator('[aria-label$="件"]')).toHaveCount(0);
    await expect(badgeOf(page)).toBeHidden();
    // 開くと、Task の横に出る
    const nav = await openMenu(page);
    const badge = nav.locator('a[href="/tasks"] .nvbadge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("3");
    await expect(badge).toHaveAttribute("role", "img");
    await expect(badge).toHaveAttribute("aria-label", "3 件");
    await expect(nav.getByRole("link", { name: /Task/ })).toHaveAccessibleName(/Task.*3 件|3 件.*Task/);
    await expect(nav.locator(".nvbadge")).toHaveCount(1);
    // また閉じると、見えなくなる(☰ には出ない)
    await page.getByRole("button", { name: "メニューを閉じる" }).click();
    await expect(badge).toBeHidden();
    await expect(page.getByRole("button", { name: "メニューを開く" })).toHaveText("☰");
  });

  test("件数 0 では印を出さない。多いとき(120)は「99+」で、読み上げは「120 件」", async ({ page }) => {
    await stubCount(page, 0);
    await page.goto("/settings");
    await hydrated(page);
    await openMenu(page);
    await page.waitForTimeout(500);
    await expect(badgeOf(page)).toHaveCount(0);
    // 120 件
    await page.unroute("**/api/4db/tasks/count");
    await stubCount(page, 120);
    await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
    await expect(badgeOf(page)).toHaveText("99+");
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "120 件");
    await page.unroute("**/api/4db/tasks/count");
    await stubCount(page, 99);
    await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
    await expect(badgeOf(page)).toHaveText("99");
    await page.unroute("**/api/4db/tasks/count");
    await stubCount(page, 0);
    await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
    await expect(badgeOf(page)).toHaveCount(0);
  });

  test("読めなかったとき・形の違う答えのときは、前の件数のまま(画面にエラーを出さない)", async ({ page }) => {
    await stubCount(page, 4);
    await page.goto("/settings");
    await hydrated(page);
    await openMenu(page);
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "4 件");
    for (const bad of [{ status: 500, body: { error: "x" } }, { status: 200, body: { count: -1 } }, { status: 200, body: { count: 1.5 } }, { status: 200, body: { count: "9" } }, { status: 200, body: {} }]) {
      await page.unroute("**/api/4db/tasks/count");
      await page.route("**/api/4db/tasks/count", (route) => route.fulfill({ status: bad.status, json: bad.body }));
      await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
      await page.waitForTimeout(400);
      await expect(badgeOf(page), JSON.stringify(bad)).toHaveAttribute("aria-label", "4 件");
    }
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  });

  test("読み込む決まり: 画面を移っても 10 秒に 1 回まで。fourdb:tasks-changed はすぐ(件数つきなら読まずにその数)", async ({ page }) => {
    let calls = 0;
    let next = 2;
    await page.route("**/api/4db/tasks/count", (route) => {
      calls++;
      return route.fulfill({ json: { count: next } });
    });
    await page.goto("/settings");
    await hydrated(page);
    const nav = await openMenu(page);
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "2 件");
    const first = calls;
    expect(first, "最初の読み込み(開発のときは React が 1 回やり直すので 2 回までありえる)").toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2);
    // 10 秒以内に画面を何度か移っても、読み直さない
    next = 5;
    for (const name of [/履歴/, /Table/, /設定/, /履歴/]) {
      await nav.getByRole("link", { name }).click();
      await page.waitForTimeout(300);
    }
    expect(calls, "道筋が変わっても 10 秒に 1 回まで").toBe(first);
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "2 件");
    // 見えるようになったときも 10 秒に 1 回まで(いまは 10 秒以内)
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    expect(calls).toBe(first);
    // tasks-changed(件数なし): すぐ読む
    await page.evaluate(() => window.dispatchEvent(new Event("fourdb:tasks-changed")));
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "5 件");
    expect(calls).toBe(first + 1);
    // tasks-changed(件数つき): 読まずに、その数
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("fourdb:tasks-changed", { detail: { count: 8 } })));
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "8 件");
    expect(calls, "件数つきは読まない").toBe(first + 1);
    // 形の違う detail は、読み直す
    next = 6;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("fourdb:tasks-changed", { detail: { count: "x" } })));
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "6 件");
    expect(calls).toBe(first + 2);
  });
});

test.describe("Task の画面(API の答えを差し替える)", () => {
  const items: TaskOverview["items"]["items"] = [
    { kind: "approval", runStatus: "staged", runId: "r1", sheetId: "s1", sheet: "2026年度", fileId: "f1", file: "店舗別売上", startedAt: "2026-10-10T05:05:00.000Z", finishedAt: null },
    { kind: "failed", runStatus: "failed", runId: "r2", sheetId: "s2", sheet: "メモ", fileId: "f1", file: "店舗別売上", startedAt: "2026-10-09T15:30:00.000Z", finishedAt: "2026-10-09T15:31:00.000Z" },
    { kind: "in_progress", runStatus: "reading", runId: "r3", sheetId: "s3", sheet: "予算", fileId: "f2", file: "経費 <b>太字</b>", startedAt: "2026-10-08T00:00:00.000Z", finishedAt: null },
    { kind: "in_progress", runStatus: "applying", runId: "r4", sheetId: "s4", sheet: "法人A", fileId: "f2", file: "経費 <b>太字</b>", startedAt: "2026-10-07T00:00:00.000Z", finishedAt: null },
  ];

  test("やること(種類・ファイル › シート・始めた日時(日本時間)・Import で開く)と、移行の進み具合(ファイルごとに 2 行)。メニューの印は画面の件数", async ({ page }) => {
    const overview: TaskOverview = {
      count: 9,
      items: { items, more: 5 },
      files: {
        items: [
          { fileId: "f1", file: "店舗別売上", started: 6, migrated: 3, inProgress: 1, imported: 2, failed: 0, notStarted: 4 },
          { fileId: "f2", file: "経費 <b>太字</b>", started: 2, migrated: 0, inProgress: 2, imported: 0, failed: 0, notStarted: 0 },
        ],
        more: 2,
      },
    };
    await page.route("**/api/4db/tasks", (route) => route.fulfill({ json: overview }));
    await stubCount(page, 1);
    await page.goto("/tasks");
    await expect(page).toHaveTitle("Task | 4DB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Taskやること");
    const rows = page.getByTestId("task-item");
    await expect(rows).toHaveCount(4);
    await expect(rows.locator(".pill")).toHaveText(["承認待ち", "失敗", "読み取りの途中", "反映の途中"]);
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))).toEqual(["approval", "failed", "in_progress", "in_progress"]);
    expect(norm(await rows.nth(0).innerText())).toBe("承認待ち 店舗別売上 › 2026年度 開始 2026-10-10 14:05 Import で開く"); // 日本時間(UTC 05:05 = 14:05)
    expect(norm(await rows.nth(1).innerText())).toContain("開始 2026-10-10 00:30"); // 日本時間では日付が変わる(UTC の 10-09 15:30)
    expect(norm(await rows.nth(2).innerText())).toContain("経費 <b>太字</b> › 予算"); // 文字のまま(HTML にならない)
    await expect(page.locator("main b b")).toHaveCount(0); // 入れ子の <b> はできない(ファイル名の入れ物の <b> だけ)
    for (const l of await rows.getByRole("link", { name: "Import で開く" }).all()) await expect(l).toHaveAttribute("href", "/migrate");
    await expect(page.getByText("ほか 5 件")).toBeVisible();
    // 進み具合
    await expect(page.getByRole("heading", { name: /移行の進み具合/ })).toBeVisible();
    const files = page.getByTestId("file-progress-item");
    await expect(files).toHaveCount(2);
    expect(norm(await files.nth(0).innerText())).toBe("店舗別売上 移行完了 3 途中 1 取り込み済み 2 失敗 0 まだ取り込みを始めていないシート 4 枚");
    expect(await files.nth(0).locator("[data-bucket]").evaluateAll((els) => els.map((e) => e.getAttribute("data-bucket")))).toEqual(["migrated", "inProgress", "imported", "failed"]);
    await expect(files.nth(1)).toContainText("まだ取り込みを始めていないシート 0 枚");
    await expect(page.getByText("ほか 2 ファイル")).toBeVisible();
    // 画面が読んだ件数(9)で、メニューの印を合わせる(印の API が 1 と答えても、画面の数が勝つ)
    await openMenu(page);
    await expect(badgeOf(page)).toHaveAttribute("aria-label", "9 件");
  });

  test("やることがないとき: 「やることはありません。」。進み具合の行がなければ、その欄は出ない", async ({ page }) => {
    await page.route("**/api/4db/tasks", (route) => route.fulfill({ json: emptyOverview() }));
    await stubCount(page, 0);
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-empty")).toHaveText("やることはありません。");
    await expect(page.getByTestId("task-list")).toHaveCount(0);
    await expect(page.getByTestId("file-progress")).toHaveCount(0);
    await openMenu(page);
    await expect(badgeOf(page)).toHaveCount(0);
    // やることがなくても、進み具合は出る
    await page.route("**/api/4db/tasks", (route) =>
      route.fulfill({ json: emptyOverview({ files: { items: [{ fileId: "f", file: "ファイル", started: 1, migrated: 1, inProgress: 0, imported: 0, failed: 0, notStarted: 0 }], more: 0 } }) }),
    );
    await page.reload();
    await expect(page.getByTestId("tasks-empty")).toBeVisible();
    await expect(page.getByTestId("file-progress-item")).toHaveCount(1);
  });

  test("読み込めなかったとき: エラーの文(alert)。読み込み中は「読み込んでいます…」", async ({ page }) => {
    await page.route("**/api/4db/tasks", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 500, json: { error: "処理できませんでした。少し時間をおいてもう一度試してください" } });
    });
    await page.goto("/tasks");
    await expect(page.getByText("読み込んでいます…")).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toContainText("処理できませんでした");
    await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  });

  test("エラーの文(import_run の error)は画面にも API にも出ない(返さない決まり)", async ({ request }) => {
    const text = await (await request.get("/api/4db/tasks")).text();
    expect(text).not.toMatch(/"error"\s*:/);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["count", "files", "items"]);
    for (const it of (JSON.parse(text) as TaskOverview).items.items) expect(Object.keys(it).sort()).toEqual(["file", "fileId", "finishedAt", "kind", "runId", "runStatus", "sheet", "sheetId", "startedAt"]);
  });
});
