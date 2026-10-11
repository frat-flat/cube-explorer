// 設定を「どのアカウントの画面から送ったか」を表す指紋(owner)の、形と運び方。
// 指紋はサーバーが、ログイン中のアカウント(principal)から鍵つきの一方向の計算で作り(src/lib/owner-fingerprint.ts)、画面を作るときに画面へ渡す。
// 画面は、送っていない変更に指紋を付けて残し、PUT のたびに OWNER_HEADER で送る。サーバーは、いまのログインの指紋と同じでなければ 409 で断る。
// 指紋から principal やメールアドレスは分からない(ここは形の確かめだけ。計算は node:crypto を使うサーバー側)。

/** PUT /api/4db/prefs で、画面が持っている指紋を載せる要求ヘッダー(本文は変えない。本文は parsePrefsPatch が厳しく読む) */
export const OWNER_HEADER = "x-4db-owner";

/** 別のアカウントの画面から送られたとき、サーバーが 409 と一緒に返す code */
export const OWNER_MISMATCH_CODE = "owner_mismatch";

/** 指紋は 128 ビットを base64url にした 22 文字 */
const OWNER_FORM = /^[A-Za-z0-9_-]{22}$/;

export const isOwnerFingerprint = (v: unknown): v is string => typeof v === "string" && OWNER_FORM.test(v);
