import { withScope } from "@/fourdb/adapters/postgres/db";
import { countTasks } from "@/fourdb/adapters/postgres/tasks";
import { failure, requireScope } from "@/lib/fourdb";

// GET /api/4db/tasks/count : メニューに出す、やることの件数 → { count }(/api/4db/tasks の count と同じ数え方)
export async function GET() {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  try {
    return Response.json({ count: await withScope(scope, (tx) => countTasks(tx, scope)) });
  } catch (e) {
    return failure(e);
  }
}
