import { sql } from "@/lib/db";
import { toAxis, type AxisRow } from "@/lib/meta/axes";

// GET /api/meta/axes : 軸定義一覧(設計書 9. API設計)
export async function GET() {
  const rows = await sql<AxisRow[]>`
    select key, label, kind, source_table, source_column, label_column, time_grain, master_key
    from cube_meta.axes
    order by key
  `;
  return Response.json({ axes: rows.map(toAxis) });
}
