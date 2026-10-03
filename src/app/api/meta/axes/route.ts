import { requireUser } from "@/lib/auth";
import { loadAxes } from "@/lib/meta/load";

// GET /api/meta/axes : 軸定義一覧(設計書 9. API設計)
export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  return Response.json({ axes: await loadAxes() });
}
