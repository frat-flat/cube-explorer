// 画面から 4DB の API(/api/4db/*)を読む。失敗したときは、API が返した文(なければ状態の番号)を持つ Error にする
export async function api<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", signal: init?.signal });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j as { error?: string } | null)?.error ?? `うまくいきませんでした(${res.status})`);
  return j as T;
}
