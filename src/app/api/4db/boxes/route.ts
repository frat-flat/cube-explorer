import { withScope } from "@/fourdb/adapters/postgres/db";
import { BOXES_DEFAULT_LIMIT, BOXES_MAX_LIMIT, BOXES_TEXT_MAX, listBoxes } from "@/fourdb/adapters/postgres/boxes";
import { failure, requireScope } from "@/lib/fourdb";
import { bad, parseBoxCursor, parseLimit, parseParent, parseText } from "../params";
import { notFound } from "../ids";

// GET /api/4db/boxes?parent=root|<id>&unitType=&q=&cursor=&limit=100 : ある Box の子(parent を省くか root なら、いちばん上の Box)を、子の数つきで。
// unitType = その単位だけ、q = 名前に含む語(NUL は 400)、cursor = 前のページの nextCursor(最後の Box の id)、limit は 1〜200(多ければ 200)。
// parent がこの workspace の Box でなければ 404。cursor の Box がこの workspace になければ(消えた・別の workspace のもの)400。
// → { parent, boxes: [{ id, parentId, type, unitType, name, childCount }], nextCursor }
export async function GET(request: Request) {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  const q = new URL(request.url).searchParams;
  const parent = parseParent(q.get("parent"));
  if ("error" in parent) return bad(parent.error);
  const limit = parseLimit(q.get("limit"), BOXES_DEFAULT_LIMIT, BOXES_MAX_LIMIT);
  if ("error" in limit) return bad(limit.error);
  const cursor = parseBoxCursor(q.get("cursor"));
  if ("error" in cursor) return bad(cursor.error);
  const unitType = parseText(q.get("unitType"), BOXES_TEXT_MAX, "unitType");
  if ("error" in unitType) return bad(unitType.error);
  const text = parseText(q.get("q"), BOXES_TEXT_MAX, "q");
  if ("error" in text) return bad(text.error);
  try {
    const list = await withScope(scope, (tx) =>
      listBoxes(tx, scope, { parentId: parent.value, unitType: unitType.value, q: text.value, cursor: cursor.value, limit: limit.value }));
    return list ? Response.json(list) : notFound();
  } catch (e) {
    return failure(e);
  }
}
