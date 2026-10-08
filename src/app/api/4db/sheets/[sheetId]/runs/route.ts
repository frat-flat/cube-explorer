import { withScope } from "@/fourdb/adapters/postgres/db";
import { startRun } from "@/fourdb/adapters/postgres/import-store";
import { failure, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

// POST /api/4db/sheets/:sheetId/runs : 取り込みを始める(途中のものがあればそれを続ける)
export async function POST(_request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  if (!isUuid(sheetId)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    const run = await withScope(scope, (tx) => startRun(tx, sheetId, scope.principal));
    return Response.json({ run: { id: run.id, status: run.status, rowsRead: run.rows_read, total: run.cursor.total } });
  } catch (e) {
    return failure(e);
  }
}
