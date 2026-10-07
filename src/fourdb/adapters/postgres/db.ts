// fourdb の表につなぐ(つなぎ)。素の PostgreSQL に、入れ物の実行用の役割で接続する(DATA_MODEL.md 3.9)。
// 読み書きは必ず withScope の中で行い、トランザクションごとに「誰が」「どの workspace で」を設定する。
import { randomUUID } from "node:crypto";
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
export type Scope = { principal: string; workspaceId: string | null };

export class FourdbUnavailable extends Error {}

let pool: Sql | null = null;

export const fourdbConfigured = () => Boolean(process.env.FOURDB_DATABASE_URL);

/** 手元のデータベースか(localhost・127.0.0.1・::1) */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function db(): Sql {
  const url = process.env.FOURDB_DATABASE_URL;
  if (!url) throw new FourdbUnavailable("4D Base のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)");
  pool ??= postgres(url, {
    prepare: false,          // 接続をまとめる仕組み(pooler)越しでも動くように
    max: 5,
    idle_timeout: 20,
    onnotice: () => {},
    connection: { application_name: "4dbase" },
  });
  return pool;
}

/** principal と workspace を設定したトランザクションで fn を動かす(設定はトランザクションの終わりで消える) */
export async function withScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!scope.principal) throw new Error("principal がありません");
  const result = await db().begin(async (tx) => {
    await tx`select set_config('fourdb.principal', ${scope.principal}, true), set_config('fourdb.workspace_id', ${scope.workspaceId ?? ""}, true)`;
    return fn(tx);
  });
  return result as T;
}

/**
 * 自分の workspace(なければ作る)。今は1人に1つ(この環境の決定)。
 * workspace の id は利用者から受け取らず、必ず principal から決める。
 */
export async function personalWorkspace(principal: string): Promise<string> {
  const fresh = randomUUID();
  return withScope({ principal, workspaceId: fresh }, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"fourdb.personal:" + principal}, 0))`;
    const [m] = await tx<{ workspace_id: string }[]>`
      select workspace_id from fourdb.workspace_member where principal = ${principal} and role = 'owner' order by created_at limit 1`;
    if (m) return m.workspace_id;
    await tx`insert into fourdb.workspace (id, name) values (${fresh}, ${"自分のワークスペース"})`;
    await tx`insert into fourdb.workspace_member (workspace_id, principal, role) values (${fresh}, ${principal}, 'owner')`;
    return fresh;
  });
}
