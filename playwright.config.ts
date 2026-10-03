import { defineConfig } from "@playwright/test";

// 画面テスト。ローカルDB(npm run db:start)が起動している前提
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/meta/axes",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
