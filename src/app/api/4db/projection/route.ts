import { withScope } from "@/fourdb/adapters/postgres/db";
import { project } from "@/fourdb/adapters/postgres/projection";
import { parseProjectionRequest } from "@/fourdb/core/projection/request";
import { failure, readJson, requireScope } from "@/lib/fourdb";

export const maxDuration = 60;

// POST /api/4db/projection { request } : 行・列・絞り・段・集計のしかたから、表を出す(Projection Engine)
// 書き込みはしないが、指定が大きいので POST で受ける
export async function POST(request: Request) {
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  const req = parseProjectionRequest((await readJson(request))?.request);
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });
  try {
    return Response.json(await withScope(scope, (tx) => project(tx, req)));
  } catch (e) {
    return failure(e);
  }
}
