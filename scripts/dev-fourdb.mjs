// 手元で 4D Base の新しい画面(/migrate など)を試すための起動(ログインなし・手元のデータベース)。
//   node scripts/dev-fourdb.mjs [--fixture] [--port 3100]
// - ログイン(Neon Auth)の設定を外して起動する(手元の開発用の利用者 local-dev で動く。手元のデータベースにしかつながない)
// - FOURDB_DATABASE_URL がなければ、手元の使い捨てデータベース(localhost:55432/fourdb_dev、役割 fourdb_app_local)につなぐ
// - --fixture を付けると、スプシの代わりに e2e/fixtures/sheets の試験用ファイルを読む
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "3100";
const env = {
  ...process.env,
  NEON_AUTH_BASE_URL: "",
  NEON_AUTH_COOKIE_SECRET: "",
  FOURDB_DATABASE_URL: process.env.FOURDB_DATABASE_URL || "postgres://fourdb_app_local@localhost:55432/fourdb_dev",
  ...(args.includes("--fixture") ? { FOURDB_SHEETS_FIXTURE_DIR: "e2e/fixtures/sheets" } : {}),
};
const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "--port", port], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
