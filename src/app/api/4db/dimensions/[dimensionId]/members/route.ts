import { withScope } from "@/fourdb/adapters/postgres/db";
import { searchMembers } from "@/fourdb/adapters/postgres/projection";
import { failure, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

// GET /api/4db/dimensions/:dimensionId/members?level=&q= : 軸の値を名前で探す(絞り込みで選ぶため。200 件まで)
export async function GET(request: Request, { params }: { params: Promise<{ dimensionId: string }> }) {
  const { dimensionId } = await params;
  if (!isUuid(dimensionId)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  const q = new URL(request.url).searchParams;
  const lv = q.get("level");
  const level = lv !== null && /^\d{1,2}$/.test(lv) ? Number(lv) : null;
  const text = (q.get("q") ?? "").slice(0, 100);
  try {
    return Response.json({ members: await withScope(scope, (tx) => searchMembers(tx, dimensionId, level, text)) });
  } catch (e) {
    return failure(e);
  }
}
