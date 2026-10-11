import { defineConfig } from "@playwright/test";

// 画面テスト。環境変数なしの npm run dev(ログインなし)で動かす。起動の確認は、ログインなしでも開ける /login
// E2E_4DB_URL があるときは、4D Base の画面のテスト(e2e/home.spec.ts・e2e/migrate.spec.ts・e2e/sheet.spec.ts など。データベースを使うもの)を、すでに動いているそのサーバーで流す(ここでは起動しない)
export default defineConfig({
  testDir: "e2e",
  // 4D Base の画面のテストは、同じサーバーと同じデータベースを使い、同じ試験用のスプシを取り込むので、1つずつ流す
  workers: process.env.E2E_4DB_URL ? 1 : undefined,
  use: {
    baseURL: "http://localhost:3000",
    // GPU のない所(Windows の画面なしの Chromium など)でも 3D(WebGL)を作れるように、ソフトウェア(ANGLE の SwiftShader)で描く。テストのときだけ。
    // 3D の試験は 1 つずつ流し、root の data-ready="true" を待って撮る(P2b の 9 章)
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
  },
  webServer: process.env.E2E_4DB_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
