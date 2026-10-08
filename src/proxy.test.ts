import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// ログインの入口(src/proxy.ts)がどの URL で動くか(config.matcher)を確かめる。
// 画面のテスト(e2e)はログインなしの開発サーバーで動くので、そこでは確かめられない。
// Next の試験用の関数は Next のサーバーの中で使う AsyncLocalStorage を前提にしているので、先に用意してから読み込む
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
// 入口が使うログインの部品(Neon Auth)は Next の外では読み込めず、動く URL の判定にも関係しないので、空にしておく
vi.mock("@/lib/auth", () => ({ auth: null }));
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
const { config } = await import("./proxy");

const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("ログインの入口(proxy)が動く URL", () => {
  // ロゴとタブのアイコン(tools/brand/build.mjs が作る)は、ログイン画面がログインの前に読むので、入口を通さない
  const brandFiles = readdirSync(new URL("../public/brand/", import.meta.url)).map((f) => `/brand/${f}`);

  it("public/brand/ の画像には動かない", () => {
    expect(brandFiles).toEqual(expect.arrayContaining(["/brand/icon-32.png", "/brand/mark.png"]));
    for (const url of brandFiles) expect(runsOn(url), url).toBe(false);
  });

  it("Next の配る部品・favicon・explorer にも動かない", () => {
    for (const url of ["/_next/static/chunks/a.js", "/_next/image?url=%2Fa.png&w=64&q=75", "/favicon.ico", "/explorer/index.html"]) expect(runsOn(url), url).toBe(false);
  });

  it("画面には動く(ログインしていなければ /login へ送る)", () => {
    for (const url of ["/", "/migrate", "/sheet", "/sheets/axes.html"]) expect(runsOn(url), url).toBe(true);
  });

  it("/login と API にも動くが、中で素通しする(PUBLIC_PATHS。API は各ルートが自分で確かめる)", () => {
    for (const url of ["/login", "/api/4db/catalog", "/api/auth/get-session"]) expect(runsOn(url), url).toBe(true);
  });

  it("brand/ に似ているだけの URL は外さない", () => {
    for (const url of ["/brandx/a", "/brand", "/sheets/brand/a"]) expect(runsOn(url), url).toBe(true);
  });
});
