// QA(W6)が独自に足した、芯の性質の試験。作った側の試験(home.test.ts・prefs.test.ts・tasks.test.ts)とは別に、乱数(固定の種)で
// 「別の書き方で求めた期待」と比べる: orderUnits(並べ替えに左右されない・別の実装と一致)、formatPeriod(Date の計算と一致)、
// parseLookStrict / parseLookLenient / parsePrefsPatch(でたらめな入力でも落ちない・通ったものは許可リストの値だけ)、
// buildTaskOverview(シートはどれか 1 つに入る・件数は別に数えた数と一致)、sectionsOf(いつも 9 欄が固定の順)。
import { describe, expect, it } from "vitest";
import {
  buildHomeOverview,
  formatPeriod,
  HOME_LIMITS,
  orderUnits,
  SECTION_IDS,
  sectionsOf,
  type HomeUnit,
  type UnitGroup,
} from "./home";
import {
  DEFAULT_LOOK,
  LOOK_KEYS,
  LOOK_OPTIONS,
  parseLookLenient,
  parseLookStrict,
  parsePrefsPatch,
  patternOf,
  PATTERNS,
  type Look,
} from "./prefs";
import { buildTaskOverview, progressBucket, TASK_RUN_STATUSES, type RunStatus, type TaskRow } from "./tasks";

/** 固定の種の乱数(mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const shuffled = <T>(r: () => number, xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

describe("QA: orderUnits(規則 R)", () => {
  /** 別の書き方の期待: 単位ごとに足し、「子のある → 数が多い → 名前(UTF-16・単位なしは最後)」で、いちばん良いものを 1 つずつ取り出す */
  function oracle(groups: UnitGroup[]) {
    const pool = new Map<string | null, { count: number; kids: boolean }>();
    for (const g of groups) {
      const k = g.unitType === "" || g.unitType === null ? null : g.unitType;
      const c = Math.trunc(g.count);
      if (!(c > 0)) continue;
      const p = pool.get(k) ?? { count: 0, kids: false };
      p.count += c;
      p.kids = p.kids || g.hasChildren;
      pool.set(k, p);
    }
    const out: { unitType: string | null; count: number; hasChildren: boolean }[] = [];
    while (pool.size) {
      let best: string | null | undefined;
      for (const [k, v] of pool) {
        if (best === undefined) {
          best = k;
          continue;
        }
        const b = pool.get(best)!;
        const better =
          v.kids !== b.kids ? v.kids
          : v.count !== b.count ? v.count > b.count
          : k === null ? false
          : best === null ? true
          : k < best;
        if (better) best = k;
      }
      const v = pool.get(best as string | null)!;
      out.push({ unitType: best as string | null, count: v.count, hasChildren: v.kids });
      pool.delete(best as string | null);
    }
    return out;
  }

  it("でたらめな入力 300 通りで、別の実装と同じ・並べ替えても同じ・6 つまでを立体に・残りは ほかの単位(30 件まで + more)", () => {
    const r = rng(20261010);
    const names = ["店舗", "法人", "部署", "A", "a", "あ", "拠点", "担当者", "契約", "z", "Z", "店舗 ", "", null];
    for (let t = 0; t < 300; t++) {
      const n = Math.floor(r() * 80);
      const groups: UnitGroup[] = Array.from({ length: n }, () => ({
        unitType: pick(r, names),
        count: pick(r, [0, -3, 1, 2, 3, 5, 5, 10, 100, 100, 2.9]),
        hasChildren: r() < 0.3,
      }));
      const want = oracle(groups);
      const got = orderUnits(groups);
      expect(got.shown, `#${t}`).toEqual(want.slice(0, 6));
      expect(got.others.items.map((x) => ({ unitType: x.unitType, count: x.count })), `#${t} others`).toEqual(want.slice(6, 36).map((x) => ({ unitType: x.unitType, count: x.count })));
      expect(got.others.more, `#${t} more`).toBe(Math.max(0, want.length - 36));
      expect(got.shown.length).toBeLessThanOrEqual(HOME_LIMITS.units);
      for (let k = 0; k < 3; k++) expect(orderUnits(shuffled(r, groups)), `#${t} shuffle`).toEqual(got);
    }
  });
});

describe("QA: formatPeriod(終わりを含まない → 1 日戻す)", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const ym = (d: Date) => iso(d).slice(0, 7);

  it("ランダムな日付 2,000 組で、Date の計算(終わりの 1 日前の月)と一致する", () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const s = new Date(Date.UTC(1990 + Math.floor(r() * 60), Math.floor(r() * 12), 1 + Math.floor(r() * 28)));
      const e = new Date(s.getTime() + (1 + Math.floor(r() * 1500)) * 86_400_000);
      const last = new Date(e.getTime() - 86_400_000);
      expect(formatPeriod(iso(s), iso(e)), `${iso(s)} 〜 ${iso(e)}`).toEqual({ from: ym(s), to: ym(last) });
    }
  });

  it("月の 1 日から次の月の 1 日(含まない)は 1 か月。うるう年の 2 月も", () => {
    expect(formatPeriod("2024-02-01", "2024-03-01")).toEqual({ from: "2024-02", to: "2024-02" });
    expect(formatPeriod("2023-02-01", "2023-03-01")).toEqual({ from: "2023-02", to: "2023-02" });
    expect(formatPeriod("2025-10-01", "2026-10-01")).toEqual({ from: "2025-10", to: "2026-09" });
    expect(formatPeriod("2025-12-01", "2026-01-01")).toEqual({ from: "2025-12", to: "2025-12" });
  });

  it("でたらめな文字を渡しても落ちず、null か月の範囲を返す", () => {
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const junk = pick(r, ["", "x", "2026", "2026-13-01", "2026-02-30", "2026-1-1", "２０２６-01-01", " 2026-01-01", null, undefined, "2026-01-01T00:00:00Z", "0000-00-00", "9999-12-31"]);
      const out = formatPeriod(junk as string | null | undefined, pick(r, ["2027-01-01", "x", null, undefined]) as string | null | undefined);
      if (out) expect(out.from <= out.to || out.from.length === 7).toBe(true);
    }
  });
});

describe("QA: 見た目(Look)・設定の読み書き", () => {
  const junkValues = (r: () => number): unknown[] => [
    null, undefined, 0, 1, -1, NaN, true, false, "", "glass", "GLASS", " glass", "glass ", [], ["glass"], {}, { shape: "glass" }, () => 1, Symbol("x"), BigInt(10),
    new Map(), new Date(0), "__proto__", "constructor", { __proto__: { shape: "glass" } }, JSON.parse('{"__proto__":{"shape":"glass"}}'), "x".repeat(10_000), r(),
  ];

  it("parseLookLenient: どんな入力でも落ちず、いつも許可リストの値の 6 つ。新しいオブジェクトで、DEFAULT_LOOK を書き換えない", () => {
    const r = rng(3);
    const snapshot = JSON.stringify(DEFAULT_LOOK);
    for (let i = 0; i < 400; i++) {
      const input: Record<string, unknown> = {};
      for (const k of [...LOOK_KEYS, "extra", "__proto__"]) if (r() < 0.7) input[k] = pick(r, junkValues(r));
      const out = parseLookLenient(r() < 0.1 ? pick(r, junkValues(r)) : input);
      expect(Object.keys(out).sort()).toEqual([...LOOK_KEYS].sort());
      for (const k of LOOK_KEYS) expect((LOOK_OPTIONS[k] as readonly string[]).includes(out[k]), `${k}=${out[k]}`).toBe(true);
      expect(out).not.toBe(DEFAULT_LOOK);
    }
    expect(JSON.stringify(DEFAULT_LOOK)).toBe(snapshot);
    expect(({} as Record<string, unknown>).shape, "Object.prototype を汚さない").toBeUndefined();
  });

  it("parseLookStrict: 許可リストの値 6 つだけが通り、通ったものは入力と同じ中身の新しいオブジェクト。部品を 1 つ壊すと必ず断る", () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      const look = Object.fromEntries(LOOK_KEYS.map((k) => [k, pick(r, LOOK_OPTIONS[k] as readonly string[])])) as Look;
      const ok = parseLookStrict(look);
      expect(typeof ok).toBe("object");
      expect(ok).toEqual(look);
      expect(ok).not.toBe(look);
      const k = pick(r, LOOK_KEYS);
      for (const bad of junkValues(r).filter((v) => !(typeof v === "string" && (LOOK_OPTIONS[k] as readonly string[]).includes(v)))) {
        expect(typeof parseLookStrict({ ...look, [k]: bad }), `${k} = ${String(bad).slice(0, 20)}`).toBe("string");
      }
      const missing = { ...look } as Partial<Look>;
      delete missing[k];
      expect(typeof parseLookStrict(missing)).toBe("string");
      expect(typeof parseLookStrict({ ...look, zzz: 1 })).toBe("string");
    }
  });

  it("patternOf: 8 つのパターンはそれぞれ自分の番号に当たり、部品を 1 つでも変えるとどれにも当たらない(別のパターンに当たる変え方を除く)", () => {
    for (const p of PATTERNS) {
      expect(patternOf({ ...p.look })?.id).toBe(p.id);
      for (const k of LOOK_KEYS) {
        for (const v of LOOK_OPTIONS[k] as readonly string[]) {
          if (v === p.look[k]) continue;
          const changed = { ...p.look, [k]: v } as Look;
          const hit = PATTERNS.find((q) => LOOK_KEYS.every((kk) => q.look[kk] === changed[kk]));
          expect(patternOf(changed)?.id ?? null, `パターン ${p.id} の ${k} を ${v} に`).toBe(hit?.id ?? null);
        }
      }
    }
  });

  it("parsePrefsPatch: 送られた欄だけが返り、知らない欄・壊れた値は断る(でたらめな本文 500 通り)", () => {
    const r = rng(9);
    const validLook = () => Object.fromEntries(LOOK_KEYS.map((k) => [k, pick(r, LOOK_OPTIONS[k] as readonly string[])]));
    for (let i = 0; i < 500; i++) {
      const body: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      if (r() < 0.5) body.theme = want.theme = pick(r, ["dark", "light", null]);
      if (r() < 0.5) body.world = want.world = "plain";
      if (r() < 0.5) body.look = want.look = validLook();
      const out = parsePrefsPatch(body);
      if (Object.keys(body).length === 0) expect(typeof out).toBe("string");
      else expect(out).toEqual(want);
      if (Object.keys(body).length) {
        expect(typeof parsePrefsPatch({ ...body, extra: 1 })).toBe("string");
        expect(typeof parsePrefsPatch({ ...body, theme: pick(r, ["blue", 1, true, [], {}, ""]) })).toBe("string");
      }
    }
  });
});

describe("QA: Task の分け方", () => {
  const STATUSES: RunStatus[] = ["reading", "staged", "applying", "applied", "failed", "cancelled"];

  /** 別の書き方の分け方(決まりの表をそのまま書く) */
  function bucket(row: TaskRow): "migrated" | "inProgress" | "imported" | "failed" | "notStarted" {
    if (row.migrationStatus === "migrated") return "migrated";
    if (!row.hasUncancelledRun) return "notStarted";
    const s = row.lastRun?.status;
    if (s === "staged" || s === "reading" || s === "applying") return "inProgress";
    if (row.lastReadAt || s === "applied") return "imported";
    return "failed";
  }

  it("シート 1,000 通りの状態の組み合わせで、progressBucket が決まりの表と同じ。buildTaskOverview はどのシートも 1 つの行へ入れ、件数は別に数えた数と同じ", () => {
    const r = rng(13);
    const rows: TaskRow[] = Array.from({ length: 1000 }, (_, i) => {
      const status = r() < 0.2 ? null : pick(r, STATUSES);
      return {
        sheetId: `s${i}`,
        sheet: `シート${i}`,
        fileId: `f${Math.floor(i / 10)}`,
        file: `ファイル${Math.floor(i / 10) % 40}`,
        migrationStatus: r() < 0.2 ? "migrated" : "migrating",
        lastReadAt: r() < 0.5 ? "2026-10-01T00:00:00.000Z" : null,
        hasUncancelledRun: status === null ? false : status === "cancelled" ? r() < 0.3 : true,
        lastRun: status === null ? null : { id: `r${i}`, status, startedAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(r() * 1e10)).toISOString(), finishedAt: null },
      };
    });
    for (const row of rows) expect(progressBucket(row)).toBe(bucket(row));
    const o = buildTaskOverview(rows);
    const wantCount = rows.filter((x) => x.lastRun && (TASK_RUN_STATUSES as readonly string[]).includes(x.lastRun.status)).length;
    expect(o.count).toBe(wantCount);
    expect(o.items.items.length + o.items.more).toBe(wantCount);
    const files = o.files.items;
    expect(o.files.more).toBe(0);
    expect(files.reduce((a, f) => a + f.started + f.notStarted, 0), "どのシートも 1 つの行にだけ入る").toBe(rows.length);
    for (const f of files) {
      expect(f.started).toBe(f.migrated + f.inProgress + f.imported + f.failed);
      const mine = rows.filter((x) => x.fileId === f.fileId);
      for (const b of ["migrated", "inProgress", "imported", "failed", "notStarted"] as const) expect(f[b], `${f.fileId} ${b}`).toBe(mine.filter((x) => bucket(x) === b).length);
    }
    // 一覧は 承認待ち → 失敗 → 途中 の順で、同じ種類の中では新しい順
    const order = { approval: 0, failed: 1, in_progress: 2 } as const;
    for (let i = 1; i < o.items.items.length; i++) {
      const [a, b] = [o.items.items[i - 1], o.items.items[i]];
      expect(order[a.kind] <= order[b.kind]).toBe(true);
      if (a.kind === b.kind) expect(Date.parse(a.startedAt) >= Date.parse(b.startedAt)).toBe(true);
    }
    // 取り込みの error の文は入らない(形の確かめ)
    for (const it of o.items.items) expect(Object.keys(it).sort()).toEqual(["file", "fileId", "finishedAt", "kind", "runId", "runStatus", "sheet", "sheetId", "startedAt"]);
  });
});

describe("QA: ホームの欄", () => {
  it("sectionsOf: どんな単位でも、9 つの欄が固定の順(値がなければ null)。buildHomeOverview の単位は 6 つまで", () => {
    const r = rng(17);
    for (let i = 0; i < 200; i++) {
      const has = () => r() < 0.5;
      const unit: HomeUnit = {
        key: "u:x",
        unitType: "x",
        count: 1 + Math.floor(r() * 99),
        names: { items: has() ? ["a", "b"] : [], more: 0 },
        inside: has() ? { items: has() ? [{ unitType: "y", count: 2 }] : [], more: 0 } : null,
        cardFields: has() ? { items: has() ? ["c"] : [], more: 0 } : null,
        measures: has() ? { items: has() ? [{ name: "m", calculated: has() }] : [], more: 0 } : null,
        period: has() ? { from: "2026-01", to: "2026-02" } : null,
        sheets: has() ? { items: has() ? [{ sheetId: "s", file: "f", sheet: "t" }] : [], more: 0, lastReadAt: has() ? "2026-10-10T00:00:00.000Z" : null } : null,
        tables: has() ? { items: has() ? [{ id: "i", name: "n" }] : [], more: 0 } : null,
      };
      const secs = sectionsOf(unit);
      expect(secs.map((s) => s.id)).toEqual([...SECTION_IDS]);
      expect(secs.find((s) => s.id === "cube")!.value).toBeNull();
      expect(secs.find((s) => s.id === "bands")!.value).toBeNull();
      // 空の一覧は「値なし」(null)。値のある一覧はそのまま
      expect(secs.find((s) => s.id === "names")!.value === null).toBe(unit.names.items.length === 0);
      expect(secs.find((s) => s.id === "period")!.value === null).toBe(unit.period === null);
    }
    const o = buildHomeOverview({ groups: [], topBoxes: 0, units: new Map(), tables: [] });
    expect(o.units).toEqual([]);
  });
});
