import { applyNext } from "@/fourdb/adapters/postgres/apply";
import { parseSpec } from "@/fourdb/core/import/spec-parse";
import { failure, readJson, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

export const maxDuration = 60;

// POST /api/4db/runs/:runId/apply { spec? } : 承認の内容で、次の分を fourdb に書く(done になるまで画面がくり返し呼ぶ)
// spec は最初の呼び出しだけで使い、あとは保存したものを使う
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isUuid(runId)) return notFound();
  const scope = await requireScope(request);
  if (scope instanceof Response) return scope;
  const raw = (await readJson(request))?.spec;
  const spec = raw === undefined || raw === null ? null : parseSpec(raw);
  if (typeof spec === "string") return Response.json({ error: spec }, { status: 400 });
  try {
    return Response.json(await applyNext(scope, runId, spec));
  } catch (e) {
    return failure(e);
  }
}
