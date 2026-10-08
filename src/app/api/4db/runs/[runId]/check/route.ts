import { withScope } from "@/fourdb/adapters/postgres/db";
import { checkApply } from "@/fourdb/adapters/postgres/import-store";
import { parseSpec } from "@/fourdb/core/import/spec-parse";
import { failure, readJson, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

export const maxDuration = 60;

// POST /api/4db/runs/:runId/check { spec, from } : 承認の内容で from 行目から一定の数の行を組み立ててみて、件数と問題を返す(書き込みはしない)。
// done になるまで画面が next を from に渡してくり返し呼ぶ。from = 0 のときだけ、鍵の重なりと実体の数も返す
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isUuid(runId)) return notFound();
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  const body = await readJson(request);
  const spec = parseSpec(body?.spec);
  const from = Number.isInteger(body?.from) && (body!.from as number) >= 0 ? (body!.from as number) : 0;
  if (typeof spec === "string") return Response.json({ error: spec }, { status: 400 });
  try {
    return Response.json(await withScope(scope, (tx) => checkApply(tx, runId, spec, from)));
  } catch (e) {
    return failure(e);
  }
}
