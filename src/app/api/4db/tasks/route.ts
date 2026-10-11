import { withScope } from "@/fourdb/adapters/postgres/db";
import { loadTasks } from "@/fourdb/adapters/postgres/tasks";
import { failure, requireScope } from "@/lib/fourdb";

// GET /api/4db/tasks : やること(承認待ち・読み取りや反映の途中・失敗した取り込み)の一覧と、ファイルごとの移行の進み具合
// → { count, items: { items: TaskItem[], more }, files: { items: FileProgress[], more } }。形は src/fourdb/core/tasks/types.ts。取り込みの error の文は返さない
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json(await withScope(scope, (tx) => loadTasks(tx, scope)));
  } catch (e) {
    return failure(e);
  }
}
