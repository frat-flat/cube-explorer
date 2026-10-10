// ログインの失敗の文。画面に出すのは、ここに決めた文だけ(上流 = Neon Auth が返す文は、内部の事情や英語の文が混じるので見せない)。
// 失敗の HTTP の状態に合わせて選ぶ: 0 = 通信そのものができなかった / 429 = 送りすぎ・試しすぎ / 500 以上 = サーバー側の問題 / それ以外の 4xx = 入力が合わない

const SEND_NO_NETWORK = "コードを送れませんでした。通信できなかったようです。通信の状態を確かめて、もう一度送ってください。";
const SEND_TOO_OFTEN = "コードを送れませんでした。しばらく待ってから、もう一度送ってください。";
const SEND_SERVER = "コードを送れませんでした。サーバー側で問題が起きているようです。しばらく待ってから、もう一度送ってください。";
const SEND_REFUSED = "コードを送れませんでした。メールアドレスを確かめて、もう一度送ってください。";

const SIGN_IN_NO_NETWORK = "ログインできませんでした。通信できなかったようです。通信の状態を確かめて、もう一度試してください。";
const SIGN_IN_TOO_OFTEN = "ログインできませんでした。確認の回数が多すぎます。しばらく待ってから、もう一度試してください。";
const SIGN_IN_SERVER = "ログインできませんでした。サーバー側で問題が起きているようです。しばらく待ってから、もう一度試してください。";
const CODE_WRONG = "コードが違うか、期限が切れています。もう一度確かめるか、コードを送り直してください。";

/** コードの送信が失敗したときの文 */
export function sendFailureMessage(status: number): string {
  if (status === 429) return SEND_TOO_OFTEN;
  if (status >= 500) return SEND_SERVER;
  if (status >= 400) return SEND_REFUSED;
  return SEND_NO_NETWORK;
}

/** コードの確認(ログイン)が失敗したときの文 */
export function signInFailureMessage(status: number): string {
  if (status === 429) return SIGN_IN_TOO_OFTEN;
  if (status >= 500) return SIGN_IN_SERVER;
  if (status >= 400) return CODE_WRONG;
  return SIGN_IN_NO_NETWORK;
}
