// 取り込みの結合テスト(手元の使い捨てデータベースで)。FOURDB_TEST_ADMIN_URL がなければ飛ばす。
// 例: FOURDB_TEST_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_it npx vitest run src/fourdb/adapters/postgres
// 毎回 fourdb を作り直し、試験用の役割 fourdb_it_app(superuser でも持ち主でもない)で、行ごとの権限がかかった状態で動かす。
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SourceCell } from "@/fourdb/core/import/types";
import { defaultSpec } from "@/fourdb/core/import/spec";
import type { SourceBook, SourceReader } from "@/fourdb/core/ports";
import { applyNext } from "./apply";
import { assertSafeRole, personalWorkspace, withScope, type Scope } from "./db";
import { checkApply, ImportError, keyFacts, proposal, readNext, registerBook, startRun } from "./import-store";
import { applyMigrations, grantApp } from "./migrate";
import { reconcile } from "./reconcile";

const ADMIN = process.env.FOURDB_TEST_ADMIN_URL;
const APP_ROLE = "fourdb_it_app";

type Raw = string | number | [number, string];
const cell = (x: Raw): SourceCell => (Array.isArray(x) ? { v: String(x[0]), n: x[0], f: x[1] } : typeof x === "number" ? { v: String(x), n: x, f: null } : { v: x, n: null, f: null });

/** 試験用の読み取り元(中身を差し替えて、読み直しを試す) */
function memoryReader(tabs: Record<string, Raw[][]>): SourceReader & { set(t: string, rows: Raw[][]): void } {
  const data = { ...tabs };
  return {
    set: (t, rows) => (data[t] = rows),
    async book(): Promise<SourceBook> {
      return {
        provider: "google_sheets", externalId: "it-book-1", title: "結合テスト", url: "https://docs.google.com/spreadsheets/d/it-book-1/edit",
        tabs: Object.entries(data).map(([title, rows], i) => ({ externalId: `g${i}`, title, rowCount: rows.length, colCount: Math.max(...rows.map((r) => r.length)) })),
      };
    },
    async rows(_b, tab, start, count) {
      return { rows: (data[tab.title] ?? []).slice(start, start + count).map((r) => r.map(cell)), merges: [] };
    },
  };
}

const TAB = "2026年 売上";
const first: Raw[][] = [
  ["2026年 店舗別売上"],
  ["店舗", "課税区分", "1月", "2月", "3月", "Q1計"],
  ["A店", "課税", 100, 200, 300, [600, "=SUM(C3:E3)"]],
  ["B店", "免税", 10, 20, 30, [60, "=SUM(C4:E4)"]],
  ["C店", "課税", 1, 2, 3, [6, "=C5+D5+E5"]],
  ["合計", "", [111, "=SUM(C3:C5)"], [222, "=SUM(D3:D5)"], [333, "=SUM(E3:E5)"], [666, "=SUM(F3:F5)"]],
];
// 読み直し: B店の2月を 20 → 25、C店の行がなくなる
const second: Raw[][] = [
  first[0], first[1], first[2],
  ["B店", "免税", 10, 25, 30, [65, "=SUM(C4:E4)"]],
  ["合計", "", [110, "=SUM(C3:C4)"], [225, "=SUM(D3:D4)"], [330, "=SUM(E3:E4)"], [665, "=SUM(F3:F4)"]],
];

describe.skipIf(!ADMIN)("取り込み(結合)", () => {
  let admin: postgres.Sql;
  const reader = memoryReader({ [TAB]: first });
  let alice: Scope;

  beforeAll(async () => {
    admin = postgres(ADMIN!, { onnotice: () => {}, max: 1 });
    await admin`drop schema if exists fourdb cascade`;
    await admin`drop schema if exists fourdb_migrations cascade`;
    await applyMigrations(admin);
    await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then create role ${APP_ROLE} login; end if; end $$`);
    await grantApp(admin, APP_ROLE);
    const u = new URL(ADMIN!);
    u.username = APP_ROLE;
    u.password = "";
    process.env.FOURDB_DATABASE_URL = u.toString();
    alice = { principal: "test:alice", workspaceId: await personalWorkspace("test:alice") };
  });
  afterAll(async () => {
    await admin?.end();
  });

  const runAll = async (sheetId: string, name: string) => {
    const run = await withScope(alice, (tx) => startRun(tx, sheetId, alice.principal));
    for (let i = 0; i < 100; i++) if ((await readNext(alice, run.id, reader)).done) break;
    const p = await withScope(alice, (tx) => proposal(tx, run.id));
    const spec = defaultSpec(p.proposal);
    spec.columns = spec.columns.map((c) => (c.role === "measure" ? { ...c, definition: name } : c.role === "aggregate" ? { ...c, definition: name } : c));
    const check = await withScope(alice, (tx) => checkApply(tx, run.id, spec));
    let r = await applyNext(alice, run.id, spec);
    for (let i = 0; !r.done && i < 100; i++) r = await applyNext(alice, run.id, null);
    return { run, p, spec, check, r };
  };

  let sheetId = "";
  it("自分の workspace は1つだけ作られ、2回目は同じものが返る", async () => {
    expect(await personalWorkspace("test:alice")).toBe(alice.workspaceId);
  });

  it("スプシを登録し、全行を読み、候補を出す(合計の列・合計の行・月・属性・行を見分ける列)", async () => {
    const sheets = await withScope(alice, async (tx) => registerBook(tx, await reader.book("x")));
    sheetId = sheets[0].id;
    const { p, check, r } = await runAll(sheetId, "売上");
    const role = (l: string) => p.proposal.columns.find((c) => c.letter === l)!;
    expect(["A", "B", "C", "D", "E", "F"].map((l) => role(l).role)).toEqual(["dimension", "attribute", "measure", "measure", "measure", "aggregate"]);
    expect(role("C").month).toBe("2026-01");
    expect(role("F").aggregate?.sums).toEqual([2, 3, 4]);
    expect(p.proposal.aggregateRows.map((x) => x.index)).toEqual([5]);
    expect(check).toMatchObject({ errors: [], dataRows: 3, aggregateRows: 1, values: 12, totals: 7, entities: 3 });
    expect(r.done).toBe(true);
  });

  it("反映すると、行・値・スプシの合計・Card・月の軸が入り、元のセルは置き場から消える", async () => {
    const got = await withScope(alice, async (tx) => {
      const [x] = await tx<{ recs: string; vals: string; tots: string; cards: string; months: string; staged: string }[]>`
        select (select count(*) from fourdb.record where system_to is null) as recs,
               (select count(*) from fourdb.value where system_to is null) as vals,
               (select count(*) from fourdb.source_total where system_to is null) as tots,
               (select count(*) from fourdb.card_attribute) as cards,
               (select string_agg(m.name, ',' order by m.name) from fourdb.dimension_member m join fourdb.dimension d on d.id = m.dimension_id where d.name = '月') as months,
               (select count(*) from fourdb.import_row) as staged`;
      return x;
    });
    expect(got).toEqual({ recs: "4", vals: "12", tots: "7", cards: "3", months: "2026,2026-01,2026-02,2026-03,2026-Q1", staged: "0" });
  });

  it("照合: スプシの合計列・合計の行と、4D Base の合計がすべて一致", async () => {
    const res = await withScope(alice, (tx) => reconcile(tx, sheetId));
    expect(res.summary).toEqual({ checked: 7, matched: 7 });
  });

  it("読み直し: 変わった値は前の版を残して新しい版、なくなった行は閉じる。照合も一致", async () => {
    reader.set(TAB, second);
    await withScope(alice, async (tx) => registerBook(tx, await reader.book("x")));
    const { r } = await runAll(sheetId, "売上");
    expect(r.done).toBe(true);
    const got = await withScope(alice, async (tx) => {
      const [x] = await tx<{ recs: string; b_feb: string; closed_recs: string }[]>`
        select (select count(*) from fourdb.record where system_to is null) as recs,
               (select string_agg(v.num::text || ':' || (v.system_to is null)::text, ',' order by v.system_from)
                  from fourdb.value v join fourdb.record r on r.id = v.record_id join fourdb.source_column c on c.id = v.column_id
                 where r.row_key = 'B店' and c.header = '2月') as b_feb,
               (select count(*) from fourdb.record where system_to is not null) as closed_recs`;
      return x;
    });
    // 閉じた行: なくなった C店 と、前の合計の行(合計の行は行番号で見分けるので、行がずれると新しい合計の行になる)
    expect(got).toEqual({ recs: "3", b_feb: "20:false,25:true", closed_recs: "2" });
    expect((await withScope(alice, (tx) => reconcile(tx, sheetId))).summary).toEqual({ checked: 6, matched: 6 });
  });

  it("別の人(workspace)からは何も見えない", async () => {
    const bob: Scope = { principal: "test:bob", workspaceId: await personalWorkspace("test:bob") };
    expect(bob.workspaceId).not.toBe(alice.workspaceId);
    const n = await withScope(bob, async (tx) => (await tx<{ n: string }[]>`select (select count(*) from fourdb.value) + (select count(*) from fourdb.source_sheet) as n`)[0].n);
    expect(n).toBe("0");
    await expect(withScope(bob, (tx) => reconcile(tx, sheetId))).rejects.toThrow(ImportError);
  });

  it("行ごとの権限を飛ばせる役割(superuser)でつないだら止め、実行用の役割なら通す", async () => {
    await expect(assertSafeRole(admin)).rejects.toThrow("行ごとの権限を飛ばせる役割");
    const app = postgres(process.env.FOURDB_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
    await app.end();
  });

  it("行を見分ける列に同じ値があれば知らせる(合計の行は数えない)。確かめは分割して進められる", async () => {
    reader.set("重複", [["店舗", "1月"], ["A店", 1], ["A店", 2], ["B店", 3], ["合計", [6, "=SUM(B2:B4)"]]]);
    const sheets = await withScope(alice, async (tx) => registerBook(tx, await reader.book("x")));
    const dup = sheets.find((x) => x.title === "重複")!;
    const run = await withScope(alice, (tx) => startRun(tx, dup.id, alice.principal));
    for (let i = 0; i < 10; i++) if ((await readNext(alice, run.id, reader)).done) break;
    const spec = defaultSpec((await withScope(alice, (tx) => proposal(tx, run.id))).proposal);
    expect(spec.rowKeyColumns).toEqual([]);   // 候補では、同じ値のある列は鍵にしない
    spec.rowKeyColumns = [0];
    const facts = await withScope(alice, (tx) => keyFacts(tx, run.id, spec));
    expect(facts.duplicateKeys).toEqual([{ key: "A店", rows: [2, 3] }]);
    const c0 = await withScope(alice, (tx) => checkApply(tx, run.id, spec, 0));
    expect(c0.errors.join()).toContain("同じ値の行");
    expect(c0).toMatchObject({ dataRows: 3, aggregateRows: 1, done: true });
    const c1 = await withScope(alice, (tx) => checkApply(tx, run.id, spec, 3));
    expect(c1).toMatchObject({ dataRows: 1, aggregateRows: 1, duplicateKeys: [], done: true });
  });

  it("移行完了にした表には、スプシから取り込めない", async () => {
    await withScope(alice, (tx) => tx`update fourdb.source_sheet set migration_status = 'migrated', migrated_at = now(), migrated_by = ${alice.principal} where id = ${sheetId}`);
    await expect(withScope(alice, (tx) => startRun(tx, sheetId, alice.principal))).rejects.toThrow("移行完了");
  });
});
