// 入れ物(この Next.js アプリ)と 4D Base の芯をつなぐ。ログインした人の印(principal)と workspace を決め、
// 取り込み元(スプシ)を選ぶ。API の入口で使う。
import { connection } from "next/server";
import { auth, authBypassed, isAllowedEmail } from "@/lib/auth";
import { fixtureReader } from "@/fourdb/adapters/google-sheets/fixture";
import { googleSheetsReader } from "@/fourdb/adapters/google-sheets/reader";
import { FourdbUnavailable, fourdbConfigured, isLocalDatabase, personalWorkspace, type Scope } from "@/fourdb/adapters/postgres/db";
import { ImportError } from "@/fourdb/adapters/postgres/import-store";
import { SourceError, type SourceReader } from "@/fourdb/core/ports";

/** ログインなしの開発用の利用者(本番のデータベースにはつながない) */
export const LOCAL_DEV = "local-dev";

/**
 * ログイン中で、見てよい人の印。メールアドレスは変わりうるので使わず、ログインの仕組みのユーザー ID を使う(neon:<ID>)。
 * 許可リスト(ALLOWED_EMAILS)にない人は null。
 */
export async function currentPrincipal(): Promise<string | null> {
  await connection();
  if (authBypassed) return LOCAL_DEV;
  if (!auth) return null;
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user?.id || !isAllowedEmail(user.email)) return null;
  return `neon:${user.id}`;
}

const workspaceOf = new Map<string, string>();

/** API の入口で使う。だめなら返す Response、よければ Scope */
export async function requireScope(): Promise<Scope | Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!fourdbConfigured()) return Response.json({ error: "4D Base のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)", code: "not_configured" }, { status: 503 });
  if (principal === LOCAL_DEV && !isLocalDatabase(process.env.FOURDB_DATABASE_URL!)) {
    return Response.json({ error: "ログインなしの開発用の利用者は、手元のデータベースにしかつなげません" }, { status: 403 });
  }
  let ws = workspaceOf.get(principal);
  if (!ws) {
    ws = await personalWorkspace(principal);
    workspaceOf.set(principal, ws);
  }
  return { principal, workspaceId: ws };
}

/** 取り込み元。試験用のフォルダが設定されていればそれ(本番では使えない)、なければ Google */
export function sourceReader(): SourceReader {
  const dir = process.env.FOURDB_SHEETS_FIXTURE_DIR;
  return dir ? fixtureReader(dir) : googleSheetsReader;
}

/** 失敗を、利用者に見せてよい形の Response にする */
export function failure(e: unknown): Response {
  if (e instanceof ImportError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof SourceError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof FourdbUnavailable) return Response.json({ error: e.message, code: "not_configured" }, { status: 503 });
  const pg = e as { code?: string; message?: string };
  if (typeof pg?.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code)) {
    // データベースの決まりで止まった(23 = 整合性、P0001 = 決まりのトリガー)。中身は決まりの文なので見せてよい
    if (pg.code.startsWith("23") || pg.code === "P0001") return Response.json({ error: `データベースの決まりで止まりました: ${pg.message}` }, { status: 409 });
  }
  console.error(e);
  return Response.json({ error: "処理できませんでした。少し時間をおいてもう一度試してください" }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
