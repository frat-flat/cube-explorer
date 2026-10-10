import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { sameOrigin } from "@/lib/same-origin";

// ログアウト。枠の「ログアウト」ボタンは POST のフォーム。別のサイトのページから、利用者のブラウザでログアウトさせられないよう、
// どちらの方法でも、同じサイトからの要求だけを受け付ける(src/lib/same-origin.ts)。
// GET は、同じサイトのリンク(ログインの「許可がありません」の画面。src/app/login/LoginForm.tsx)と、アドレスを直接入れた場合(Sec-Fetch-Site: none)だけ
const refused = () => Response.json({ error: "この画面からの操作だけを受け付けます" }, { status: 403 });

async function signOutAndGoToLogin(request: NextRequest) {
  if (auth) await auth.signOut();
  // 303: POST のあとは、行き先を GET で開かせる(307 だと /login へ POST してしまう)
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), 303);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return refused();
  return signOutAndGoToLogin(request);
}

export async function GET(request: NextRequest) {
  const typedByUser = request.headers.get("sec-fetch-site") === "none";
  if (!typedByUser && !sameOrigin(request)) return refused();
  return signOutAndGoToLogin(request);
}
