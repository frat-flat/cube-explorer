import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isAllowedEmail, sessionEmail } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export default async function LoginPage() {
  await connection();
  const email = await sessionEmail();
  if (email && isAllowedEmail(email)) redirect("/");
  // 黒地(styles.page)は、通常のログインと「許可がありません」の両方にかける。
  // data-theme="dark" で、設定(明るい)や OS の明暗によらず「暗い」の色(src/styles/tokens.css)にする
  return (
    <div className={styles.page} data-theme="dark">
      <LoginForm deniedEmail={email ?? undefined} />
    </div>
  );
}
