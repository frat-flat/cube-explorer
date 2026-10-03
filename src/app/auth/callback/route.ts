import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, isAllowedEmail } from "@/lib/auth";

// メールのログインリンクから戻ってくる場所。許可したメールアドレスだけを通す
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  if (!code) return to("/login?error=link");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return to("/login?error=link");
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return to("/login?error=denied");
  }
  return to("/");
}
