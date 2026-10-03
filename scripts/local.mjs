// 本番と同じ構成(ログインあり・データベースあり・本番ビルド)を手元で立ち上げる。
//   npm run local                 … 起動(初回はサンプルデータ入り)
//   npm run local -- --reset      … データベースをサンプルデータの状態に戻してから起動
//   ALLOWED_EMAILS=a@x.jp npm run local … ログインできるメールアドレスを変える
// メールは実際には送られず、ローカルのメール受信箱(Mailpit)に届く。
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const run = (cmd) => {
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

try {
  execSync("docker info", { stdio: "ignore" });
} catch {
  console.error("Docker が動いていません。Docker Desktop を起動してから、もう一度実行してください。");
  process.exit(1);
}

run("npx supabase start");
if (process.argv.includes("--reset")) run("npx supabase db reset");

const status = Object.fromEntries(
  execSync("npx supabase status -o env", { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const emails = process.env.ALLOWED_EMAILS || "demo@example.com";

// NEXT_PUBLIC_ の値はビルド時に埋め込まれるので、ビルドの前に書き出す
writeFileSync(
  ".env.production.local",
  [
    "# scripts/local.mjs が書き出す(手で直しても次の起動で上書きされる)",
    `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
    `NEXT_PUBLIC_LOCAL_MAIL_URL=${status.MAILPIT_URL}`,
    `DATABASE_URL=${status.DB_URL}`,
    `ALLOWED_EMAILS=${emails}`,
    "",
  ].join("\n"),
);

run("npm run build");
console.log(`
──────────────────────────────────────────
  開く:        http://localhost:3000
  ログイン:    ${emails}
  メール受信箱: ${status.MAILPIT_URL}  (ログイン用のリンクはここに届きます)
  止める:      Ctrl+C(データベースも止めるなら npm run db:stop)
──────────────────────────────────────────
`);
run("npx next start");
