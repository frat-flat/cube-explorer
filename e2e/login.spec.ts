import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp"; // 画像の比較に使う(Next.js といっしょに入っている。tools/brand/build.mjs と同じ)

// ログイン画面(/login)。ロゴの絵ができるまでのアニメーション、OS の設定によらない黒地、アニメーション中の入力を確かめる。
// ログインの設定を空にした npm run dev で動かす(ログインがなくても /login は表示できる。docs/deployment/ENVIRONMENT.md)。
// ログインの入口(src/proxy.ts)がロゴの画像を通すかどうかは、ここでは確かめられないので src/proxy.test.ts で確かめる

const LOGO_IMAGES = ["/brand/mark.png", "/brand/mark-lines.png", "/brand/wordmark.png"];
const BLACK = "rgb(0, 0, 0)";
const ADDRESS = "someone@example.com";

// ロゴのアニメーションの状態(main の中だけを見る。開発用の表示などは数えない)
const logoAnimations = (page: Page) =>
  page.evaluate(() => document.querySelector("main")!.getAnimations({ subtree: true }).map((a) => a.playState));

// ロゴのアニメーションを、始まってから t ミリ秒の所で止める(機械の速さによらず、同じ途中の状態にする)
const freezeLogoAt = (page: Page, t: number) =>
  page.evaluate(async (ms) => {
    const animations = document.querySelector("main")!.getAnimations({ subtree: true });
    await Promise.all(animations.map((a) => a.ready));
    for (const a of animations) {
      a.pause();
      a.currentTime = ms;
    }
  }, t);

// 画面の地の色: 端に見えている要素から、色の付いた背景をさかのぼって探す
const backgrounds = (page: Page) =>
  page.evaluate(() => {
    const at = (x: number, y: number) => {
      for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c !== "rgba(0, 0, 0, 0)") return c;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    return { html: getComputedStyle(document.documentElement).backgroundColor, topLeft: at(2, 2), bottom: at(innerWidth / 2, innerHeight - 2) };
  });

// 文字の読みやすさ: 文字色と、その下の色のコントラスト比(WCAG の式。4.5 以上なら普通の文字として読める)
const contrasts = (page: Page) =>
  page.evaluate((black) => {
    const luminance = (color: string) => {
      const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map((v) => {
        const s = Number(v) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    const input = css("#email");
    const button = css('form button[type="submit"]');
    return {
      label: ratio(css("form label").color, black),
      note: ratio(css("form p").color, black),
      input: ratio(input.color, input.backgroundColor),
      button: ratio(button.color, button.backgroundColor),
    };
  }, BLACK);

// ロゴの画像を読み終えて、絵として使えるまで待つ
const logoImagesReady = (page: Page) =>
  page.evaluate(async (urls) => {
    await Promise.all(urls.map((url) => Object.assign(new Image(), { src: url }).decode()));
  }, LOGO_IMAGES);

const logoShot = (page: Page) => page.locator("main svg").first().screenshot();

// 2 枚の画像の、色の差の平均(0〜255)
async function meanDifference(a: Buffer, b: Buffer) {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  expect([x.info.width, x.info.height]).toEqual([y.info.width, y.info.height]);
  let sum = 0;
  for (let i = 0; i < x.data.length; i++) sum += Math.abs(x.data[i] - y.data[i]);
  return sum / x.data.length;
}

// 画像の明るさの平均(0〜255)。真っ黒どうしで「同じ」にならないように確かめる
async function meanBrightness(png: Buffer) {
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data.reduce((s, v) => s + v, 0) / data.length;
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`ログイン画面(OS の設定: ${colorScheme === "light" ? "明るい" : "暗い"})`, () => {
    test.use({ colorScheme });

    test("題名と見出しが 4DB。ロゴの画像が読める。OS の設定によらず黒地で、文字が読める", async ({ page }) => {
      const statuses = new Map<string, number>();
      page.on("response", (r) => {
        const path = new URL(r.url()).pathname;
        if (path.startsWith("/brand/")) statuses.set(path, r.status());
      });
      await page.goto("/login");
      await expect(page).toHaveTitle("4DB");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("4DB");
      await expect.poll(() => LOGO_IMAGES.map((path) => statuses.get(path))).toEqual(LOGO_IMAGES.map(() => 200));
      expect(await backgrounds(page)).toEqual({ html: BLACK, topLeft: BLACK, bottom: BLACK });
      for (const [name, ratio] of Object.entries(await contrasts(page))) expect(ratio, name).toBeGreaterThanOrEqual(4.5);
    });

    test("ロゴを描いている途中でも、入力欄はふさがれず入力できる", async ({ page }) => {
      await page.goto("/login");
      // リボンを描いている途中(1.0 秒)で止めて、その状態で入力する
      await freezeLogoAt(page, 1000);
      expect(new Set(await logoAnimations(page))).toEqual(new Set(["paused"]));
      const email = page.getByLabel("メールアドレス");
      // 画面の準備(hydration)の前に打った文字は消えることがあるので、少し待っても残るまで打ち直す
      await expect(async () => {
        await email.click({ timeout: 2_000 }); // ロゴが入力欄に重なっていれば、ここで失敗する
        await email.press("ControlOrMeta+a");
        await email.press("Delete");
        await page.keyboard.type(ADDRESS);
        await page.waitForTimeout(500);
        await expect(email).toHaveValue(ADDRESS, { timeout: 0 });
      }).toPass({ timeout: 15_000 });
      // 止めたロゴを最後まで流しても、入力はそのまま
      await page.evaluate(() => document.querySelector("main")!.getAnimations({ subtree: true }).forEach((a) => a.play()));
      await expect.poll(() => logoAnimations(page), { timeout: 5_000 }).not.toContain("running");
      await expect(email).toHaveValue(ADDRESS);
    });

    test("ロゴのアニメーションは 4.5 秒以内に終わる", async ({ page }) => {
      // 1回目は開発サーバーが画面を組み立てる時間が入るので、読み込み直してから測る
      await page.goto("/login");
      await page.reload();
      const timing = await page.evaluate(async () => {
        const animations = document.querySelector("main")!.getAnimations({ subtree: true });
        await Promise.all(animations.map((a) => a.ready)); // 始まる前は startTime がまだない(null)
        const spans = animations.map((a) => (a.startTime === null ? null : { start: Number(a.startTime), end: Number(a.startTime) + Number(a.effect!.getComputedTiming().endTime) }));
        const started = spans.filter((s) => s !== null);
        return {
          count: animations.length,
          notStarted: spans.length - started.length,
          // いちばん早く始まったものから、いちばん遅く終わるものまで(ミリ秒)
          length: Math.max(...started.map((s) => s.end)) - Math.min(...started.map((s) => s.start)),
        };
      });
      expect(timing.count).toBeGreaterThan(0);
      expect(timing.notStarted).toBe(0);
      expect(timing.length).toBeLessThanOrEqual(4_500);
      // 実際に、読み込んでから 4.5 秒以内にすべて終わる
      await expect.poll(() => logoAnimations(page), { timeout: 4_500 }).not.toContain("running");
      expect(new Set(await logoAnimations(page))).toEqual(new Set(["finished"]));
    });

    test.describe("動きを減らす設定", () => {
      test.use({ contextOptions: { reducedMotion: "reduce" } });

      test("動きはなく、はじめから最後まで流したときと同じロゴを出す", async ({ page, browser, baseURL }) => {
        await page.goto("/login");
        expect((await logoAnimations(page)).filter((s) => s === "running")).toEqual([]);
        await logoImagesReady(page);
        await page.waitForTimeout(500);
        const still = await logoShot(page);

        // 比べる相手: 動きを減らさない設定で開き、最後まで流したロゴ
        // (このテストの設定 contextOptions は browser.newContext にも引き継がれるので、動きを減らさないことをはっきり書く)
        const context = await browser.newContext({ baseURL, colorScheme, reducedMotion: "no-preference" });
        const normal = await context.newPage();
        await normal.goto("/login");
        await expect.poll(() => logoAnimations(normal), { timeout: 10_000 }).not.toContain("running");
        await logoImagesReady(normal);
        const finished = await logoShot(normal);
        // 比べ方が違いを見分けられることも確かめる(描いている途中とは違う絵になる)
        await freezeLogoAt(normal, 1000);
        const midway = await logoShot(normal);
        await context.close();

        expect(await meanBrightness(still)).toBeGreaterThan(10);
        expect(await meanDifference(still, finished)).toBeLessThan(2);
        expect(await meanDifference(still, midway)).toBeGreaterThan(5);
      });
    });
  });
}
