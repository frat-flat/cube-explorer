import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isAllowedEmail, sessionEmail } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  await connection();
  const email = await sessionEmail();
  if (email && isAllowedEmail(email)) redirect("/");
  return <LoginForm deniedEmail={email ?? undefined} />;
}
