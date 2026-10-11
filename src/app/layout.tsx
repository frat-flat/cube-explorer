import type { Metadata } from "next";
import { IBM_Plex_Mono, Montserrat, Zen_Kaku_Gothic_New } from "next/font/google";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/prefs";
import "../styles/tokens.css";
import "../styles/components.css";
import "./globals.css";

// 書体は next/font で、ビルド時に取り込んで自分のサーバーから配る(実行中に Google へ通信しない)。
// 本文 = Zen Kaku Gothic New、数字と 4DB の字 = Montserrat、コード = IBM Plex Mono(D-012)
const sans = Zen_Kaku_Gothic_New({ weight: ["400", "500", "700"], preload: false, display: "swap", variable: "--font-sans" });
const display = Montserrat({ subsets: ["latin"], variable: "--font-display" });
const mono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], preload: false, variable: "--font-mono" });

export const metadata: Metadata = {
  title: "4DB",
  // タブとホーム画面のアイコン(tools/brand/build.mjs で作る)
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  description: "既存のRDBを立体的(多軸)に閲覧・探索する",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 見た目はクッキーに覚えてあり、サーバーが最初の HTML に data-theme として出す(ちらつかない。script は使わない)。
  // クッキーがなければ印を付けず、tokens.css が OS の明暗に合わせる。値は dark / light だけを受け付ける
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ja" data-theme={theme} className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
