import { defineConfig } from "@playwright/test";

// 画面テスト。環境変数なしの npm run dev(ログインなし)で動かす
// E2E_4DB_URL があるときは、4D Base の新しい画面のテスト(e2e/migrate.spec.ts・e2e/sheet.spec.ts)を、すでに動いているそのサーバーで流す(ここでは起動しない)
export default defineConfig({
  testDir: "e2e",
  // 4D Base の画面のテストは、同じサーバーと同じデータベースを使い、同じ試験用のスプシを取り込むので、1つずつ流す
  workers: process.env.E2E_4DB_URL ? 1 : undefined,
  use: {
    baseURL: "http://localhost:3000",
    // GPU のない所(Windows の画面なしの Chromium など)でも 3D(WebGL)を作れるように、ソフトウェアで描く。テストのときだけ
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: process.env.E2E_4DB_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/sheets/read",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
