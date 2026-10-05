// 本番と同じ構成(ログインあり・本番ビルド)を手元で立ち上げる。
// ログインは Neon Auth(クラウド)を使い、設定は .env.local に書く(README の手順)。
//   npm run local                 … 起動
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync } from "node:fs";

const run = (cmd) => {
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(".env.local")) {
  copyFileSync(".env.example", ".env.local");
  console.log(".env.local を作りました。");
}
process.loadEnvFile(".env.local");

const missing = ["NEON_AUTH_BASE_URL", "ALLOWED_EMAILS"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`.env.local に ${missing.join("、")} を書いてから、もう一度実行してください(README の「環境変数」)。`);
  process.exit(1);
}
// ログインのクッキーに使う秘密の値。なければ作って .env.local に足す
if (!process.env.NEON_AUTH_COOKIE_SECRET) {
  appendFileSync(".env.local", `\nNEON_AUTH_COOKIE_SECRET=${randomBytes(32).toString("base64")}\n`);
  console.log("NEON_AUTH_COOKIE_SECRET を作って .env.local に足しました。");
}

run("npm run build");
console.log(`
──────────────────────────────────────────
  開く:      http://localhost:3000
  ログイン:  ${process.env.ALLOWED_EMAILS}
             (メールに届く6桁のコードを入れます)
  止める:    Ctrl+C
──────────────────────────────────────────
`);
run("npx next start");
