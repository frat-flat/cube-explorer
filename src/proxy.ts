import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// ログインしていない人を /login へ送る。セッションの更新もここで行う。
// ここは入口での確認だけで、API とページの中でも改めて確認している(src/lib/auth.ts)。
// API(ログインの中継 /api/auth/ を含む)は各ルートが自分で確認して 401 を返す。
const PUBLIC_PATHS = ["/login", "/auth/", "/api/"];

export async function proxy(request: NextRequest) {
  if (!auth) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("ログインの設定がありません", { status: 503 });
  }
  if (PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  return auth.middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
