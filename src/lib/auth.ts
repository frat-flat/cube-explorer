import { connection } from "next/server";
import { createNeonAuth } from "@neondatabase/auth/next/server";

// ログインの設定。Neon Auth の URL とクッキー用の秘密の値があればログイン必須にする。
// ローカル開発(設定なし・本番ビルド以外)だけはログインなしで動かせる。
const baseUrl = process.env.NEON_AUTH_BASE_URL ?? "";
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET ?? "";
export const authConfigured = Boolean(baseUrl && cookieSecret);
export const authBypassed = !authConfigured && process.env.NODE_ENV !== "production";

export const auth = authConfigured ? createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } }) : null;

/** 見てよいメールアドレス(ALLOWED_EMAILS にカンマ区切り)。空なら誰も入れない */
export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/** ログイン中の人のメールアドレス(許可の有無は問わない)。ログインしていなければ null */
export async function sessionEmail(): Promise<string | null> {
  if (!auth) return null;
  const { data } = await auth.getSession();
  return data?.user?.email ?? null;
}

/** ログイン済みで、見てよい人のメールアドレスを返す。だめなら null */
export async function currentUserEmail(): Promise<string | null> {
  await connection(); // ログインの確認は毎回のリクエストで行う(ビルド時に固めない)
  if (authBypassed) return "local-dev";
  const email = await sessionEmail();
  return isAllowedEmail(email) ? email : null;
}
