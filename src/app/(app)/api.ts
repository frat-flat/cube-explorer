// 画面から 4DB の API(/api/4db/*)を読む・書く。失敗したときは、API が返した文(なければ状態の番号)を持つ Error にする
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    signal: init?.signal,
  });
  // 本文を読んでいる間に取りやめになったときは、空の返事(null)にせず、取りやめのまま投げる(呼び出し側は signal.aborted を見て捨てる)
  const j = await res.json().catch((e) => {
    if (init?.signal?.aborted) throw e;
    return null;
  });
  if (!res.ok) throw new Error((j as { error?: string } | null)?.error ?? `うまくいきませんでした(${res.status})`);
  // 成功なのに読める本文がないときは、成功として返さず失敗にする(null のまま画面に渡すと、画面が壊れる)
  if (j === null) throw new Error(`うまくいきませんでした(${res.status})`);
  return j as T;
}
