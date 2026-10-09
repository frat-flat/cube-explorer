import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUserEmail } from "@/lib/auth";
import { NAV_COOKIE, parseNavOpen } from "@/lib/prefs";
import { AppNav, Crumb, NavToggle, ShellFrame } from "./AppShell";

// 1つのアプリの枠(P1): ロゴの帯(ロゴ・今いる場所・ログイン中のメール・ログアウト)と、左のメニュー。
// /login は枠の外(この route group の外)。ログインの確認は src/proxy.ts が入口で行う。
//
// 決まり: ここ(layout)のログインの確認は、最後の守りではない。layout は、画面の中の移動(クライアント側の遷移)では
// 読み直されないことがあり、子の画面と並んで描かれるため、確認を layout だけに頼ってはいけない。
// サーバーのデータを読む画面(page)・API は、それぞれが自分でログインの確認(currentUserEmail() / requireScope())を呼ぶこと。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await currentUserEmail();
  // ログインしていても見てよい人でなければ、枠も画面も出さない(ログイン画面が「許可がありません」を出す)
  if (!email) redirect("/login");
  // 左のメニューは、はじめは閉じている(☰ で開くとクッキーに覚える)
  const navClosed = !parseNavOpen((await cookies()).get(NAV_COOKIE)?.value);
  return (
    <ShellFrame initialClosed={navClosed}>
      <header className="top">
        <NavToggle />
        <div className="brand">
          <Image className="logo" src="/brand/logo-64.png" width={28} height={28} alt="" unoptimized loading="eager" />
          <span className="word">4DB</span>
        </div>
        <Crumb />
        <span className="sp" />
        <span className="who">{email}</span>
        {/* ログアウトは POST のフォーム(リンクで GET にすると、別のサイトからも、先読みでも、ログアウトできてしまう)。見た目はリンクと同じ */}
        <form action="/auth/signout" method="post" className="signout">
          <button type="submit" className="out">ログアウト</button>
        </form>
      </header>
      <AppNav />
      <main className="content">{children}</main>
    </ShellFrame>
  );
}
