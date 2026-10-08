import { withScope } from "@/fourdb/adapters/postgres/db";
import { registerBook } from "@/fourdb/adapters/postgres/import-store";
import { failure, readJson, requireScope, sourceReader } from "@/lib/fourdb";

// POST /api/4db/books { url } : スプシのリンクを読み、スプシとタブを登録して、タブの一覧を返す
export async function POST(request: Request) {
  const scope = await requireScope();
  if (scope instanceof Response) return scope;
  const body = await readJson(request);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return Response.json({ error: "スプシのリンクを入れてください" }, { status: 400 });
  try {
    const book = await sourceReader().book(url);
    const sheets = await withScope(scope, (tx) => registerBook(tx, book));
    return Response.json({ book: { title: book.title, url: book.url }, sheets });
  } catch (e) {
    return failure(e);
  }
}
