import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUserEmail } from "@/lib/auth";
import { fourdbUsable } from "@/lib/fourdb";
import { NAV_COOKIE, parseNavOpen, parseTheme, THEME_COOKIE } from "@/lib/prefs";
import { AppNav, Crumb, NavToggle, ShellFrame } from "./AppShell";
import { LogoutForm } from "./LogoutForm";
import { PrefsProvider } from "./PrefsProvider";

// 1つのアプリの枠(P1): ロゴの帯(ロゴ・今いる場所・ログイン中のメール・ログアウト)と、左のメニュー。
// /login は枠の外(この route group の外)。ログインの確認は src/proxy.ts が入口で行う。
//
// 決まり: ここ(layout)のログインの確認は、最後の守りではない。layout は、画面の中の移動(クライアント側の遷移)では
// 読み直されないことがあり、子の画面と並んで描かれるため、確認を layout だけに頼ってはいけない。
// サーバーのデータを読む画面(page)・API は、それぞれが自分でログインの確認(currentUserEmail() / requireScope())を呼ぶこと。
//
// ここで読むのはクッキー(左のメニューの開き閉じ・明暗)だけ。データベースは読まない(アカウントに覚えた明暗との突き合わせは、
// PrefsProvider がタブの読み込みごとに API で行う)。アカウント向けの API が使えない開発サーバー(データベースがない、または
// ログインなしで FOURDB_LOCAL_DEV もない。enabled = false)では、設定も Task の件数も通信しない。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await currentUserEmail();
  // ログインしていても見てよい人でなければ、枠も画面も出さない(ログイン画面が「許可がありません」を出す)
  if (!email) redirect("/login");
  const jar = await cookies();
  // 左のメニューは、はじめは閉じている(☰ で開くとクッキーに覚える)
  const navClosed = !parseNavOpen(jar.get(NAV_COOKIE)?.value);
  // 明暗はクッキーが最初の画面を決める(ちらつかない)
  const initialTheme = parseTheme(jar.get(THEME_COOKIE)?.value) ?? null;
  // アカウント向けの API(設定・Task の件数)が、この要求で使えるときだけ true。データベースが設定されていても、
  // ログインなしで FOURDB_LOCAL_DEV もない開発サーバーでは API が 401 になるので、通信しない(false)
  const enabled = await fourdbUsable();
  return (
    <PrefsProvider initialTheme={initialTheme} enabled={enabled}>
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
          {/* ログアウトは POST のフォーム(リンクで GET にすると、別のサイトからも、先読みでも、ログアウトできてしまう)。見た目はリンクと同じ。
              送る前に、この端末に残した設定の変更を消す(LogoutForm) */}
          <LogoutForm className="signout" buttonClassName="out" />
        </header>
        <AppNav tasksEnabled={enabled} />
        <main className="content">{children}</main>
      </ShellFrame>
    </PrefsProvider>
  );
}
