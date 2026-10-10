import { getPrefs, PrefsUnavailable, putPrefs } from "@/fourdb/adapters/postgres/prefs";
import { parsePrefsPatch } from "@/fourdb/core/prefs";
import { failure, readJson, requireScope } from "@/lib/fourdb";
import { bad } from "../params";

/** PUT の本文の大きさの上限(バイト)。設定は数十バイトで、look も 2KB を超えない */
const MAX_BODY_BYTES = 4096;

// GET /api/4db/prefs : このアカウントの設定 → { available, saved, prefs: { theme: "dark" | "light" | null, world, look } }
//   available = false は、設定を保存する表がまだ使えない(既定の設定を 200 で返す)。saved = false は、まだ保存していない(既定の設定)
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await getPrefs(scope));
  } catch (e) {
    return failure(e);
  }
}

// PUT /api/4db/prefs { theme?, world?, look? } : 送った欄だけを保存し、保存後の設定を GET と同じ形で返す。同じサイトからの要求だけ(別のサイトは 403)。
//   本文は 4KB まで。形の違うもの(知らない欄・知らない値)は 400。保存する表が使えなければ 503 と code: "prefs_unavailable"
export async function PUT(request: Request) {
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body) return bad("設定の指定の形が違います");
  const patch = parsePrefsPatch(body);
  if (typeof patch === "string") return bad(patch);
  try {
    return Response.json(await putPrefs(scope, patch));
  } catch (e) {
    if (e instanceof PrefsUnavailable) return Response.json({ error: e.message, code: "prefs_unavailable" }, { status: 503 });
    return failure(e);
  }
}
