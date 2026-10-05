// ダッシュボード(軸の辞書と箱)の中身を、ログインした人ごとに Supabase へ1件で保存する。
// サーバーだけが秘密の鍵(SUPABASE_SECRET_KEY)で読み書きし、ブラウザに鍵は渡さない。
// 表 cube_workspaces は RLS をオンにして方針を置かないので、公開用の鍵(anon)からは読めない。

const TABLE = "cube_workspaces";
/** 1人分の中身の上限(JSON の文字数)。超えたら保存を断る */
export const MAX_STATE_BYTES = 5_000_000;

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type SupabaseConfig = { url: string; key: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\s+/g, "").replace(/\/+$/, "");
  // 鍵に空白や改行は入らないので、貼り付けで紛れ込んだ分は取り除く
  const key = (process.env.SUPABASE_SECRET_KEY ?? "").replace(/\s+/g, "");
  return url && key ? { url, key } : null;
}

/** 鍵の中身は出さずに、どんな形の値かだけを言う(入れ間違いを見つけるため) */
export function keyShape(key: string): string {
  const kind = key.startsWith("sb_secret_")
    ? "Secret key の形"
    : key.startsWith("sb_publishable_")
      ? "Publishable key(公開用)の形。Secret key を入れてください"
      : key.startsWith("eyJ")
        ? "古い形の鍵(JWT)。anon ではなく service_role か、新しい Secret key を入れてください"
        : "sb_secret_ で始まっていません";
  return `${kind}、${key.length}文字`;
}

/** 新しい形の鍵(sb_secret_…)は apikey だけ、古い形(JWT の service_role)は Authorization にも入れる */
export function headers(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("eyJ")) h.authorization = `Bearer ${key}`;
  return h;
}

export type Saved = { state: unknown; updatedAt: string } | null;

/** SUPABASE_URL が https://<ref>.supabase.co の形か。違えば何が違うかを返す(値そのものは返さない) */
export function urlProblem(url: string): string | null {
  if (!/^https:\/\//.test(url)) return "SUPABASE_URL が https:// で始まっていません";
  if (/supabase\.com\/dashboard/.test(url)) return "SUPABASE_URL が管理画面のアドレスになっています。https://<ref>.supabase.co の形にしてください";
  try {
    new URL(url);
  } catch {
    return "SUPABASE_URL がアドレスの形になっていません";
  }
  return null;
}

/** 問い合わせが届かない(アドレス違い・名前が引けない)ときも、落ちずに理由を返す */
async function call(cfg: SupabaseConfig, path: string, init: RequestInit): Promise<Response> {
  const bad = urlProblem(cfg.url);
  if (bad) throw new WorkspaceError(bad, 500);
  try {
    return await fetch(`${cfg.url}${path}`, init);
  } catch (e) {
    // エラー文には鍵の一部が入ることがあるので、そのままは返さない
    console.error(e);
    throw new WorkspaceError(`Supabase(${new URL(cfg.url).host})につながりません。SUPABASE_URL と SUPABASE_SECRET_KEY を確かめてください`, 502);
  }
}

export async function loadWorkspace(cfg: SupabaseConfig, owner: string): Promise<Saved> {
  const q = new URLSearchParams({ owner: `eq.${owner}`, select: "state,updated_at" });
  const res = await call(cfg, `/rest/v1/${TABLE}?${q}`, { headers: headers(cfg.key), cache: "no-store" });
  if (!res.ok) throw new WorkspaceError(`Supabase から読めませんでした(${res.status}${res.status === 401 ? `、SUPABASE_SECRET_KEY を確かめてください。いま入っている値: ${keyShape(cfg.key)}` : ""})`, 502);
  const rows = (await res.json()) as { state: unknown; updated_at: string }[];
  return rows[0] ? { state: rows[0].state, updatedAt: rows[0].updated_at } : null;
}

export async function saveWorkspace(cfg: SupabaseConfig, owner: string, state: unknown): Promise<string> {
  const body = JSON.stringify([{ owner, state, updated_at: new Date().toISOString() }]);
  if (body.length > MAX_STATE_BYTES) throw new WorkspaceError("保存する中身が大きすぎます", 413);
  const res = await call(cfg, `/rest/v1/${TABLE}?on_conflict=owner&select=updated_at`, {
    method: "POST",
    headers: { ...headers(cfg.key), prefer: "resolution=merge-duplicates,return=representation" },
    body,
  });
  if (!res.ok) throw new WorkspaceError(`Supabase に保存できませんでした(${res.status})`, 502);
  const rows = (await res.json()) as { updated_at: string }[];
  return rows[0]?.updated_at ?? "";
}

/** 画面が使う中身の形か(軸・箱・シート・まとめ・辞書・履歴がそろっている) */
export function isState(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return ["axes", "boxes", "sheets", "saved", "dict", "history"].every((k) => Array.isArray(s[k]));
}
