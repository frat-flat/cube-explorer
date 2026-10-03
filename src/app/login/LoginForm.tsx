"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import styles from "./login.module.css";

const ERRORS: Record<string, string> = {
  link: "ログインリンクが無効か、期限が切れています。もう一度メールを送ってください。",
  denied: "このメールアドレスには閲覧の許可がありません。管理者に追加を依頼してください。",
};

export function LoginForm({ error }: { error?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [message, setMessage] = useState(error ? ERRORS[error] ?? "" : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setState("failed");
      setMessage(`メールを送れませんでした:${error.message}`);
    } else {
      setState("sent");
      setMessage("");
    }
  }

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>Cube Explorer</h1>
      {state === "sent" ? (
        <p className={styles.note}>
          {email} にログイン用のリンクを送りました。メールのリンクを開くと、この画面に戻ってログインできます。
        </p>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "送信中…" : "ログイン用のリンクを送る"}
          </button>
          <p className={styles.note}>許可されたメールアドレスの人だけが閲覧できます。</p>
        </form>
      )}
      {message && <p className={styles.error}>{message}</p>}
    </main>
  );
}
