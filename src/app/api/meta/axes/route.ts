import { loadAxes } from "@/lib/meta/load";

// GET /api/meta/axes : 軸定義一覧(設計書 9. API設計)
export async function GET() {
  return Response.json({ axes: await loadAxes() });
}
