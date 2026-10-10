import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserEmail } from "@/lib/auth";
import { LogoutForm } from "../LogoutForm";
import s from "./settings.module.css";
import { ThemeSetting } from "./ThemeSetting";
import { WorldSetting } from "./WorldSetting";

export const metadata: Metadata = { title: "設定 | 4DB" };

// 設定: 画面の見た目(暗い・明るい)・World(まわりの世界)と、ログイン中のメール・ログアウト。見た目と World はアカウントに覚える。
// ログインの確認は src/proxy.ts と枠(layout.tsx)に加えて、ここでも行う(メールを出すため。layout だけに頼らない)
export default async function SettingsPage() {
  const email = await currentUserEmail();
  if (!email) redirect("/login");
  return (
    <div className="view">
      <header className="vhead">
        <div className="vtitle">
          <h1>設定</h1>
        </div>
      </header>
      <ThemeSetting />
      <WorldSetting />
      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">アカウント</h2>
        <p>ログイン中のメールアドレス: <b data-testid="account-email">{email}</b></p>
        {/* ログアウトは POST のフォーム(リンクで GET にすると、別のサイトからも、先読みでも、ログアウトできてしまう。上の帯のボタンと同じ) */}
        <LogoutForm className={s.logout} />
      </section>
    </div>
  );
}
