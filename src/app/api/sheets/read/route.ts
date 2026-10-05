import { requireUser } from "@/lib/auth";
import { readSpreadsheet, serviceAccount, SheetsError } from "@/lib/google/sheets";

// GET /api/sheets/read?url=… : 共有されたスプシをシステム用アカウントで読み、タブ・関数・条件付き書式・入力規則を返す
// GET /api/sheets/read        : 共有先にするシステム用アカウントのメールアドレスだけを返す
export async function GET(request: Request) {
  const denied = await requireUser();
  if (denied) return denied;
  const url = new URL(request.url).searchParams.get("url");
  const email = serviceAccount()?.client_email ?? null;
  if (!url) return Response.json({ serviceAccount: email });
  try {
    return Response.json({ book: await readSpreadsheet(url), serviceAccount: email });
  } catch (e) {
    if (e instanceof SheetsError) return Response.json({ error: e.message, code: e.code, serviceAccount: email }, { status: e.status });
    throw e;
  }
}
