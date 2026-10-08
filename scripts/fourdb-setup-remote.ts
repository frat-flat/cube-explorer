// 手元から、リモートのデータベース(Neon など)に 4D Base の表(fourdb)と実行用の役割を用意する。
//   npm run fourdb:setup-remote            (はじめて)
//   npm run fourdb:setup-remote -- --rotate (実行用の役割のパスワードを作り直す)
// - 表の持ち主の接続先は .env.local の FOURDB_ADMIN_URL(なければ DATABASE_URL)から読む。秘密の値は画面に出さない
// - 実行用の役割 fourdb_app がなければ、ランダムなパスワードで作る(superuser・BYPASSRLS にしない)
// - まだ流していない migration を流し、fourdb_app に読み書きを渡す
// - fourdb_app の接続先を .env.local の FOURDB_DATABASE_URL に書く(画面には出さない)。本番(Vercel)には利用者が同じ値を入れる
// 手元の使い捨てデータベースには npm run fourdb:migrate を使う。
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { assertSafeRole, isLocalDatabase } from "../src/fourdb/adapters/postgres/db";
import { applyMigrations, grantApp } from "../src/fourdb/adapters/postgres/migrate";

const ENV_FILE = ".env.local";
const ROLE = "fourdb_app";

function readEnv(): { lines: string[]; get: (k: string) => string | undefined } {
  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  const get = (k: string) => {
    const l = lines.find((x) => x.startsWith(`${k}=`));
    return l ? l.slice(k.length + 1).replace(/^["']|["']$/g, "") : undefined;
  };
  return { lines, get };
}

function setEnv(lines: string[], key: string, value: string) {
  const i = lines.findIndex((x) => x.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("", `# 4D Base の表(fourdb)に接続する実行用の役割(npm run fourdb:setup-remote が書いた)`, `${key}=${value}`, "");
  }
  writeFileSync(ENV_FILE, lines.join("\n"));
}

/** 接続先の表示用(パスワードと endpoint の一部は伏せる) */
const masked = (u: URL) => `${u.username}@${u.hostname.replace(/^(ep-[a-z]+-[a-z]+)-[a-z0-9]+/, "$1-***")}/${u.pathname.slice(1)}`;

async function main() {
  const rotate = process.argv.includes("--rotate");
  const env = readEnv();
  const raw = process.env.FOURDB_ADMIN_URL || env.get("FOURDB_ADMIN_URL") || env.get("DATABASE_URL");
  if (!raw) throw new Error(`${ENV_FILE} に FOURDB_ADMIN_URL(表の持ち主の接続先)を入れてください`);
  const adminUrl = new URL(raw);
  adminUrl.searchParams.delete("channel_binding");   // postgres.js が知らない指定は外す(つなぐときは sslmode=require で暗号化する)
  if (!adminUrl.searchParams.has("sslmode")) adminUrl.searchParams.set("sslmode", "require");
  if (isLocalDatabase(adminUrl.toString())) throw new Error("手元のデータベースには npm run fourdb:migrate を使ってください");
  console.log(`つなぐ先: ${masked(adminUrl)}`);

  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
  try {
    await admin`select 1`.catch((e: { code?: string }) => {
      throw new Error(e.code === "28P01" ? "パスワードが違います。Neon の画面で接続先を確かめ、.env.local の FOURDB_ADMIN_URL を入れ直してください" : `つなげませんでした(${e.code ?? "接続"})`);
    });

    // 実行用の役割
    const [exists] = await admin`select 1 from pg_roles where rolname = ${ROLE}`;
    let password: string | null = null;
    if (!exists || rotate) {
      password = randomBytes(24).toString("base64url");   // 英数字と - _ だけ(SQL に入れても安全)
      await admin.unsafe(`${exists ? "alter" : "create"} role ${ROLE} with login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole`);
      console.log(exists ? `役割 ${ROLE} のパスワードを作り直した` : `役割 ${ROLE} を作った`);
    } else if (!env.get("FOURDB_DATABASE_URL")) {
      throw new Error(`役割 ${ROLE} はありますが、${ENV_FILE} に接続先がありません。--rotate を付けて、パスワードを作り直してください`);
    }

    const ran = await applyMigrations(admin);
    console.log(ran.length ? `流した migration: ${ran.join(", ")}` : "流す migration はありませんでした(すべて流し済み)");
    await grantApp(admin, ROLE);
    console.log(`役割 ${ROLE} に fourdb の読み書きを渡した`);

    // 実行用の接続先を .env.local に書く(画面には出さない)
    if (password) {
      const appUrl = new URL(adminUrl.toString());
      appUrl.username = ROLE;
      appUrl.password = password;
      setEnv(env.lines, "FOURDB_DATABASE_URL", appUrl.toString());
      console.log(`${ENV_FILE} の FOURDB_DATABASE_URL を書いた(値は表示しない)`);
    }

    // 確かめ: 実行用の役割は行ごとの権限を飛ばせず、workspace を設定しなければ何も見えない
    const appRaw = readEnv().get("FOURDB_DATABASE_URL")!;
    const app = postgres(appRaw, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
    try {
      await assertSafeRole(app);
      const [{ n }] = await app<{ n: string }[]>`select count(*) as n from fourdb.workspace`;
      console.log(`確かめた: ${ROLE} は行ごとの権限を飛ばせない役割で、workspace を設定しないと見える workspace は ${n} 件`);
    } finally {
      await app.end();
    }
  } finally {
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
