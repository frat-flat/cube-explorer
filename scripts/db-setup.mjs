// DATABASE_URL のデータベース(Neon など)に、テーブルとサンプルデータを入れる。Docker は不要。
//   npm run db:setup              … まだ入れていないマイグレーションを流す。初回はサンプルデータも入れる
//   npm run db:setup -- --reset   … テーブルを作り直して、サンプルデータの状態に戻す(取り込んだデータは消える)
// マイグレーションとサンプルデータは supabase/ の下にあるもの(ローカルの Supabase と同じ)を使う。
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local がなければ、環境変数をそのまま使う
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL がありません。.env.local に Neon の接続文字列を書いてください(README の手順)。");
  process.exit(1);
}
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
const sql = postgres(url, { ssl: local ? false : "require", max: 1, onnotice: () => {} });
const reset = process.argv.includes("--reset");

try {
  if (reset) {
    console.log("テーブルを作り直します…");
    const tables = await sql`select tablename from pg_tables where schemaname = 'public'`;
    for (const { tablename } of tables) await sql`drop table if exists ${sql(tablename)} cascade`;
    await sql`drop schema if exists cube_meta cascade`;
  }

  await sql`create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from app_migrations`).map((r) => r.name));
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const firstTime = done.size === 0;

  for (const file of files.filter((f) => !done.has(f))) {
    console.log(`マイグレーション: ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(`supabase/migrations/${file}`, "utf8"));
      await tx`insert into app_migrations (name) values (${file})`;
    });
  }

  if (firstTime) {
    for (const file of ["seed.sql", "seed_deposit.sql"]) {
      console.log(`サンプルデータ: ${file}`);
      await sql.begin((tx) => tx.unsafe(readFileSync(`supabase/${file}`, "utf8")));
    }
  }

  const [c] = await sql`select (select count(*) from companies)::int as companies, (select count(*) from shops)::int as shops,
                               (select count(*) from deposits)::int as deposits`;
  console.log(`準備できました(法人 ${c.companies}社・ショップ ${c.shops}店・入金明細 ${c.deposits}件)`);
} catch (e) {
  console.error("データベースの準備に失敗しました:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
