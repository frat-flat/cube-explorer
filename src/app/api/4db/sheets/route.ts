import { withScope } from "@/fourdb/adapters/postgres/db";
import { listSheets } from "@/fourdb/adapters/postgres/import-store";
import { failure, requireScope } from "@/lib/fourdb";

// GET /api/4db/sheets : 登録した表(タブ)の一覧
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json({ sheets: await withScope(scope, (tx) => listSheets(tx)) });
  } catch (e) {
    return failure(e);
  }
}
