import { createSign } from "node:crypto";

// Google スプレッドシートを、システム用のアカウント(サービスアカウント)で読むための部品(鍵・認証・リンクの読み方・API の呼び出し)。
// 取り込み(src/fourdb/adapters/google-sheets/reader.ts)がこれを使って、全行を分割して読む。
// 鍵は環境変数 GOOGLE_SERVICE_ACCOUNT_JSON に、Google Cloud で作った JSON をそのまま入れる。
// 読めるのは、そのアカウントのメールアドレスに共有されたスプシだけ。権限は閲覧のみ(spreadsheets.readonly)。
// GAS(Apps Script)はこのアカウントからは読めないので、ここでは扱わない。

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type ServiceAccount = { client_email: string; private_key: string };

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_configured" | "bad_url" | "not_shared" | "not_found" | "google",
  ) {
    super(message);
  }
}

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** スプシの URL(または ID そのもの)から ID を取り出す */
export function spreadsheetId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new SheetsError("システム用アカウントの鍵で Google にログインできませんでした。鍵を作り直して入れ直してください", 502, "google");
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function get(token: string, url: string, email: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 403) throw new SheetsError(`このスプシは共有されていません。スプシの「共有」で ${email} を閲覧者として追加してください`, 403, "not_shared");
  if (res.status === 404) throw new SheetsError("スプシが見つかりません。リンクを確かめてください", 404, "not_found");
  if (!res.ok) throw new SheetsError(`Google から読めませんでした(${res.status})`, 502, "google");
  return res.json();
}
