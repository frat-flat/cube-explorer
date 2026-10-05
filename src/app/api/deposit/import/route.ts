import type postgres from "postgres";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { normalizeRow, tableDef } from "@/lib/deposit/tables";

const MAX_ROWS = 5000; // 1回に受け取る行数(画面側で分けて送る)

// CSV・Excel から読んだ行を、コードが同じなら上書き・なければ追加する
export async function POST(request: Request) {
  const denied = await requireUser();
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { table?: string; rows?: Record<string, unknown>[]; offset?: number } | null;
  const def = body?.table ? tableDef(body.table) : undefined;
  if (!def || !Array.isArray(body?.rows)) return Response.json({ error: "取り込む表と行を指定してください" }, { status: 400 });
  if (body.rows.length > MAX_ROWS) return Response.json({ error: `1回に送れるのは${MAX_ROWS}行までです` }, { status: 400 });
  const offset = body.offset ?? 0;

  // 1行ずつ確かめる(行番号は見出しを1行目として数える)
  const errors: string[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  body.rows.forEach((raw, i) => {
    const { row, error } = normalizeRow(def, raw);
    if (error) errors.push(`${offset + i + 2}行目:${error}`);
    else if (row) byKey.set(def.conflict.map((c) => String(row[c])).join("\u0000"), row); // 同じキューの重複は後の行を使う
  });

  // 親(例:法人コード)がまだ取り込まれていない行を先に見つける
  const rows = [...byKey.values()];
  if (def.parent && rows.length) {
    const codes = [...new Set(rows.map((r) => String(r[def.parent!.column])))];
    const found = await sql<{ code: string }[]>`select code from ${sql(def.parent.table)} where code in ${sql(codes)}`;
    const have = new Set(found.map((f) => f.code));
    const missing = codes.filter((c) => !have.has(c));
    if (missing.length) {
      errors.push(`まだ取り込まれていない${def.parent.label}コードがあります:${missing.slice(0, 10).join("、")}${missing.length > 10 ? ` ほか${missing.length - 10}件` : ""}(先に${def.parent.label}を取り込んでください)`);
    }
  }
  if (errors.length) return Response.json({ error: "取り込めない行があります", details: errors.slice(0, 50), errorCount: errors.length }, { status: 422 });
  if (!rows.length) return Response.json({ count: 0 });

  const columns = [...def.columns.map((c) => c.column), ...(def.hasExtra ? ["extra"] : [])];
  const updates = columns.filter((c) => !def.conflict.includes(c));
  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => (def.hasExtra ? { ...r, extra: tx.json(r.extra as postgres.JSONValue) } : r));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 列は定義から作るので型を付けられない
      const values = tx(chunk as any, ...(columns as [string]));
      await tx`
        insert into ${tx(def.key)} ${values}
        on conflict (${tx(def.conflict)}) do update set
          ${tx.unsafe(updates.map((c) => `"${c}" = excluded."${c}"`).join(", "))}, updated_at = now()`;
    }
  });
  return Response.json({ count: rows.length });
}
