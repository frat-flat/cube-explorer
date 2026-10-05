import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// 取り込み画面に出す、各表の今の件数
export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  const [r] = await sql`
    select (select count(*) from applicants)::int as applicants, (select count(*) from contractors)::int as contractors,
           (select count(*) from companies)::int as companies, (select count(*) from shops)::int as shops,
           (select count(*) from deposits)::int as deposits`;
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
