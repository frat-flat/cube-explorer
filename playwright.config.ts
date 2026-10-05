import { defineConfig } from "@playwright/test";

// 画面テスト。環境変数なしの npm run dev(ログインなし)で動かす
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/sheets/read",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
