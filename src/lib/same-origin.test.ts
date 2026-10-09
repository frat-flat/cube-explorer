import { describe, expect, it } from "vitest";
import { sameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

describe("同じサイトからの要求か(Sec-Fetch-Site / Origin)", () => {
  it("Sec-Fetch-Site があれば、same-origin だけを通す", () => {
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    for (const site of ["cross-site", "same-site", "none"]) expect(sameOrigin(req({ "sec-fetch-site": site })), site).toBe(false);
    // Sec-Fetch-Site が優先(Origin が同じに見えても、cross-site なら拒む)
    expect(sameOrigin(req({ "sec-fetch-site": "cross-site", origin: "http://localhost:3000" }))).toBe(false);
  });

  it("なければ Origin のホストで見る。どちらもなければ(ブラウザ以外)通す", () => {
    expect(sameOrigin(req({ origin: "http://localhost:3000" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ origin: "http://localhost:3001" }))).toBe(false);
    expect(sameOrigin(req({ origin: "garbage" }))).toBe(false);
    expect(sameOrigin(req({}))).toBe(true);
  });
});
