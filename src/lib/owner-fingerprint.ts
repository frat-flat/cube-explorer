// 設定の送り先のアカウントを取り違えないための指紋(L-4)。サーバーだけで使う(node:crypto)。形と運び方(ヘッダー名・code)は芯 src/fourdb/core/prefs/owner.ts。
//
// 指紋 = HMAC-SHA-256(鍵, "4db/prefs-owner/v1\0" + principal) の先頭 128 ビットを base64url にした 22 文字。
// - 鍵つきの一方向の計算なので、指紋から principal(neon:<ユーザー ID>)は分からない。鍵を知らないと、他人の指紋も作れない。
// - 鍵はログインのクッキーの秘密(NEON_AUTH_COOKIE_SECRET)。本番では、これがなければログインが成り立たない(principal が作られない)ので、新しい環境変数は要らない。
//   ラベル(プロトコル名と版)を前に付けて、同じ鍵をログインの用途と混ぜない。秘密を替えると指紋が変わる
//   (開いたままの画面の送信は 409 で断られ、画面は読み込み直す。その画面の送っていない変更が 1 回分捨てられるだけ)。
// - 秘密がないのは、ログインの設定がない手元の開発(FOURDB_LOCAL_DEV=1 の local-dev)だけ。そのときだけ決まった鍵を使う。本番ビルドでは使わず、止める。
import { createHmac, timingSafeEqual } from "node:crypto";
import { isOwnerFingerprint } from "@/fourdb/core/prefs";

const LABEL = "4db/prefs-owner/v1";
/** ログインの設定がない手元の開発だけで使う鍵(秘密ではない。local-dev の指紋は、手元以外では意味を持たない) */
const LOCAL_DEV_KEY = "4db-local-dev-owner-fingerprint-key";

function fingerprintKey(): string {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? "";
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("owner fingerprint: NEON_AUTH_COOKIE_SECRET がありません");
  return LOCAL_DEV_KEY;
}

/** このアカウント(principal)の指紋(22 文字の base64url) */
export function ownerFingerprint(principal: string): string {
  return createHmac("sha256", fingerprintKey()).update(`${LABEL}\0${principal}`).digest().subarray(0, 16).toString("base64url");
}

/** 画面が送ってきた指紋(presented)が、このアカウントのものか。なし・形の違うものは false(指紋のない要求は通さない) */
export function ownerMatches(principal: string, presented: string | null): boolean {
  if (!isOwnerFingerprint(presented)) return false;
  const a = Buffer.from(ownerFingerprint(principal));
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}
