import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ログアウトの入口。別のサイトからの要求ではログアウトしない。ログインの部品(Neon Auth)は Next の外では読み込めないので、差し替える
const signOut = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/auth", () => ({ auth: { signOut } }));
const { GET, POST } = await import("./route");

const url = "http://localhost:3000/auth/signout";
const req = (method: "GET" | "POST", headers: Record<string, string> = {}) => new NextRequest(url, { method, headers });

beforeEach(() => signOut.mockClear());

describe("ログアウト POST(枠のボタン)", () => {
  it("同じサイトからなら、ログアウトして /login へ(303。行き先は GET で開く)", async () => {
    const res = await POST(req("POST", { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("別のサイト(Sec-Fetch-Site: cross-site / same-site)からは、ログアウトせずに 403", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await POST(req("POST", { "sec-fetch-site": site }));
      expect(res.status, site).toBe(403);
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it("Sec-Fetch-Site がなければ Origin で見る。別のオリジンは 403、同じなら通す、どちらもなければ(ブラウザ以外)通す", async () => {
    expect((await POST(req("POST", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(req("POST", { origin: "not a url" }))).status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    expect((await POST(req("POST", { origin: "http://localhost:3000" }))).status).toBe(303);
    expect((await POST(req("POST"))).status).toBe(303);
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});

describe("ログアウト GET(同じサイトのリンクなどは今までどおり。別のサイトからは拒む)", () => {
  it("同じサイトのリンク(許可がない人の画面)と、アドレスを直接入れた場合(none)は、ログアウトして /login へ", async () => {
    for (const site of ["same-origin", "none"]) {
      const res = await GET(req("GET", { "sec-fetch-site": site }));
      expect(res.status, site).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    }
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("別のサイトのリンク・画像・先読み(cross-site / same-site)からは、ログアウトせずに 403", async () => {
    for (const site of ["cross-site", "same-site"]) expect((await GET(req("GET", { "sec-fetch-site": site }))).status, site).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});
