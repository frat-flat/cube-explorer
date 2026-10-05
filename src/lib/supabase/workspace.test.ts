import { afterEach, describe, expect, it, vi } from "vitest";
import { headers, isState, loadWorkspace, saveWorkspace, supabaseConfig, WorkspaceError } from "./workspace";

const cfg = { url: "https://abc.supabase.co", key: "sb_secret_x" };
const state = { axes: [], boxes: [], sheets: [], saved: [], dict: [], history: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("supabaseConfig", () => {
  it("URL と鍵がそろうときだけ返し、末尾の / を外す", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(supabaseConfig()).toBeNull();
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    expect(supabaseConfig()).toEqual(cfg);
  });
});

describe("headers", () => {
  it("新しい鍵は apikey だけ、JWT の鍵は Authorization にも入れる", () => {
    expect(headers("sb_secret_x").authorization).toBeUndefined();
    expect(headers("eyJabc").authorization).toBe("Bearer eyJabc");
  });
});

describe("isState", () => {
  it("6つの一覧がそろった形だけ通す", () => {
    expect(isState(state)).toBe(true);
    expect(isState({ ...state, dict: null })).toBe(false);
    expect(isState([])).toBe(false);
    expect(isState(null)).toBe(false);
  });
});

describe("loadWorkspace / saveWorkspace", () => {
  it("持ち主で絞って読み、無ければ null", async () => {
    const f = vi.fn().mockResolvedValueOnce(Response.json([{ state, updated_at: "t1" }])).mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", f);
    expect(await loadWorkspace(cfg, "a@b.jp")).toEqual({ state, updatedAt: "t1" });
    expect(String(f.mock.calls[0][0])).toContain("owner=eq.a%40b.jp");
    expect(await loadWorkspace(cfg, "a@b.jp")).toBeNull();
  });

  it("持ち主ごとに上書き保存する", async () => {
    const f = vi.fn().mockResolvedValue(Response.json([{ updated_at: "t2" }]));
    vi.stubGlobal("fetch", f);
    expect(await saveWorkspace(cfg, "a@b.jp", state)).toBe("t2");
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("on_conflict=owner");
    expect(init.headers.prefer).toContain("merge-duplicates");
    expect(JSON.parse(init.body)[0]).toMatchObject({ owner: "a@b.jp", state });
  });

  it("Supabase がエラーを返したら WorkspaceError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 401 })));
    await expect(loadWorkspace(cfg, "a")).rejects.toBeInstanceOf(WorkspaceError);
  });
});
