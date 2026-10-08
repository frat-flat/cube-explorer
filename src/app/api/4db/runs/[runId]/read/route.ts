import { readNext } from "@/fourdb/adapters/postgres/import-store";
import { failure, requireScope, sourceReader } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

export const maxDuration = 60;

// POST /api/4db/runs/:runId/read : 次の分を読んで Saving に置く(done になるまで画面がくり返し呼ぶ)
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isUuid(runId)) return notFound();
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await readNext(scope, runId, sourceReader()));
  } catch (e) {
    return failure(e);
  }
}
