import { withScope } from "@/fourdb/adapters/postgres/db";
import { loadHome } from "@/fourdb/adapters/postgres/home";
import { failure, requireScope } from "@/lib/fourdb";

// GET /api/4db/home : ホームに出すもの。いちばん上の Box を単位(unit_type)ごとにまとめた立体 6 つまで(ほかの単位は一覧)と、単位ごとの欄
// → { units: HomeUnit[], others: { items: { unitType, count }[], more }, topBoxes }(Box が 1 つもなければ units は空)。形は src/fourdb/core/home/types.ts
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await withScope(scope, (tx) => loadHome(tx, scope)));
  } catch (e) {
    return failure(e);
  }
}
