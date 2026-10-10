import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DEFAULT_PATTERN_ID, PATTERN_LABELS, PATTERNS } from "@/fourdb/core/prefs";
import { applyImport, copyFixture, openMenu, readFile as readSheetFile, removeFixture, resetPrefs, startImport, stage } from "./support";

// オーナーが見る撮影(普段の試験では飛ばす)。本物のアプリ(手元のデータベース・取り込んだ試験用のスプシ・単位 2 つ)の画面を、1280×800 で撮って保存する:
//   全パターン(8)× 明るい/暗い → <出力>/patterns/P<n>-明るい.png・P<n>-暗い.png、見比べ用の 1 枚 → <出力>/patterns.png(パターンの番号と仮の名前つき)
//   Task(明るい・暗い)・設定・右の欄(Box)・Visual の欄
// 起動: E2E_4DB_URL=http://localhost:3200 E2E_SHOTS_DIR=<出力のフォルダ> npx playwright test e2e/shots.spec.ts
// 前提: 手元のデータベースに、いちばん上の Box が 2 つの単位(例: 法人 2 つ・店舗コード 3 つ。店舗コードは試験用のスプシの取り込みで、法人は SQL で足した)がある。
const BASE = process.env.E2E_4DB_URL;
const OUT = process.env.E2E_SHOTS_DIR;
test.use({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
test.skip(!BASE || !OUT, "E2E_4DB_URL と E2E_SHOTS_DIR があるときだけ(オーナーが見る撮影)");
test.describe.configure({ timeout: 600_000, mode: "serial" });

const THEMES = [
  { key: "light", name: "明るい" },
  { key: "dark", name: "暗い" },
] as const;

/** 開発サーバーの小さな目印(左下の N)は、アプリの画面ではないので隠す */
const hideDevOverlay = (ctx: BrowserContext) =>
  ctx.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(s);
    });
  });

async function newThemedPage(browser: import("@playwright/test").Browser, baseURL: string, theme: "light" | "dark") {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, colorScheme: theme });
  await ctx.addCookies([{ name: "fourdb_theme", value: theme, url: baseURL }]);
  await hideDevOverlay(ctx);
  return { ctx, page: await ctx.newPage() };
}

async function openHomeSettled(page: Page, base?: string) {
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-mode", "3d", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  if (base) await expect(stage(page)).toHaveAttribute("data-base", base);
  await page.waitForTimeout(1800); // 書体の読み込み後の組み直しと、カメラの落ち着きを待つ
}

test("全パターン × 明るい/暗い(本物のアプリのホーム)と、見比べ用の 1 枚", async ({ browser, baseURL, request }) => {
  await mkdir(path.join(OUT!, "patterns"), { recursive: true });
  const files: { n: number; theme: string; file: string }[] = [];
  for (const theme of THEMES) {
    const { ctx, page } = await newThemedPage(browser, baseURL!, theme.key);
    for (const p of PATTERNS) {
      const put = await request.put("/api/4db/prefs", { data: { theme: theme.key, look: p.look } });
      expect(put.ok()).toBe(true);
      await openHomeSettled(page, p.look.base);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.key);
      await expect(stage(page)).toHaveAttribute("data-layout", p.look.layout);
      const file = path.join(OUT!, "patterns", `P${p.id}-${theme.name}.png`);
      await page.screenshot({ path: file });
      files.push({ n: p.id, theme: theme.name, file });
    }
    await ctx.close();
  }
  await resetPrefs(request);

  // 見比べ用の 1 枚: 4 列。上から「パターン 1〜4 の明るい」「同じ 4 つの暗い」「パターン 5〜8 の明るい」「同じ 4 つの暗い」
  const data = async (f: string) => `data:image/png;base64,${(await readFile(f)).toString("base64")}`;
  const cells: string[] = [];
  for (const group of [[1, 2, 3, 4], [5, 6, 7, 8]]) {
    for (const theme of THEMES) {
      for (const n of group) {
        const f = files.find((x) => x.n === n && x.theme === theme.name)!;
        const label = PATTERN_LABELS[n as keyof typeof PATTERN_LABELS];
        cells.push(
          `<figure><img src="${await data(f.file)}"><figcaption><b>パターン ${n}「${label.name}」</b> ${theme.name}${n === DEFAULT_PATTERN_ID ? " <i>(既定)</i>" : ""}<br><small>${label.mood}</small></figcaption></figure>`,
        );
      }
    }
  }
  const page = await browser.newPage({ viewport: { width: 2600, height: 1000 } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#222;color:#eee;font:15px/1.5 "Yu Gothic","Meiryo",sans-serif}
    h1{margin:0 0 12px;font-size:20px}
    .g{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    figure{margin:0;background:#111;border:1px solid #444}
    img{display:block;width:100%;height:auto}
    figcaption{padding:6px 8px}
    small{color:#aaa}
  </style><h1>ホームの全パターン(1280×800 の本物のアプリ。名前は仮。上の段が明るい、下の段が暗い)</h1><div class="g">${cells.join("")}</div>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT!, "patterns.png"), fullPage: true });
  await page.close();
});

test("Task・設定・右の欄(Box)・Visual の欄(明るい/暗い)", async ({ browser, baseURL, request }) => {
  await resetPrefs(request);
  // Task に「承認待ち」を 1 つ出すため、試験用のスプシを読んで承認の手前まで進める(撮ったあとで反映して片づける)
  const stamp = Date.now();
  const id = `e2e-shots-${stamp}`;
  const title = `店舗別売上(撮影用 ${new Date(stamp).toISOString().slice(0, 10)})`;
  await copyFixture(id, "fixture-uriage-2026.json", title);
  const work = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const wp = await work.newPage();
  try {
    await readSheetFile(wp, id);
    await startImport(wp);
    for (const theme of THEMES) {
      const { ctx, page } = await newThemedPage(browser, baseURL!, theme.key);
      await request.put("/api/4db/prefs", { data: { theme: theme.key } });
      // Task(メニューを開いて、印も見せる)
      await page.goto("/tasks");
      await expect(page.getByTestId("task-list")).toBeVisible();
      await expect(page.getByTestId("file-progress")).toBeVisible();
      await openMenu(page);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT!, `tasks-${theme.name}.png`) });
      // 設定
      await page.goto("/settings");
      await openMenu(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT!, `settings-${theme.name}.png`) });
      // ホーム: 右の欄(いちばん数値の多い単位 = 店舗コード)
      await openHomeSettled(page);
      const shop = page.locator('ul[aria-label="単位ごとの Box"] > li > button').filter({ hasText: "店舗コード" });
      await shop.click();
      await expect(page.locator("#box-panel")).toHaveJSProperty("inert", false);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT!, `box-panel-${theme.name}.png`) });
      // 右の欄(法人: 子のある単位。「中に」)
      await page.locator('ul[aria-label="単位ごとの Box"] > li > button').filter({ hasText: "法人" }).click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT!, `box-panel-houjin-${theme.name}.png`) });
      // Visual の欄(右の欄は閉じる)
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Visual/ }).click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT!, `visual-panel-${theme.name}.png`) });
      // 右の欄と Visual の欄を同時に
      await page.locator('ul[aria-label="単位ごとの Box"] > li > button').filter({ hasText: "店舗コード" }).click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT!, `box-and-visual-${theme.name}.png`) });
      await ctx.close();
    }
    await applyImport(wp); // 片づける(承認待ちを反映して、Task を元に戻す)
  } finally {
    await work.close();
    await removeFixture(id);
    await resetPrefs(request);
  }
  await writeFile(path.join(OUT!, "shots-readme.txt"), "撮影: e2e/shots.spec.ts。1280×800。開発サーバーの N の印は隠してある。\n", "utf8");
});
