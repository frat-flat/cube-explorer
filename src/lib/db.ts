import postgres from "postgres";

// サーバー側専用の DB 接続。DATABASE_URL がなければローカルの `npx supabase start` の DB を使う
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);

export const sql =
  globalForDb.sql ??
  postgres(url, {
    max: 5,
    ssl: local ? false : "require",
    // 接続プーラー(Neon の -pooler、Supabase の 6543番)は名前付きの prepared statement を使えない
    prepare: !/-pooler\.|:6543\//.test(url),
  });

// next dev のホットリロードで接続が増え続けないようにする
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
