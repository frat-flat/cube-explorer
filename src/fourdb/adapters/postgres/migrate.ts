// fourdb の表を作る・更新する(migrations/ の SQL を番号順に、まだのものだけ流す)。表の持ち主の接続で使う。
// 流したものは fourdb_migrations.applied に残す(fourdb とは別の名前空間。fourdb の表の決まりに巻き込まないように)。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "./db";

export const MIGRATIONS_DIR = join(process.cwd(), "src", "fourdb", "adapters", "postgres", "migrations");

export async function applyMigrations(admin: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  await admin`create schema if not exists fourdb_migrations`;
  await admin`create table if not exists fourdb_migrations.applied (name text primary key, applied_at timestamptz not null default now())`;
  await admin`revoke all on schema fourdb_migrations from public`;
  const done = new Set((await admin<{ name: string }[]>`select name from fourdb_migrations.applied`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith(".down.sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await readFile(join(dir, f), "utf8");
    await admin.unsafe(text).simple();   // ファイルの中で begin / commit する
    await admin`insert into fourdb_migrations.applied (name) values (${f})`;
    ran.push(f);
  }
  return ran;
}

/** 入れ物の実行用の役割に、fourdb の表の読み書きと関数の実行だけを渡す(役割は入れ物が作る) */
export async function grantApp(admin: Sql, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`役割の名前が正しくありません: ${role}`);
  const r = admin(role);
  await admin`grant usage on schema fourdb to ${r}`;
  await admin`grant select, insert, update, delete on all tables in schema fourdb to ${r}`;
  await admin`grant usage, select on all sequences in schema fourdb to ${r}`;
  await admin`grant execute on all functions in schema fourdb to ${r}`;
}
