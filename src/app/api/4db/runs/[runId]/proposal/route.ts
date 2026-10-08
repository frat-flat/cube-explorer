import { withScope } from "@/fourdb/adapters/postgres/db";
import { proposal } from "@/fourdb/adapters/postgres/import-store";
import { defaultSpec } from "@/fourdb/core/import/spec";
import { failure, requireScope } from "@/lib/fourdb";
import { isUuid, notFound } from "../../../ids";

// GET /api/4db/runs/:runId/proposal : 承認の候補(と、画面に最初に出す承認の内容)
// ?headerRow=&groupRow= で、列名の行・グループ名の行を指定できる(0 始まり。groupRow を空にするとグループ名の行なし)
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isUuid(runId)) return notFound();
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    const q = new URL(request.url).searchParams;
    const h = q.get("headerRow");
    const g = q.get("groupRow");
    const small = (x: string | null) => x !== null && /^\d{1,3}$/.test(x);
    const layout = small(h) ? { headerRow: Number(h), groupRow: small(g) && Number(g) < Number(h) ? Number(g) : null } : undefined;
    const p = await withScope(scope, (tx) => proposal(tx, runId, layout));
    return Response.json({ ...p, spec: defaultSpec(p.proposal) });
  } catch (e) {
    return failure(e);
  }
}
