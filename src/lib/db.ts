import postgres from "postgres";

// サーバー側専用の DB 接続。ローカルでは `npx supabase start` の DB を使う
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", {
    max: 5,
  });

// next dev のホットリロードで接続が増え続けないようにする
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
