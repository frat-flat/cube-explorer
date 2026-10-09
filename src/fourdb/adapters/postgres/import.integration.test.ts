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
    // 別の人の取り込みは、id を知っていても反映できない(見つからない扱い)
    const [{ id: runId }] = await withScope(alice, (tx) => tx<{ id: string }[]>`select id from fourdb.import_run where sheet_id = ${sheetId} order by started_at desc limit 1`);
    await expect(applyNext(bob, runId, null)).rejects.toMatchObject({ status: 404 });
  });

  it("行ごとの権限を飛ばせる役割(superuser)でつないだら止め、実行用の役割なら通す。RLS の強制が外れた表があれば実行用の役割でも止める", async () => {
    await expect(assertSafeRole(admin)).rejects.toThrow("行ごとの権限を飛ばせる役割");
    const app = postgres(process.env.FOURDB_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
    await admin`alter table fourdb.box no force row level security`;
    try {
      await expect(assertSafeRole(app)).rejects.toThrow("強制になっていない表");
    } finally {
      await admin`alter table fourdb.box force row level security`;
    }
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

  it("反映は時間で区切って続きから書ける(最初の反映と読み直し)。途中で失敗した呼び出しは何も残さず、続けて呼べば一度に書いたときと同じ中身になる", async () => {
    // 450 行 × (店舗コード・担当・1〜3月・計) + 合計の行。同じ中身のタブを2つ作り、B は時間 0(1回に最小のまとまり)で、A は既定で書く
    // 読み直し(reread): 45 行がなくなり、値と担当の一部が変わる
    const split = (reread = false): Raw[][] => {
      const rows: Raw[][] = [["2026年 分割(試験)"], ["店舗コード", "担当", "1月", "2月", "3月", "計"]];
      for (let i = 0; i < 450; i++) {
        if (reread && i % 10 === 4) continue;
        const r = rows.length + 1;
        const [a, b, c] = [(i % 7) + 1 + (reread && i % 5 === 1 ? 100 : 0), (i % 11) + 2, (i % 13) + 3];
        rows.push([`T-${String(i).padStart(4, "0")}`, `担当${(i % 5) + (reread && i % 9 === 0 ? 10 : 0)}`, a, b, c, [a + b + c, `=SUM(C${r}:E${r})`]]);
      }
      const last = rows.length;
      const sum = (k: number) => rows.slice(2).reduce((s, x) => s + (x[k] as number), 0);
      const total = (k: number, l: string) => [sum(k), `=SUM(${l}3:${l}${last})`] as [number, string];
      rows.push(["合計", "", total(2, "C"), total(3, "D"), total(4, "E"), [sum(2) + sum(3) + sum(4), `=SUM(F3:F${last})`]]);
      return rows;
    };
    reader.set("2026年 分割A", split());
    reader.set("2026年 分割B", split());
    const sheets = await withScope(alice, async (tx) => registerBook(tx, await reader.book("x")));
    const prepare = async (title: string, reread = false) => {
      const sheet = sheets.find((x) => x.title === title)!;
      const run = await withScope(alice, (tx) => startRun(tx, sheet.id, alice.principal));
      for (let i = 0; i < 20; i++) if ((await readNext(alice, run.id, reader)).done) break;
      const spec = defaultSpec((await withScope(alice, (tx) => proposal(tx, run.id))).proposal);
      expect(await withScope(alice, (tx) => checkApply(tx, run.id, spec))).toMatchObject(
        reread ? { errors: [], dataRows: 405, aggregateRows: 1 } : { errors: [], dataRows: 450, aggregateRows: 1, values: 1800, totals: 454, entities: 450 });
      return { sheet, run, spec };
    };
    const cursorNext = async (runId: string) =>
      withScope(alice, async (tx) => (await tx<{ n: number | null }[]>`select (cursor -> 'apply' ->> 'next')::int as n from fourdb.import_run where id = ${runId}`)[0].n);

    // B: 1回ごとに最小のまとまりだけ書く。3回目の呼び出しは、値を書いたあとでわざと失敗させる
    const b = await prepare("2026年 分割B");
    let writes = 0;
    const failOnce = { budgetMs: 0, trace: (phase: string) => { if (phase === "write.values" && ++writes === 2) throw new Error("試験: 途中で止める"); } };
    const seen: number[] = [];
    let failures = 0;
    let r = await applyNext(alice, b.run.id, b.spec, failOnce);
    seen.push(r.next);
    for (let i = 0; !r.done && i < 50; i++) {
      const before = await cursorNext(b.run.id);
      try {
        r = await applyNext(alice, b.run.id, null, failOnce);
        seen.push(r.next);
      } catch (e) {
        expect((e as Error).message).toBe("試験: 途中で止める");
        failures++;
        expect(await cursorNext(b.run.id)).toBe(before);   // 失敗した呼び出しの分は残らない(位置も進まない)
      }
    }
    expect(r.done).toBe(true);
    expect(failures).toBe(1);
    expect(seen.length).toBeGreaterThanOrEqual(4);   // 準備 → まとまりごと → 片付け、と分かれた
    expect(seen).toEqual([...seen].sort((x, y) => x - y));   // 進み具合は戻らない

    // A: 既定の時間で書く(この大きさなら1回で終わる)
    const a = await prepare("2026年 分割A");
    const ra = await applyNext(alice, a.run.id, a.spec);
    expect(ra.done).toBe(true);
    expect(r.counts).toEqual(ra.counts);
    expect(ra.counts).toEqual({ rows: 451, values: 1800, totals: 454, closedValues: 0 });

    // 中身(行・値・スプシの合計・Card)と照合が、A と B で同じ
    const contents = (sheetId: string) =>
      withScope(alice, async (tx) => {
        const [x] = await tx<{ recs: string; vals: string; tots: string; cards: string; staged: string; status: string }[]>`
          select (select string_agg(r.row_key || ':' || r.row_index || ':' || r.kind || ':' || coalesce(b.name, '-'), ',' order by r.row_index)
                    from fourdb.record r left join fourdb.box b on b.id = r.box_id where r.sheet_id = ${sheetId} and r.system_to is null) as recs,
                 (select string_agg(r.row_key || ':' || c.col_index || ':' || v.kind || ':' || coalesce(v.num::text, v.txt), ',' order by r.row_index, c.col_index)
                    from fourdb.value v join fourdb.record r on r.id = v.record_id join fourdb.source_column c on c.id = v.column_id
                   where v.sheet_id = ${sheetId} and v.system_to is null) as vals,
                 (select string_agg(r.row_key || ':' || c.col_index || ':' || t.num || ':' || coalesce(t.formula, '-'), ',' order by r.row_index, c.col_index)
                    from fourdb.source_total t join fourdb.record r on r.id = t.record_id join fourdb.source_column c on c.id = t.column_id
                   where t.sheet_id = ${sheetId} and t.system_to is null) as tots,
                 (select count(*) from fourdb.card_attribute ca where ca.source_reference ->> 'sheet_id' = ${sheetId}) as cards,
                 (select count(*) from fourdb.import_row ir join fourdb.import_run ru on ru.id = ir.run_id where ru.sheet_id = ${sheetId}) as staged,
                 (select string_agg(status, ',') from fourdb.import_run where sheet_id = ${sheetId}) as status`;
        return x;
      });
    const ca = await contents(a.sheet.id);
    expect(await contents(b.sheet.id)).toEqual(ca);
    expect(ca).toMatchObject({ cards: "450", staged: "0", status: "applied" });
    const [ka, kb] = await Promise.all([a, b].map((x) => withScope(alice, (tx) => reconcile(tx, x.sheet.id))));
    expect(ka.summary).toEqual({ checked: 454, matched: 454 });
    expect(kb.summary).toEqual(ka.summary);

    // 読み直し(前に行がある = なくなった行を閉じる段階あり)。B は時間 0・置き場を 50 行ずつ消し、
    // 「なくなった行を閉じる」段階と、片付け(置き場を消す)の途中で1回ずつ失敗させる。A は既定で書く
    reader.set("2026年 分割A", split(true));
    reader.set("2026年 分割B", split(true));
    await withScope(alice, async (tx) => registerBook(tx, await reader.book("x")));
    const b2 = await prepare("2026年 分割B", true);
    const pending = new Set(["finish.close", "finish.cleanup"]);
    let cleanups = 0;
    const opts2 = {
      budgetMs: 0,
      cleanupRows: 50,
      trace: (phase: string) => {
        if (phase === "finish.close" && pending.delete(phase)) throw new Error("試験: 途中で止める");
        if (phase === "finish.cleanup" && ++cleanups === 3 && pending.delete(phase)) throw new Error("試験: 途中で止める");
      },
    };
    const finishOf = async (runId: string) =>
      withScope(alice, async (tx) => (await tx<{ f: { closed: boolean; cleaned: boolean; cleanedTo: number } | null; had: boolean }[]>`
        select cursor -> 'apply' -> 'finish' as f, (cursor -> 'apply' ->> 'hadRecords')::boolean as had from fourdb.import_run where id = ${runId}`)[0]);
    let r2 = await applyNext(alice, b2.run.id, b2.spec, opts2);
    let failures2 = 0;
    let midCleanup = false;
    for (let i = 0; !r2.done && i < 200; i++) {
      try {
        r2 = await applyNext(alice, b2.run.id, null, opts2);
      } catch (e) {
        expect((e as Error).message).toBe("試験: 途中で止める");
        failures2++;
        continue;
      }
      const x = await finishOf(b2.run.id);
      if (x.f?.closed && !x.f.cleaned && x.f.cleanedTo > 0) {
        midCleanup = true;   // 置き場を一部消したところで区切られ、次の呼び出しが続きを消した
        expect(x.had).toBe(false);   // 閉じ終えたら hadRecords は false(前のつくりで続けても閉じ直さない)
      }
    }
    expect(r2.done).toBe(true);
    expect(failures2).toBe(2);
    expect(midCleanup).toBe(true);

    const a2 = await prepare("2026年 分割A", true);
    const ra2 = await applyNext(alice, a2.run.id, a2.spec);
    expect(ra2.done).toBe(true);
    expect(r2.counts).toEqual(ra2.counts);
    expect((await contents(b.sheet.id))).toEqual(await contents(a.sheet.id));
    const lastLines = (sheetId: string) =>
      withScope(alice, async (tx) => (await tx<{ l: string[] }[]>`
        select detail -> 'lines' as l from fourdb.history where detail ->> 'sheet_id' = ${sheetId} order by id desc limit 1`)[0].l);
    const la = await lastLines(a.sheet.id);
    expect(await lastLines(b.sheet.id)).toEqual(la);
    expect(la.join()).toContain("スプシからなくなった行 46 行を閉じた");   // 45 行 + 位置のずれた合計の行
    const [ka2, kb2] = await Promise.all([a, b].map((x) => withScope(alice, (tx) => reconcile(tx, x.sheet.id))));
    expect(kb2.summary).toEqual(ka2.summary);
    expect(ka2.summary.checked).toBe(ka2.summary.matched);
  });

  it("移行完了にした表には、スプシから取り込めない", async () => {
    await withScope(alice, (tx) => tx`update fourdb.source_sheet set migration_status = 'migrated', migrated_at = now(), migrated_by = ${alice.principal} where id = ${sheetId}`);
    await expect(withScope(alice, (tx) => startRun(tx, sheetId, alice.principal))).rejects.toThrow("移行完了");
  });
});
