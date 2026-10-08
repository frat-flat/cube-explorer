import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "4DB",
  // タブとホーム画面のアイコン(tools/brand/build.mjs で作る。ダッシュボード public/sheets/axes.html も同じ画像を使う)
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  description: "既存のRDBを立体的(多軸)に閲覧・探索する",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
