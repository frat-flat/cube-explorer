import { requireUser } from "@/lib/auth";
import { getFace } from "@/lib/cube/engine";
import { CubeError } from "@/lib/cube/validate";

// POST /api/cube/face : FaceRequest → 面のデータ(設計書 9. API設計)
export async function POST(request: Request) {
  const denied = await requireUser();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON として読めないリクエストです" }, { status: 400 });
  }
  try {
    return Response.json(await getFace(body));
  } catch (e) {
    if (e instanceof CubeError) return Response.json({ error: e.message }, { status: 400 });
    if (isTimeout(e)) {
      return Response.json({ error: "集計に10秒以上かかったため打ち切りました。軸や条件を絞ってください" }, { status: 504 });
    }
    console.error(e);
    return Response.json({ error: "集計中にエラーが起きました" }, { status: 500 });
  }
}

function isTimeout(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "57014";
}
