/**
 * ブラウザが付ける Sec-Fetch-Site / Origin で、同じサイトからの要求かを見る(どちらもなければ、ブラウザ以外からの要求として通す)。
 * 書き込みの API(src/lib/fourdb.ts の requireScope)とログアウト(src/app/auth/signout/route.ts)で使う。
 * 別のサイトのページから、利用者のブラウザを使って書き込ませたりログアウトさせたりするのを防ぐ。
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
