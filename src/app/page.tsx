import Script from "next/script";
import { redirect } from "next/navigation";
import { currentUserEmail } from "@/lib/auth";
import { explorerMarkup } from "./explorerMarkup";
import "./explorer.css";

// 入金キューブ。画面の HTML とスクリプトは explorer/ にあり、scripts/build-explorer.mjs でまとめている
export default async function Home() {
  if (!(await currentUserEmail())) redirect("/login");
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: explorerMarkup }} />
      <Script src="/explorer/bundle.js" strategy="afterInteractive" />
    </>
  );
}
