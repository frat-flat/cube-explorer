// e2e の共通の道具(試験ファイルではない)。ホーム・Task・見た目の保存・設定の試験が使う。
// 4D Base の画面の試験は、手元のデータベースにつないだ開発サーバー(node scripts/dev-fourdb.mjs --fixture --port 3200)を相手にする(E2E_4DB_URL)。
import { readFile as readFileText, rm, writeFile } from "node:fs/promises";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { HomeOverview, HomeUnit } from "@/fourdb/core/home";
import { DEFAULT_LOOK, type Look, type PrefsPatch } from "@/fourdb/core/prefs";

export const FIXTURES = "e2e/fixtures/sheets";
export const LINK = "ファイル(Google スプレッドシート)のリンク";

/** 画面の準備(hydration)が終わるまで待つ。終わる前の操作は効かない。枠の ☰ が目印 */
export const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector(".navbtn");
    return Boolean(el) && Object.keys(el!).some((k) => k.startsWith("__reactProps"));
  });

/** ヘッドレスの SwiftShader(ソフトウェアの描画)が、WebGL の文脈ごとに出す Chromium 自身の通知。製品の出す警告ではない(WebGL の素の canvas だけでも出る) */
const ENV_NOISE = /GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/;

export type Watch = {
  /** コンソールの error・warning(ENV_NOISE は除く)と、ページの未処理の例外 */
  problems: string[];
  /** 通信した相手(data: と blob: は除く) */
  hosts: Set<string>;
  /** /api/4db/prefs への PUT(本文と時刻) */
  puts: { body: string; at: number }[];
  /** 通信した API の URL(メソッドつき) */
  apis: string[];
  /** コンソールの全文(種類つき。調べる用) */
  console: string[];
};

/** コンソール・通信・PUT を見張る。goto の前に呼ぶ */
export function watch(page: Page): Watch {
  const w: Watch = { problems: [], hosts: new Set(), puts: [], apis: [], console: [] };
  page.on("console", (m) => {
    w.console.push(`${m.type()}: ${m.text()}`);
    if ((m.type() === "error" || m.type() === "warning") && !ENV_NOISE.test(m.text())) w.problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => w.problems.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return;
    w.hosts.add(u.host);
    if (u.pathname.startsWith("/api/")) w.apis.push(`${r.method()} ${u.pathname}`);
    if (r.method() === "PUT" && u.pathname === "/api/4db/prefs") w.puts.push({ body: r.postData() ?? "", at: Date.now() });
  });
  return w;
}

/** 自分のサーバー以外へ通信していないこと */
export const externalHosts = (w: Watch, baseURL: string) => [...w.hosts].filter((h) => h !== new URL(baseURL).host);

// ---------- ホーム ----------

/** ホームの舞台(<section data-mode>) */
export const stage = (page: Page) => page.locator("section[data-mode]");

/** ホームを開き、立体が最初のフレームを描くまで待つ(3D の試験は 1 つずつ) */
export async function openHome(page: Page, path = "/") {
  await page.goto(path);
  await expect(stage(page)).toHaveAttribute("data-mode", "3d", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

/** 単位 1 つ分の API の答え(試験用の合成データ)。指定しなかった欄は「値がない」 */
export function unitOf(unitType: string | null, count: number, over: Partial<HomeUnit> = {}): HomeUnit {
  return {
    key: unitType === null ? "none" : `u:${unitType}`,
    unitType,
    count,
    names: { items: [`${unitType ?? "単位なし"}-1`, `${unitType ?? "単位なし"}-2`], more: Math.max(0, count - 2) },
    inside: null,
    cardFields: null,
    measures: null,
    period: null,
    sheets: null,
    tables: null,
    ...over,
  };
}

export const overviewOf = (units: HomeUnit[], others: HomeOverview["others"] = { items: [], more: 0 }): HomeOverview => ({
  units,
  others,
  topBoxes: units.reduce((a, u) => a + u.count, 0) + others.items.reduce((a, u) => a + u.count, 0) + others.more,
});

/** GET /api/4db/home を、決まった答えにする(Playwright の route。goto の前に) */
export async function stubHome(page: Page, overview: HomeOverview | { status: number; body: unknown }) {
  await page.route("**/api/4db/home", (route) =>
    "status" in overview ? route.fulfill({ status: overview.status, json: overview.body }) : route.fulfill({ json: overview }),
  );
}

/** n 個の単位(単位の名前は 単位1…。数は多い順になるよう 100-i) */
export const manyUnits = (n: number): HomeUnit[] => Array.from({ length: n }, (_, i) => unitOf(`単位${i + 1}`, 100 - i));

/** canvas を撮った画像に、色が何種類あるか(ページの中で数える。一色なら 1) */
export async function distinctColors(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size;
  }, png.toString("base64"));
}

// ---------- アカウントの設定 ----------

export type PrefsState = { available: boolean; saved: boolean; prefs: { theme: "dark" | "light" | null; world: string; look: Look } };

export const getPrefs = async (request: APIRequestContext) => (await (await request.get("/api/4db/prefs")).json()) as PrefsState;

/** アカウントの設定を、何も変えていない状態(パソコンの設定に合わせる・無地・既定の見た目)にする */
export async function resetPrefs(request: APIRequestContext, look?: Look) {
  const res = await request.put("/api/4db/prefs", {
    data: { theme: null, world: "plain", look: look ?? { ...DEFAULT_LOOK } } satisfies PrefsPatch,
  });
  expect(res.ok(), "設定をもとに戻す").toBe(true);
}

// ---------- 取り込み(試験用のファイル) ----------

/** 試験用のファイルを、別の ID で写す(まっさらなスプシとして取り込めるように)。fixture = 写す元(既定は売上)。title があれば、ファイルの題をそれに変える(画面で見分けられるように) */
export async function copyFixture(id: string, fixture = "fixture-uriage-2026.json", title?: string) {
  const book = JSON.parse(await readFileText(`${FIXTURES}/${fixture}`, "utf8")) as { title: string };
  if (title) book.title = title;
  await writeFile(`${FIXTURES}/${id}.json`, JSON.stringify(book), "utf8");
}
export const removeFixture = (id: string) => rm(`${FIXTURES}/${id}.json`, { force: true });

/** /migrate でリンクを読み取る(開発サーバーが画面を作っている間は入力が効かないことがあるので、押せるまで入れ直す) */
export async function readFile(page: Page, id: string) {
  await page.goto("/migrate");
  await expect(async () => {
    await page.getByLabel(LINK).fill(`https://docs.google.com/spreadsheets/d/${id}/edit`);
    await expect(page.getByRole("button", { name: "読み取る" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "読み取る" }).click();
}

/** 「2026年度」のシートを、承認の画面(取り込むを押したところ)まで進める */
export async function startImport(page: Page) {
  const row = page.getByRole("row").filter({ hasText: "2026年度" }).filter({ hasText: /\d+ 行 × \d+ 列/ }).first();
  await row.getByRole("button", { name: /^(取り込む|読み直す)$/ }).click();
  await expect(page.getByRole("button", { name: "全行で確かめる" })).toBeVisible();
}

/** 確かめて反映するところまで */
export async function applyImport(page: Page) {
  await page.getByRole("button", { name: "全行で確かめる" }).click();
  await expect(page.getByText("問題はありません")).toBeVisible();
  await page.getByRole("button", { name: "この内容で反映する" }).click();
  await expect(page.getByText("が、4DB が元の値から計算した合計と一致しました")).toBeVisible();
}

/** /migrate で試験用のファイルを取り込み、「2026年度」のシートを反映するところまで進める */
export async function importFixture(page: Page, id: string) {
  await readFile(page, id);
  await startImport(page);
  await applyImport(page);
}

/** 画面の外の API の件数(メニューの印と比べる) */
export const taskCount = async (request: APIRequestContext) => ((await (await request.get("/api/4db/tasks/count")).json()) as { count: number }).count;

/** 左のメニューを開く(はじめは閉じている) */
export async function openMenu(page: Page) {
  const nav = page.getByRole("navigation", { name: "画面" });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(nav).toBeVisible();
  return nav;
}
