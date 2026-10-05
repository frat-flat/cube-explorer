import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// 入金キューブの画面が使うデータ一式(申込者〜ショップ、入金明細)
export async function GET() {
  const denied = await requireUser();
  if (denied) return denied;
  const [applicants, contractors, companies, shops, deposits] = await Promise.all([
    sql`select code, name, extra from applicants order by code`,
    sql`select code, applicant_code, name, extra from contractors order by code`,
    sql`select code, contractor_code, name, tax_category, postal_code, address, representative,
               to_char(founded_on, 'YYYY-MM-DD') as founded_on, invoice_no, extra
          from companies order by code`,
    sql`select code, company_code, name, mall, extra from shops order by code`,
    sql`select shop_code, to_char(month, 'YYYY-MM') as month, item, amount::text as amount from deposits`,
  ]);
  return Response.json({ applicants, contractors, companies, shops, deposits }, { headers: { "Cache-Control": "no-store" } });
}
