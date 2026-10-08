import { withScope } from "@/fourdb/adapters/postgres/db";
import { catalog } from "@/fourdb/adapters/postgres/projection";
import { failure, requireScope } from "@/lib/fourdb";

// GET /api/4db/catalog : 表に使える数値のカラムと、軸と段
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await withScope(scope, (tx) => catalog(tx)));
  } catch (e) {
    return failure(e);
  }
}
