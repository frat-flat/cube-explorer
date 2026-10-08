import { defineConfig } from "@playwright/test";

// 画面テスト。環境変数なしの npm run dev(ログインなし)で動かす
// E2E_4DB_URL があるときは、4D Base の新しい画面のテスト(e2e/migrate.spec.ts)を、すでに動いているそのサーバーで流す(ここでは起動しない)
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: process.env.E2E_4DB_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/sheets/read",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
