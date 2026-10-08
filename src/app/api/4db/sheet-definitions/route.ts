import { withScope } from "@/fourdb/adapters/postgres/db";
import { listDefinitions, saveDefinition } from "@/fourdb/adapters/postgres/projection";
import { parseProjectionRequest } from "@/fourdb/core/projection/request";
import { failure, readJson, requireScope } from "@/lib/fourdb";
import { isUuid } from "../ids";

// GET /api/4db/sheet-definitions : 保存した表の定義の一覧
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json({ definitions: await withScope(scope, (tx) => listDefinitions(tx)) });
  } catch (e) {
    return failure(e);
  }
}

// POST /api/4db/sheet-definitions { id?, name, request } : 表の定義を保存する(id があれば上書きして版を上げる)
export async function POST(request: Request) {
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return Response.json({ error: "表の名前を入れてください(100 文字まで)" }, { status: 400 });
  if (body?.id !== undefined && body?.id !== null && !(typeof body.id === "string" && isUuid(body.id))) {
    return Response.json({ error: "上書きする表の指定が違います" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : null;
  const req = parseProjectionRequest(body?.request);
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });
  try {
    return Response.json(await withScope(scope, (tx) => saveDefinition(tx, { id, name, request: req })));
  } catch (e) {
    return failure(e);
  }
}
