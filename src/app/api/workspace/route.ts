import { currentUserEmail } from "@/lib/auth";
import { isState, loadWorkspace, saveWorkspace, supabaseConfig, WorkspaceError } from "@/lib/supabase/workspace";

// GET /api/workspace : ログイン中の人のダッシュボードの中身を Supabase から返す(未設定なら configured:false)
// PUT /api/workspace : { state } を Supabase に保存する
const unauthorized = () => Response.json({ error: "ログインが必要です" }, { status: 401 });
const fail = (e: unknown) => {
  if (e instanceof WorkspaceError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

export async function GET() {
  const owner = await currentUserEmail();
  if (!owner) return unauthorized();
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ configured: false });
  try {
    const saved = await loadWorkspace(cfg, owner);
    return Response.json({ configured: true, state: saved?.state ?? null, updatedAt: saved?.updatedAt ?? null });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  const owner = await currentUserEmail();
  if (!owner) return unauthorized();
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ error: "Supabase がまだ設定されていません(SUPABASE_URL・SUPABASE_SECRET_KEY)" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
  if (!isState(body?.state)) return Response.json({ error: "中身の形が違います" }, { status: 400 });
  try {
    return Response.json({ updatedAt: await saveWorkspace(cfg, owner, body.state) });
  } catch (e) {
    return fail(e);
  }
}
