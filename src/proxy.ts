import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ログインしていない人を /login へ送る(API は 401)。セッションの更新もここで行う。
// ここは入口での確認だけで、API とページの中でも改めて確認している(src/lib/auth.ts)。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("ログインの設定がありません", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (data.user || PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return response;

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|explorer/).*)"],
};
