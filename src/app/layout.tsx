import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cube Explorer",
  description: "既存のRDBを立体的(多軸)に閲覧・探索する",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
