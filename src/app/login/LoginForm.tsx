"use client";

import { useState } from "react";
import { createAuthClient } from "@neondatabase/auth/next";
import styles from "./login.module.css";

const authClient = createAuthClient();

// メールアドレスに届く6桁のコードでログインする(Neon Auth のメールコード)
export function LoginForm({ deniedEmail }: { deniedEmail?: string }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setBusy(false);
    if (error) setMessage(`コードを送れませんでした:${error.message ?? error.statusText}`);
    else setStep("code");
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await authClient.signIn.emailOtp({ email, otp: otp.trim() });
    if (error) {
      setBusy(false);
      setMessage("コードが違うか、期限が切れています。もう一度確かめるか、コードを送り直してください。");
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 入金キューブは素の JS なので読み込み直す
    location.href = "/"; // 見てよい人かどうかはサーバー側で確かめる
  }

  if (deniedEmail) {
    return (
      <main className={styles.wrap}>
        <h1 className={styles.title}>4D Base</h1>
        <p className={styles.error}>
          {deniedEmail} には閲覧の許可がありません。管理者に追加を依頼してください。
        </p>
        <p className={styles.note}>
          <a href="/auth/signout">別のメールアドレスでログインする</a>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>4D Base</h1>
      {step === "email" ? (
        <form onSubmit={sendCode} className={styles.form}>
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "送信中…" : "ログイン用のコードを送る"}</button>
          <p className={styles.note}>許可されたメールアドレスの人だけが閲覧できます。</p>
        </form>
      ) : (
        <form onSubmit={signIn} className={styles.form}>
          <label htmlFor="otp">{email} に届いた6桁のコード</label>
          <input id="otp" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "確認中…" : "ログイン"}</button>
          <p className={styles.note}>
            届かないときは迷惑メールも確かめてください。
            <button type="button" className={styles.link} onClick={() => { setStep("email"); setOtp(""); }}>
              メールアドレスを入れ直す
            </button>
          </p>
        </form>
      )}
      {message && <p className={styles.error}>{message}</p>}
    </main>
  );
}
