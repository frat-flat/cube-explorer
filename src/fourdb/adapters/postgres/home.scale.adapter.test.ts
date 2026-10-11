// ホーム・Task・件数の「本物のつなぎ」(adapters/postgres/home.ts・tasks.ts の loadHome・loadTasks・countTasks)の規模での速さ。QA(W6)が足した。
// home.scale.test.ts は、試験の中に書いた下書きの SQL を測る。ここは製品のコードそのものを測る(下書きと本物がずれていても気づくため)。
// 前提・流し方は home.scale.test.ts と同じ(test/scale.sql → test/scale_home.sql の V1 か V2 を流した、手元の使い捨てデータベース):
//   FOURDB_SCALE_APP_URL=postgres://fourdb_scale_app@localhost:55432/<db> npx vitest run src/fourdb/adapters/postgres/home.scale.adapter.test.ts --silent=false
// FOURDB_SCALE_APP_URL がなければ飛ばす。手元でなければ止める。読むだけ(書き込まない)。
// 目安(home V1 300ms・V2 1,000ms、tasks 100ms、件数 50ms)との比べは、計算された値の索引(0007)があるときだけ確かめる(ないときは出すだけ)。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, isLocalDatabase, withScope, type Scope, type Tx } from "./db";
import { loadHome } from "./home";
import { countTasks, loadTasks } from "./tasks";

const URL_ = process.env.FOURDB_SCALE_APP_URL;
const WS = "f0000000-0000-0000-0000-000000000001";
const SCOPE: Scope = { principal: "scale:owner", workspaceId: WS };
const RUNS = 5;
const TARGET = { homeV1: 300, homeV2: 1000, tasks: 100, count: 50 };

type Measured = { label: string; ms: number[]; median: number };
const results: Measured[] = [];

/** 1 回目は捨て、続けて 5 回の真ん中の値。withScope(begin・設定・commit)を含めた時間 */
async function measure<T>(label: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  await withScope(SCOPE, fn);
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    out = await withScope(SCOPE, fn);
    ms.push(performance.now() - t);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  results.push({ label, ms, median: sorted[Math.floor(RUNS / 2)] });
  return out;
}

describe.skipIf(!URL_)("本物のつなぎ(loadHome・loadTasks・countTasks)の規模", () => {
  let variant: "V1" | "V2" = "V1";
  let index0007 = false;

  beforeAll(async () => {
    if (!isLocalDatabase(URL_!)) throw new Error("FOURDB_SCALE_APP_URL は手元のデータベース(localhost)だけにしてください");
    process.env.FOURDB_DATABASE_URL = URL_;
    const [r] = await withScope(SCOPE, (tx) => tx<{ top: number; idx: boolean }[]>`
      select (select count(*)::int from fourdb.box where workspace_id = ${WS} and parent_id is null) as top,
             pg_catalog.to_regclass('fourdb.value_calculated') is not null as idx`);
    if (r.top === 0) throw new Error("先に test/scale.sql と test/scale_home.sql を流してください");
    variant = r.top > 1000 ? "V2" : "V1";
    index0007 = r.idx;
  });

  afterAll(async () => {
    const homeTarget = variant === "V1" ? TARGET.homeV1 : TARGET.homeV2;
    const rows = results.map((r) => `| ${r.label} | ${r.median.toFixed(1)} | ${r.ms.map((x) => x.toFixed(1)).join(" / ")} |`);
    console.log(
      [`\n### 本物のつなぎ ${variant}・0007 の索引 ${index0007 ? "あり" : "なし"}(目安: home ${homeTarget}ms・tasks ${TARGET.tasks}ms・件数 ${TARGET.count}ms)`,
        "| 測ったもの | 真ん中(ms) | 5 回(ms) |", "|---|---:|---|", ...rows].join("\n"),
    );
    await db().end();
  });

  it("loadHome・loadTasks・countTasks を測る。中身は scale.sql・scale_home.sql の形どおり。Task の一覧の count と件数が同じ", async () => {
    const home = await measure("loadHome", (tx) => loadHome(tx, SCOPE));
    const tasks = await measure("loadTasks", (tx) => loadTasks(tx, SCOPE));
    const count = await measure("countTasks", (tx) => countTasks(tx, SCOPE));

    // 中身(scale.sql・scale_home.sql の形から決まるもの。home.scale.test.ts の下書きと同じ期待)
    const byUnit = new Map(home.units.map((u) => [u.unitType, u]));
    const corp = byUnit.get("法人")!;
    expect(corp.count).toBe(500);
    expect(corp.measures!.items.find((m) => m.name === "項目11")!.calculated).toBe(true);
    expect(corp.measures!.items.find((m) => m.name === "項目01")!.calculated).toBe(false);
    expect(corp.period).toEqual({ from: "2026-01", to: "2026-12" });
    expect(corp.sheets!.items.length).toBe(3);
    expect(corp.sheets!.more).toBe(990 - 3);
    expect(corp.tables!.items.length).toBe(3);
    if (variant === "V1") {
      expect(home.topBoxes).toBe(500);
      expect(home.units.map((u) => u.unitType)).toEqual(["法人"]);
      expect(corp.inside!.items).toEqual([{ unitType: "店舗", count: 8000 }]);
      expect(corp.cardFields).toBeNull();
    } else {
      expect(home.topBoxes).toBe(8500);
      expect(home.units.map((u) => u.unitType)).toEqual(["店舗", "法人"]);
      const shop = byUnit.get("店舗")!;
      expect(shop.count).toBe(8000);
      expect(shop.inside).toBeNull();
      expect(shop.cardFields!.items).toEqual(["課税区分"]);
      expect(shop.period).toEqual({ from: "2026-01", to: "2026-12" });
    }
    expect(tasks.count).toBe(count);
    expect(count).toBeGreaterThan(0);

    if (index0007) {
      const homeTarget = variant === "V1" ? TARGET.homeV1 : TARGET.homeV2;
      const med = (l: string) => results.find((r) => r.label === l)!.median;
      expect.soft(med("loadHome"), `loadHome ${variant} の目安 ${homeTarget}ms`).toBeLessThanOrEqual(homeTarget);
      expect.soft(med("loadTasks"), `loadTasks の目安 ${TARGET.tasks}ms`).toBeLessThanOrEqual(TARGET.tasks);
      expect.soft(med("countTasks"), `countTasks の目安 ${TARGET.count}ms`).toBeLessThanOrEqual(TARGET.count);
    }
  }, 600_000);
});
