"use client";

import { useState } from "react";
import { createAuthClient } from "@neondatabase/auth/next";
import { LoginLogo } from "./LoginLogo";
import styles from "./login.module.css";

const authClient = createAuthClient();

// 画面に出すのは、ここに決めた文だけ。上流(Neon Auth)が返す文は、内部の事情や英語の文が混じるので見せない(何も記録もしない)
const SEND_TOO_OFTEN = "コードを送れませんでした。しばらく待ってから、もう一度送ってください。";
const SEND_FAILED = "コードを送れませんでした。メールアドレスを確かめて、もう一度送ってください。";
const SEND_NO_NETWORK = "コードを送れませんでした。通信できなかったようです。通信の状態を確かめて、もう一度送ってください。";
const CODE_WRONG = "コードが違うか、期限が切れています。もう一度確かめるか、コードを送り直してください。";
const SIGN_IN_NO_NETWORK = "ログインできませんでした。通信できなかったようです。通信の状態を確かめて、もう一度試してください。";

/**
 * 失敗の HTTP の状態(429 など)。Neon Auth の部品は、サーバーが断ったときは status 付きの例外を投げ(返り値の error のこともある)、
 * 通信そのものができなかったときは status のない例外(TypeError: Failed to fetch など)を投げる。status がなければ 0
 */
function httpStatus(e: unknown): number {
  const n = Number((e as { status?: unknown } | null)?.status);
  return Number.isFinite(n) ? n : 0;
}
const sendFailureMessage = (status: number) => (status === 429 ? SEND_TOO_OFTEN : status >= 400 ? SEND_FAILED : SEND_NO_NETWORK);
const signInFailureMessage = (status: number) => (status >= 400 ? CODE_WRONG : SIGN_IN_NO_NETWORK);

// メールアドレスに届く6桁のコードでログインする(Neon Auth のメールコード)
export function LoginForm({ deniedEmail }: { deniedEmail?: string }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // サーバーが断ったときも、通信そのものが失敗したとき(ネットワークが切れている・中継の API に届かない)も、例外になる。
  // どちらでもボタンを元に戻し、何が起きたかと次にすることを出す(以前は「送信中…」のまま止まっていた)
  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (error) setMessage(sendFailureMessage(httpStatus(error) || 500));
      else setStep("code");
    } catch (err) {
      setMessage(sendFailureMessage(httpStatus(err)));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    let leaving = false;
    try {
      const { error } = await authClient.signIn.emailOtp({ email, otp: otp.trim() });
      if (error) {
        setMessage(signInFailureMessage(httpStatus(error) || 400));
        return;
      }
      leaving = true; // 画面を読み込み直すので、ボタンは戻さない
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 入金キューブは素の JS なので読み込み直す
      location.href = "/"; // 見てよい人かどうかはサーバー側で確かめる
    } catch (err) {
      setMessage(signInFailureMessage(httpStatus(err)));
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  if (deniedEmail) {
    return (
      <main className={styles.wrap}>
        <h1 className={styles.title}>4DB</h1>
        <LoginLogo />
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
      <h1 className={styles.title}>4DB</h1>
      <LoginLogo />
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
      {message && <p className={styles.error} role="alert">{message}</p>}
    </main>
  );
}
