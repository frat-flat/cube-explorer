import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ログインの設定。Supabase の URL と公開キーがあればログイン必須にする。
// ローカル開発(設定なし・本番ビルド以外)だけはログインなしで動かせる。
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const authConfigured = Boolean(supabaseUrl && supabaseKey);
export const authBypassed = !authConfigured && process.env.NODE_ENV !== "production";

/** 見てよいメールアドレス(ALLOWED_EMAILS にカンマ区切り)。空なら誰も入れない */
export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からは書き込めない。セッションの更新は proxy が受け持つ
        }
      },
    },
  });
}

/** ログイン済みで、見てよい人のメールアドレスを返す。だめなら null */
export async function currentUserEmail(): Promise<string | null> {
  await connection(); // ログインの確認は毎回のリクエストで行う(ビルド時に固めない)
  if (authBypassed) return "local-dev";
  if (!authConfigured) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? null;
  return isAllowedEmail(email) ? email : null;
}

/** API の入口で使う。ログインしていなければ 401 を返す */
export async function requireUser(): Promise<Response | null> {
  return (await currentUserEmail()) ? null : Response.json({ error: "ログインが必要です" }, { status: 401 });
}
