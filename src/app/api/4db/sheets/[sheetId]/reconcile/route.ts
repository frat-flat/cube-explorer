import { withScope } from "@/fourdb/adapters/postgres/db";
import { reconcile } from "@/fourdb/adapters/postgres/reconcile";
import { failure, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

export const maxDuration = 60;

// GET /api/4db/sheets/:sheetId/reconcile : スプシの合計と 4D Base の合計を見比べる
export async function GET(_request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  if (!isUuid(sheetId)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await withScope(scope, (tx) => reconcile(tx, sheetId)));
  } catch (e) {
    return failure(e);
  }
}
