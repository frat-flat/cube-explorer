import type { Metadata } from "next";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/prefs";
import { ThemeSetting } from "./ThemeSetting";

export const metadata: Metadata = { title: "設定 | 4DB" };

// 設定(P1 は「画面の見た目」だけ。ほかの設定は P2 で新しいデータの上に作る)。ログインの確認は src/proxy.ts と枠(layout.tsx)
export default async function SettingsPage() {
  const saved = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="view">
      <header className="vhead">
        <div className="vtitle">
          <h1>設定</h1>
        </div>
      </header>
      <ThemeSetting initial={saved ?? "auto"} />
    </div>
  );
}
