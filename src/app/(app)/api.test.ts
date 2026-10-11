// 画面から 4DB の API を読む・書く道具(api.ts)。通信は作り物を渡す。
// M-4: 成功(200)なのに本文が読めない・取りやめで本文が途中で切れたとき、null を成功として返すと、画面が null を触って壊れた。
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stubFetch = (f: (url: string, init: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(f);
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("api", () => {
  it("成功(200)で本文が読めれば、その中身を返す", async () => {
    stubFetch(async () => json({ ok: 1 }));
    await expect(api<{ ok: number }>("/api/4db/x")).resolves.toEqual({ ok: 1 });
  });

  it("method と body を渡すと、その方法で JSON を送る。渡さなければ GET で本文なし", async () => {
    const f = stubFetch(async () => json({ ok: 1 }));
    await api("/api/4db/x");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined, headers: undefined, credentials: "same-origin" });
    await api("/api/4db/x", { method: "POST", body: { a: 1 } });
    expect(f.mock.calls[1][1]).toMatchObject({ method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });
  });

  it("失敗(200 以外)では、API が返した文を持つ Error にする。文がない・本文が読めないときは状態の番号", async () => {
    stubFetch(async () => json({ error: "表の定義が見つかりません" }, 404));
    await expect(api("/api/4db/x")).rejects.toThrow("表の定義が見つかりません");
    stubFetch(async () => json({}, 500));
    await expect(api("/api/4db/x")).rejects.toThrow("うまくいきませんでした(500)");
    stubFetch(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api("/api/4db/x")).rejects.toThrow("うまくいきませんでした(502)");
  });

  it("成功(200)でも、本文が空・JSON でない・null なら、成功として返さず失敗にする(null を画面に渡さない)", async () => {
    for (const body of ["", "<html>not json</html>", "null"]) {
      stubFetch(async () => new Response(body, { status: 200 }));
      await expect(api("/api/4db/x")).rejects.toThrow("うまくいきませんでした(200)");
    }
  });

  it("本文を読んでいる間に取りやめになったら、null を返さず、取りやめのまま投げる(呼び出し側は signal.aborted を見て捨てる)", async () => {
    // 本物の fetch と同じく、取りやめると本文の流れが AbortError で切れる(ヘッダーは届いたあと)
    stubFetch(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const ctrl = new AbortController();
    const p = api("/api/4db/projection", { method: "POST", body: {}, signal: ctrl.signal });
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: Error) => ({ ok: false as const, name: e.name }),
    );
    await new Promise((r) => setTimeout(r, 10)); // ヘッダーを受け取り、本文を待つところまで進める
    ctrl.abort();
    expect(await settled).toEqual({ ok: false, name: "AbortError" });
  });

  it("取りやめる前に届いた失敗(404 など)は、取りやめになっていなければ、これまでどおり文を持つ Error にする", async () => {
    stubFetch(async () => json({ error: "軸が見つかりません" }, 404));
    await expect(api("/api/4db/x", { signal: new AbortController().signal })).rejects.toThrow("軸が見つかりません");
  });
});
