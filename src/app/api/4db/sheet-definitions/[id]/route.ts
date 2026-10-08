import { withScope } from "@/fourdb/adapters/postgres/db";
import { getDefinition } from "@/fourdb/adapters/postgres/projection";
import { failure, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../ids";

// GET /api/4db/sheet-definitions/:id : 保存した表の定義(集計の指定の形で)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await withScope(scope, (tx) => getDefinition(tx, id)));
  } catch (e) {
    return failure(e);
  }
}
