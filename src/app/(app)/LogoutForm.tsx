"use client";

import { clearStoredPending } from "./prefs-client";

/**
 * ログアウトの POST のフォーム(枠の帯と設定の画面で同じもの。リンクで GET にすると、別のサイトからも、先読みでも、ログアウトできてしまう)。
 * 送る直前に、この端末に残した「送っていない設定の変更」(localStorage)を消す。消さないと、同じブラウザで次にログインする別のアカウントへ、
 * 前の人の変更を送ってしまう。preventDefault はしない(消したあと、ふつうにフォームが POST される)。明暗のクッキーは残す。
 */
export function LogoutForm({ className, buttonClassName }: { className?: string; buttonClassName?: string }) {
  return (
    <form action="/auth/signout" method="post" className={className} onSubmit={clearStoredPending}>
      <button type="submit" className={buttonClassName}>
        ログアウト
      </button>
    </form>
  );
}
