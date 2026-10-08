import { withScope } from "@/fourdb/adapters/postgres/db";
import { checkApply } from "@/fourdb/adapters/postgres/import-store";
import { parseSpec } from "@/fourdb/core/import/spec-parse";
import { failure, readJson, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

export const maxDuration = 60;

// POST /api/4db/runs/:runId/check { spec } : 承認の内容で全行を組み立ててみて、件数と問題を返す(書き込みはしない)
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isUuid(runId)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  const spec = parseSpec((await readJson(request))?.spec);
  if (typeof spec === "string") return Response.json({ error: spec }, { status: 400 });
  try {
    return Response.json(await withScope(scope, (tx) => checkApply(tx, runId, spec)));
  } catch (e) {
    return failure(e);
  }
}
