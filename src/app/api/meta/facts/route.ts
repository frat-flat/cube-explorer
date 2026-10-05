import { requireUser } from "@/lib/auth";
import { loadFacts } from "@/lib/meta/load";

// GET /api/meta/facts : 事実テーブル定義一覧(使える軸・値・集約を含む)
export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  return Response.json({ facts: await loadFacts() });
}
