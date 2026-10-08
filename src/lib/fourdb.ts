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
 * ログインなしの開発用の利用者は、ログインの設定がなく(本番ビルドでもなく)、FOURDB_LOCAL_DEV=1 を明示したときだけ。
 */
export async function currentPrincipal(): Promise<string | null> {
  await connection();
  if (authBypassed) return process.env.FOURDB_LOCAL_DEV === "1" ? LOCAL_DEV : null;
  if (!auth) return null;
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user?.id || !isAllowedEmail(user.email)) return null;
  return `neon:${user.id}`;
}

/** principal → workspace の覚え(5 分で取り直す。共有を足したとき、外された人が使い続けないように) */
const WORKSPACE_TTL_MS = 5 * 60 * 1000;
const workspaceOf = new Map<string, { id: string; until: number }>();

/**
 * API の入口で使う。だめなら返す Response、よければ Scope。
 * GET 以外は、同じサイトからの要求だけを受け付ける(別のサイトから書き込ませない)。
 */
export async function requireScope(request?: Request): Promise<Scope | Response> {
  if (request && request.method !== "GET" && !sameOrigin(request)) return Response.json({ error: "この画面からの操作だけを受け付けます" }, { status: 403 });
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!fourdbConfigured()) return Response.json({ error: "4D Base のデータベースがまだ設定されていません(FOURDB_DATABASE_URL)", code: "not_configured" }, { status: 503 });
  if (principal === LOCAL_DEV && !isLocalDatabase(process.env.FOURDB_DATABASE_URL!)) {
    return Response.json({ error: "ログインなしの開発用の利用者は、手元のデータベースにしかつなげません" }, { status: 403 });
  }
  try {
    let ws = workspaceOf.get(principal);
    if (!ws || ws.until < Date.now()) {
      ws = { id: await personalWorkspace(principal), until: Date.now() + WORKSPACE_TTL_MS };
      workspaceOf.set(principal, ws);
    }
    return { principal, workspaceId: ws.id };
  } catch (e) {
    return failure(e);
  }
}

/** ブラウザが付ける Sec-Fetch-Site / Origin で、同じサイトからの要求かを見る(どちらもなければ、ブラウザ以外からの要求として通す) */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** 取り込み元。試験用のフォルダが設定されていればそれ(本番では使えない)、なければ Google */
export function sourceReader(): SourceReader {
  const dir = process.env.FOURDB_SHEETS_FIXTURE_DIR;
  return dir ? fixtureReader(dir) : googleSheetsReader;
}

/** 失敗を、利用者に見せてよい形の Response にする。記録には、セルの中身が入りうる細部(detail など)を残さない */
export function failure(e: unknown): Response {
  if (e instanceof ImportError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof SourceError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof FourdbUnavailable) return Response.json({ error: e.message, code: "not_configured" }, { status: 503 });
  const pg = e as { code?: string; message?: string; constraint_name?: string; name?: string };
  if (typeof pg?.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code)) {
    console.error("fourdb: データベースの決まりで止まった", { code: pg.code, constraint: pg.constraint_name ?? null });
    // P0001 = 4D Base の決まりのトリガー(文は 4D Base が書いたもの)。23 = 整合性(文はデータベースのもので、中の作りが見えるので決まった文にする)
    if (pg.code === "P0001") return Response.json({ error: pg.message ?? "4D Base の決まりに合わないため止めました" }, { status: 409 });
    if (pg.code.startsWith("23")) return Response.json({ error: "データの決まりに合わないため止めました。内容を確かめて、もう一度試してください" }, { status: 409 });
    return Response.json({ error: "データベースで処理できませんでした。少し時間をおいてもう一度試してください" }, { status: 500 });
  }
  console.error("fourdb: 処理できなかった", { name: pg?.name ?? null, message: typeof pg?.message === "string" ? pg.message.slice(0, 200) : null });
  return Response.json({ error: "処理できませんでした。少し時間をおいてもう一度試してください" }, { status: 500 });
}

/** 届いた JSON(1MB まで) */
const MAX_BODY = 1_000_000;
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return null;
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text || "null");
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
