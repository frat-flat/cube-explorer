import { withScope } from "@/fourdb/adapters/postgres/db";
import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, listHistory } from "@/fourdb/adapters/postgres/history";
import { failure, requireScope } from "@/lib/fourdb";
import { bad, parseHistoryCursor, parseKind, parseLimit } from "../params";

// GET /api/4db/history?cursor=&limit=50&kind= : 履歴を新しい順に。cursor = 前のページの nextCursor(最後の id)。limit は 1〜100(多ければ 100)。kind = その種類だけ
// → { items: [{ id, at, kind, title, sheetId, definitionId, lines }], nextCursor }(nextCursor が null なら最後)
export async function GET(request: Request) {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  const q = new URL(request.url).searchParams;
  const limit = parseLimit(q.get("limit"), HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
  if ("error" in limit) return bad(limit.error);
  const cursor = parseHistoryCursor(q.get("cursor"));
  if ("error" in cursor) return bad(cursor.error);
  const kind = parseKind(q.get("kind"));
  if ("error" in kind) return bad(kind.error);
  try {
    return Response.json(await withScope(scope, (tx) => listHistory(tx, scope, { cursor: cursor.value, limit: limit.value, kind: kind.value })));
  } catch (e) {
    return failure(e);
  }
}
