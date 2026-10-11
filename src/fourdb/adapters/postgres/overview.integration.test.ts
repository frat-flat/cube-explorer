// ホーム・Task・履歴・Box 一覧の読み取り(home・tasks・history・boxes)の結合テスト。FOURDB_TEST_ADMIN_URL がなければ飛ばす。
// ほかの結合テストとぶつからないよう、別のデータベース(<名前>_home)を作って使う(投影の結合テストが <名前>_proj を使うのと同じ)。
// 試験用のスプシ(e2e/fixtures/sheets/fixture-uriage-2026.json)を取り込んでから、ホーム・履歴・Box を読む。
// 確かめること: ホームの単位・名前・中に・元のシート・Card の項目・数値・ƒ・期間・Table(取り込みの結果は管理者の SQL で別に求めて比べる。手で組んだ世界は決めた値と比べる)/
//   Task の分け方と進み具合 / ページ送りと上限 / 別の workspace のデータが見えない(SQL のパラメータと RLS の両方で)。
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HomeOverview } from "@/fourdb/core/home";
import { defaultSpec } from "@/fourdb/core/import/spec";
import type { ProjectionRequest } from "@/fourdb/core/projection/types";
import { fixtureReader } from "../google-sheets/fixture";
import { applyNext } from "./apply";
import { BOXES_DEFAULT_LIMIT, BOXES_MAX_LIMIT, listBoxes, type BoxItem } from "./boxes";
import { personalWorkspace, withScope, type Scope } from "./db";
import { loadHome } from "./home";
import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, listHistory, type HistoryItem } from "./history";
import { checkApply, ImportError, proposal, readNext, registerBook, startRun } from "./import-store";
import { applyMigrations, grantApp } from "./migrate";
import { catalog, saveDefinition } from "./projection";
import { countTasks, loadTasks } from "./tasks";

const ADMIN = process.env.FOURDB_TEST_ADMIN_URL;
const APP_ROLE = "fourdb_it_app";

describe.skipIf(!ADMIN)("ホーム・履歴・Box 一覧(結合)", () => {
  let admin: postgres.Sql;
  let alice: Scope;
  let bob: Scope;
  let dave: Scope;   // ホームの手で組んだ世界
  let erin: Scope;   // Task の手で組んだ世界
  let frank: Scope;  // Task の 5,000 行の上限
  let gina: Scope;   // ホームの多い単位
  let uriageSheetId = "";
  let memoSheetId = "";
  let definitionId = "";
  const aliceWs = () => alice.workspaceId!;
  const bobWs = () => bob.workspaceId!;

  beforeAll(async () => {
    const base = new URL(ADMIN!);
    const dbName = `${base.pathname.slice(1)}_home`;
    const root = postgres(Object.assign(new URL(ADMIN!), { pathname: "/postgres" }).toString(), { max: 1, onnotice: () => {} });
    const [exists] = await root`select 1 from pg_database where datname = ${dbName}`;
    if (!exists) await root.unsafe(`create database ${dbName.replace(/[^a-z0-9_]/g, "")}`);
    await root.end();
    const adminUrl = Object.assign(new URL(ADMIN!), { pathname: `/${dbName}` });
    admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin`drop schema if exists fourdb cascade`;
    await admin`drop schema if exists fourdb_migrations cascade`;
    await applyMigrations(admin);
    await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then create role ${APP_ROLE} login; end if; end $$`);
    await grantApp(admin, APP_ROLE);
    const app = Object.assign(new URL(adminUrl.toString()), { username: APP_ROLE, password: "" });
    process.env.FOURDB_DATABASE_URL = app.toString();
    alice = { principal: "test:alice", workspaceId: await personalWorkspace("test:alice") };
    bob = { principal: "test:bob", workspaceId: await personalWorkspace("test:bob") };
    dave = { principal: "test:dave", workspaceId: await personalWorkspace("test:dave") };
    erin = { principal: "test:erin", workspaceId: await personalWorkspace("test:erin") };
    frank = { principal: "test:frank", workspaceId: await personalWorkspace("test:frank") };
    gina = { principal: "test:gina", workspaceId: await personalWorkspace("test:gina") };
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** 試験用のスプシを取り込む(取り込みの画面と同じ流れ)。「2026年度」を反映し、「メモ」は読み取って承認待ち(staged)のままにする */
  async function importFixture() {
    const reader = fixtureReader("e2e/fixtures/sheets");
    const sheets = await withScope(alice, async (tx) => registerBook(tx, await reader.book("fixture:fixture-uriage-2026")));
    const sheet = sheets.find((x) => x.title === "2026年度")!;
    const r = await withScope(alice, (tx) => startRun(tx, sheet.id, alice.principal));
    for (let i = 0; i < 20; i++) if ((await readNext(alice, r.id, reader)).done) break;
    const spec = defaultSpec((await withScope(alice, (tx) => proposal(tx, r.id))).proposal);
    expect((await withScope(alice, (tx) => checkApply(tx, r.id, spec))).errors).toEqual([]);
    let a = await applyNext(alice, r.id, spec);
    for (let i = 0; !a.done && i < 20; i++) a = await applyNext(alice, r.id, null);
    const memo = sheets.find((x) => x.title === "メモ")!;
    const m = await withScope(alice, (tx) => startRun(tx, memo.id, alice.principal));
    for (let i = 0; i < 20; i++) if ((await readNext(alice, m.id, reader)).done) break;
    return { uriage: sheet.id, memo: memo.id };
  }

  it("準備: 取り込み・表の保存・Box(親子の木つき)・履歴(alice)と、別の workspace(bob)のデータを入れる", async () => {
    const ids = await importFixture();
    uriageSheetId = ids.uriage;
    memoSheetId = ids.memo;
    const cat = await withScope(alice, (tx) => catalog(tx));
    const req: ProjectionRequest = { measureId: cat.measures.find((m) => m.name === "売上")!.id, fn: "SUM", rows: null, columns: null, filters: [], sheetIds: null };
    definitionId = (await withScope(alice, (tx) => saveDefinition(tx, { id: null, name: "合計", request: req }))).id;

    // alice の Box: いちばん上に 法人 2・店舗グループ(単位なし)1・ページ送り用の店舗 250・同じ名前 5、A社の下に店舗 3
    await withScope(alice, async (tx) => {
      await tx`insert into fourdb.box (workspace_id, type, unit_type, name) values (${aliceWs()}, 'entity', '法人', 'A社'), (${aliceWs()}, 'entity', '法人', 'B社'), (${aliceWs()}, 'group', null, '店舗グループ')`;
      const [a] = await tx<{ id: string }[]>`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'A社'`;
      await tx`insert into fourdb.box (workspace_id, parent_id, type, unit_type, name)
               select ${aliceWs()}, ${a.id}, 'entity', '店舗', 'A社 店' || g from generate_series(1, 3) g`;
      await tx`insert into fourdb.box (workspace_id, type, unit_type, name)
               select ${aliceWs()}, 'entity', '店舗', 'P' || lpad(g::text, 4, '0') from generate_series(1, 250) g`;
      await tx`insert into fourdb.box (workspace_id, type, unit_type, name)
               select ${aliceWs()}, 'entity', '同名', 'dup' from generate_series(1, 5)`;
      // 親子の木(ホームの「中に」の試験用): 店舗 P0001 の下に 担当 2・その下に サブ 1・単位の空の子 1。いちばん上の一覧には出ない
      const [p1] = await tx<{ id: string }[]>`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'P0001'`;
      await tx`insert into fourdb.box (workspace_id, parent_id, type, unit_type, name) values
               (${aliceWs()}, ${p1.id}, 'entity', '担当', 'P0001 担当1'), (${aliceWs()}, ${p1.id}, 'entity', '担当', 'P0001 担当2'), (${aliceWs()}, ${p1.id}, 'entity', '', 'P0001 無名')`;
      const [k1] = await tx<{ id: string }[]>`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'P0001 担当1'`;
      await tx`insert into fourdb.box (workspace_id, parent_id, type, unit_type, name) values (${aliceWs()}, ${k1.id}, 'entity', 'サブ', 'P0001 サブ')`;
      // 履歴: ページ送り・上限の試験用に種類 edit を 130 件(新しいものほど id が大きい)。最後に、内容のおかしい記録を 1 件
      await tx`insert into fourdb.history (workspace_id, actor, kind, title, detail)
               select ${aliceWs()}, ${alice.principal}, 'edit', '編集 ' || g, '{}'::jsonb from generate_series(1, 130) g`;
      const odd = { sheet_id: "not-a-uuid", definition_id: 42, lines: [...Array.from({ length: 15 }, () => "x".repeat(300)), 1] };
      await tx`insert into fourdb.history (workspace_id, actor, kind, title, detail) values (${aliceWs()}, ${alice.principal}, 'import', 'おかしい記録', ${tx.json(odd as never)})`;
    });
    // bob のデータ(alice のものと混ざらないことを確かめるため、alice と同じ名前の Box も入れる)
    await withScope(bob, async (tx) => {
      await tx`insert into fourdb.box (workspace_id, type, unit_type, name) values (${bobWs()}, 'entity', '法人', 'A社'), (${bobWs()}, 'entity', '秘密の単位', 'B社だけ見える')`;
      await tx`insert into fourdb.history (workspace_id, actor, kind, title) values (${bobWs()}, ${bob.principal}, 'edit', 'bob の記録')`;
      await tx`insert into fourdb.source_container (workspace_id, provider, external_id, title) values (${bobWs()}, 'google_sheets', 'bob-book', 'bob のファイル')`;
    });
  });

  // ---------- home ----------
  const unitOf = (h: HomeOverview, unitType: string | null) => h.units.find((u) => u.unitType === unitType)!;
  const ISO = (d: Date) => d.toISOString();

  it("home: いちばん上の Box を単位ごとにまとめ、子のある単位 → 数の多い順 → 名前の順(単位なしは最後)に並べる。親のある Box は数えない", async () => {
    const h = await withScope(alice, (tx) => loadHome(tx, alice));
    // 期待の並びは、Box の表を直接読んで別に求める
    const tops = await admin<{ id: string; unit_type: string | null }[]>`
      select id, nullif(unit_type, '') as unit_type from fourdb.box where workspace_id = ${aliceWs()} and parent_id is null`;
    const parents = new Set((await admin<{ parent_id: string }[]>`select distinct parent_id from fourdb.box where workspace_id = ${aliceWs()} and parent_id is not null`).map((r) => r.parent_id));
    const groups = new Map<string | null, { n: number; kids: boolean }>();
    for (const b of tops) {
      const g = groups.get(b.unit_type) ?? { n: 0, kids: false };
      g.n += 1;
      g.kids ||= parents.has(b.id);
      groups.set(b.unit_type, g);
    }
    const expected = [...groups].sort(([ua, a], [ub, b]) => Number(b.kids) - Number(a.kids) || b.n - a.n || (ua === null ? 1 : ub === null ? -1 : ua < ub ? -1 : 1));
    expect(h.units.map((u) => [u.unitType, u.count])).toEqual(expected.map(([u, g]) => [u, g.n]));
    // 中身が決まった形: 子のある 店舗(250)・法人(2) が先、そのあと 同名(5)・店舗コード(3)・単位なし(1)
    expect(h.units.map((u) => u.key)).toEqual(["u:店舗", "u:法人", "u:同名", "u:店舗コード", "none"]);
    expect(h.units.map((u) => u.count)).toEqual([250, 2, 5, 3, 1]);
    expect(h.topBoxes).toBe(261);
    expect(h.others).toEqual({ items: [], more: 0 });
    expect(unitOf(h, null).unitType).toBeNull();
  });

  it("home: 名前は (name, id) の順で 5 件(それより多い分は more)。順はデータベースの並びと同じ", async () => {
    const h = await withScope(alice, (tx) => loadHome(tx, alice));
    for (const u of h.units) {
      const fromDb = await admin<{ name: string }[]>`
        select name from fourdb.box where workspace_id = ${aliceWs()} and parent_id is null and nullif(unit_type, '') is not distinct from ${u.unitType}
         order by name, id limit 5`;
      expect(u.names.items, u.key).toEqual(fromDb.map((r) => r.name));
      expect(u.names.more, u.key).toBe(u.count - fromDb.length);
    }
    expect(unitOf(h, "店舗").names).toEqual({ items: ["P0001", "P0002", "P0003", "P0004", "P0005"], more: 245 });
    expect(unitOf(h, "法人").names).toEqual({ items: ["A社", "B社"], more: 0 });
    expect(unitOf(h, "同名").names).toEqual({ items: ["dup", "dup", "dup", "dup", "dup"], more: 0 });
    expect(unitOf(h, null).names).toEqual({ items: ["店舗グループ"], more: 0 });
  });

  it("home: 中に = 子孫をすべての段で単位ごとに数える(多い順。単位が空の子は「単位なし」)。子のない単位は null", async () => {
    const h = await withScope(alice, (tx) => loadHome(tx, alice));
    expect(unitOf(h, "店舗").inside).toEqual({ items: [{ unitType: "担当", count: 2 }, { unitType: "サブ", count: 1 }, { unitType: null, count: 1 }], more: 0 });
    expect(unitOf(h, "法人").inside).toEqual({ items: [{ unitType: "店舗", count: 3 }], more: 0 });
    for (const u of [unitOf(h, "同名"), unitOf(h, "店舗コード"), unitOf(h, null)]) expect(u.inside, u.key).toBeNull();
    // 木をたどって別に数える(管理者の SQL で全 Box を読み、いちばん上の Box ごとに子孫をたどる)
    const all = await admin<{ id: string; parent_id: string | null; unit_type: string | null }[]>`select id, parent_id, nullif(unit_type, '') as unit_type from fourdb.box where workspace_id = ${aliceWs()}`;
    const kids = new Map<string, { id: string; parent_id: string | null; unit_type: string | null }[]>();
    for (const b of all) if (b.parent_id) kids.set(b.parent_id, [...(kids.get(b.parent_id) ?? []), b]);
    for (const u of h.units) {
      const counts = new Map<string | null, number>();
      const walk = (id: string) => {
        for (const c of kids.get(id) ?? []) {
          counts.set(c.unit_type, (counts.get(c.unit_type) ?? 0) + 1);
          walk(c.id);
        }
      };
      for (const t of all.filter((b) => b.parent_id === null && b.unit_type === u.unitType)) walk(t.id);
      const want = [...counts].sort(([ua, a], [ub, b]) => b - a || (ua === null ? 1 : ub === null ? -1 : ua < ub ? -1 : 1)).map(([unitType, count]) => ({ unitType, count }));
      expect(u.inside?.items ?? [], u.key).toEqual(want);
    }
  });

  it("home: 元のシート・Card の項目・数値・ƒ・期間・最後に取り込んだ日を、管理者の SQL で別に求めた値と比べる(取り込みの結果)", async () => {
    const h = await withScope(alice, (tx) => loadHome(tx, alice));
    const u = unitOf(h, "店舗コード");
    // 元のシート = 単位の Box に結ばれた行がある、消していないシート(「メモ」は読み取っただけで反映していないので入らない)
    const sheets = await admin<{ id: string; sheet: string; file: string; last_read_at: Date }[]>`
      select s.id, s.title as sheet, c.title as file, s.last_read_at
        from fourdb.source_sheet s join fourdb.source_container c on c.id = s.container_id
       where s.workspace_id = ${aliceWs()} and s.deleted_at is null and c.deleted_at is null
         and s.id in (select r.sheet_id from fourdb.record r join fourdb.box b on b.id = r.box_id
                       where r.system_to is null and b.parent_id is null and b.unit_type = '店舗コード')`;
    expect(sheets).toHaveLength(1);
    expect(sheets[0].id).toBe(uriageSheetId);
    expect(u.sheets).toEqual({ items: [{ sheetId: sheets[0].id, file: sheets[0].file, sheet: sheets[0].sheet }], more: 0, lastReadAt: ISO(sheets[0].last_read_at) });
    // 列: 行で結ばれたシートの、今の attribute と measure の列を、カラムの名前でまとめる(いちばん左の位置の順)
    const cols = await admin<{ name: string; kind: string; pos: number }[]>`
      select cd.name, sc.role as kind, min(sc.col_index)::int as pos
        from fourdb.source_column sc join fourdb.column_definition cd on cd.id = sc.column_definition_id
       where sc.sheet_id = ${sheets[0].id} and sc.system_to is null and sc.role in ('attribute', 'measure')
       group by cd.name, sc.role order by pos, cd.name`;
    expect(u.cardFields).toEqual({ items: cols.filter((c) => c.kind === "attribute").map((c) => c.name), more: 0 });
    expect(u.measures!.items.map((m) => m.name)).toEqual(cols.filter((c) => c.kind === "measure").map((c) => c.name));
    expect(u.cardFields!.items).toEqual(["課税区分"]);
    // ƒ: 今の版の値に計算された値(kind = 'calculated')がある数値だけ
    const calc = await admin<{ name: string; f: boolean }[]>`
      select cd.name, bool_or(v.kind = 'calculated') as f
        from fourdb.value v join fourdb.source_column sc on sc.id = v.column_id join fourdb.column_definition cd on cd.id = sc.column_definition_id
       where v.workspace_id = ${aliceWs()} and v.system_to is null and sc.role = 'measure' group by cd.name`;
    for (const m of u.measures!.items) expect(m.calculated, m.name).toBe(calc.find((c) => c.name === m.name)?.f === true);
    expect(u.measures!.items).toEqual([{ name: "売上", calculated: false }, { name: "精算額", calculated: true }]);
    // 期間: 数値の列の月(column_coord)の最小の始まりと、最大の終わり(含まない)の前の日の月
    const [p] = await admin<{ from: string; to: string }[]>`
      select to_char(min(m.period_start), 'YYYY-MM') as "from", to_char(max(m.period_end) - 1, 'YYYY-MM') as "to"
        from fourdb.column_coord cc
        join fourdb.source_column sc on sc.id = cc.column_id and sc.role = 'measure' and sc.system_to is null
        join fourdb.dimension_member m on m.id = cc.member_id
       where sc.sheet_id = ${sheets[0].id} and m.period_start is not null`;
    expect(u.period).toEqual({ from: p.from, to: p.to });
    expect(u.period).toEqual({ from: "2026-04", to: "2026-09" });
    // 元のシートのない単位は、欄が null
    for (const other of h.units.filter((x) => x.key !== u.key)) {
      expect([other.sheets, other.cardFields, other.measures, other.period, other.tables], other.key).toEqual([null, null, null, null, null]);
    }
  });

  it("home: Table = 単位の Box の軸を使う定義(sources が null か元のシートを含む)だけ。updated_at の新しい順に 3 件、残りは more。消した定義・軸が違う定義は出ない", async () => {
    const [shop] = await admin<{ id: string }[]>`select id from fourdb.dimension where workspace_id = ${aliceWs()} and name = '店舗コード'`;
    const [month] = await admin<{ id: string }[]>`select id from fourdb.dimension where workspace_id = ${aliceWs()} and name = '月'`;
    const def = (rows: string | null, columns: string | null, sources: string[] | null, filters: string[] = []) => ({
      sources,
      rows: rows ? { dimensionId: rows, level: 0 } : null,
      columns: columns ? { dimensionId: columns, level: 0 } : null,
      filters: filters.map((d) => ({ dimensionId: d, memberIds: [] })),
      measures: [],
    });
    const rows: [string, object, string, boolean][] = [
      ["w3-a1 店舗コード別", def(shop.id, null, null), "2026-01-01T00:00:00Z", false],
      ["w3-a2 月だけ", def(month.id, month.id, null), "2026-01-02T00:00:00Z", false],
      ["w3-a3 メモだけ", def(shop.id, null, [memoSheetId]), "2026-01-03T00:00:00Z", false],
      ["w3-a4 元のシートを指す", def(shop.id, null, [uriageSheetId]), "2026-01-04T00:00:00Z", false],
      ["w3-a5 消した表", def(shop.id, null, null), "2026-01-05T00:00:00Z", true],
      ["w3-a6 絞りに使う", def(null, month.id, null, [shop.id]), "2026-01-06T00:00:00Z", false],
      ["w3-a7 列に使う・両方指す", def(null, shop.id, [uriageSheetId, memoSheetId]), "2026-01-07T00:00:00Z", false],
      ["w3-a8 いちばん新しい", def(shop.id, month.id, null), "2026-01-08T00:00:00Z", false],
    ];
    try {
      for (const [name, definition, at, deleted] of rows) {
        await admin`insert into fourdb.sheet_definition (workspace_id, name, definition, updated_at, deleted_at)
                    values (${aliceWs()}, ${name}, ${admin.json(definition as never)}, ${at}, ${deleted ? at : null})`;
      }
      const ids = new Map((await admin<{ id: string; name: string }[]>`select id, name from fourdb.sheet_definition where workspace_id = ${aliceWs()} and name like 'w3-a%'`).map((r) => [r.name.slice(0, 5), r.id]));
      const h = await withScope(alice, (tx) => loadHome(tx, alice));
      // 合うのは a1・a4・a6・a7・a8 の 5 つ。新しい順に a8・a7・a6 の 3 件、残り 2
      expect(unitOf(h, "店舗コード").tables).toEqual({
        items: [{ id: ids.get("w3-a8"), name: "w3-a8 いちばん新しい" }, { id: ids.get("w3-a7"), name: "w3-a7 列に使う・両方指す" }, { id: ids.get("w3-a6"), name: "w3-a6 絞りに使う" }],
        more: 2,
      });
      // 軸が一致する Box のない単位には、Table は出ない
      for (const other of h.units.filter((x) => x.unitType !== "店舗コード")) expect(other.tables, other.key).toBeNull();
    } finally {
      await admin`delete from fourdb.sheet_definition where workspace_id = ${aliceWs()} and name like 'w3-a%'`;
    }
  });

  it("home: 別の workspace(bob)には alice のものが見えず、bob 自身の分だけ。何もない workspace は units が空", async () => {
    const h = await withScope(bob, (tx) => loadHome(tx, bob));
    expect(h.units.map((u) => [u.key, u.count, u.names.items])).toEqual([["u:法人", 1, ["A社"]], ["u:秘密の単位", 1, ["B社だけ見える"]]]);
    expect(h.topBoxes).toBe(2);
    expect(h.others).toEqual({ items: [], more: 0 });
    for (const u of h.units) expect([u.inside, u.cardFields, u.measures, u.period, u.sheets, u.tables], u.key).toEqual([null, null, null, null, null, null]);
    const text = JSON.stringify(h);
    for (const s of ["2026年度", "店舗別売上", "P0001", "A社 店", "店舗コード", "売上"]) expect(text, s).not.toContain(s);
    // alice の側にも bob の単位は出ない
    expect(JSON.stringify(await withScope(alice, (tx) => loadHome(tx, alice)))).not.toContain("秘密の単位");
    const carol: Scope = { principal: "test:carol", workspaceId: await personalWorkspace("test:carol") };
    expect(await withScope(carol, (tx) => loadHome(tx, carol))).toEqual({ units: [], others: { items: [], more: 0 }, topBoxes: 0 });
  });

  it("home: workspace がない scope は断る(推測で全体を読まない)", async () => {
    await expect(withScope({ principal: "test:alice", workspaceId: null }, (tx) => loadHome(tx, { principal: "test:alice", workspaceId: null }))).rejects.toThrow("workspace がありません");
    await expect(withScope(alice, (tx) => loadTasks(tx, { principal: "test:alice", workspaceId: null }))).rejects.toThrow("workspace がありません");
    await expect(withScope(alice, (tx) => countTasks(tx, { principal: "test:alice", workspaceId: null }))).rejects.toThrow("workspace がありません");
  });

  // ---------- home: 手で組んだ世界(dave)。期待は決めた値 ----------
  // 法人(X社・Y社。X社の下に 店舗 → 担当)と 拠点(Z拠点)。元のシートは 7 枚あり、入るのは 4 枚だけ:
  //   S1 売上   : 行が X社 に結ばれ(c)、法人の列(a)・シート全体の軸の値(b)でも結ばれる。数値 粗利(2 列目・ƒ あり)・売上(3 列目。ƒ は閉じた版だけ)、属性 担当者・旧項目(使わなくしたカラム。出ない)、数値 旧数値(使わなくしたカラム。出ない。列の月は 2020 年で、入れば期間が延びる)
  //   S2 予算   : シート全体の軸の値(b)が Y社 と 2027-02。行は Box に結ばれていない。数値 予算(4 列目・2025 年の列)、属性 メモ列(行で結ばれていないので出ない)
  //   S7 客数   : 拠点の列(a)だけ。数値 客数(列の月は終わりのない 2026-08-15 から)、属性 ラベル(出ない)
  //   入らない  : S3 消したシート / S4 消したファイル / S5 結びのないシート(ƒ・2031 年あり)/ S6 閉じた行だけ / S8 閉じた列だけ
  // 期間は、数値の列の column_coord(S1: 2026-01・2026-03 / S2: 2025 年 / S7: 2026-08-15〜終わりなし)と S2 の sheet_coord(2027-02)
  const helpers = (w: string) => {
    const id = async (q: PromiseLike<postgres.RowList<postgres.Row[]>>): Promise<string> => String((await q)[0].id);
    return {
      box: (name: string, unit: string | null, parent: string | null = null) =>
        id(admin`insert into fourdb.box (workspace_id, parent_id, type, unit_type, name) values (${w}, ${parent}, 'entity', ${unit}, ${name}) returning id`),
      dimension: (name: string, type: string) => id(admin`insert into fourdb.dimension (workspace_id, name, semantic_type) values (${w}, ${name}, ${type}) returning id`),
      member: (dimension: string, name: string, o: { box?: string; start?: string; end?: string } = {}) =>
        id(admin`insert into fourdb.dimension_member (workspace_id, dimension_id, name, box_id, period_start, period_end)
                 values (${w}, ${dimension}, ${name}, ${o.box ?? null}, ${o.start ?? null}, ${o.end ?? null}) returning id`),
      definition: (name: string, kind: string, o: { dimension?: string; status?: string } = {}) =>
        id(admin`insert into fourdb.column_definition (workspace_id, name, kind, dimension_id, status)
                 values (${w}, ${name}, ${kind}, ${o.dimension ?? null}, ${o.status ?? "active"}) returning id`),
      file: (title: string, deleted = false) =>
        id(admin`insert into fourdb.source_container (workspace_id, provider, title, deleted_at) values (${w}, 'native', ${title}, case when ${deleted} then now() end) returning id`),
      sheet: (container: string, title: string, o: { deleted?: boolean; read?: string; migrated?: boolean } = {}) =>
        id(admin`insert into fourdb.source_sheet (workspace_id, container_id, title, last_read_at, deleted_at, migration_status, migrated_at)
                 values (${w}, ${container}, ${title}, ${o.read ?? null}, case when ${o.deleted ?? false} then now() end,
                         case when ${o.migrated ?? false} then 'migrated' else 'migrating' end, case when ${o.migrated ?? false} then now() end) returning id`),
      column: (sheet: string, index: number, header: string, role: string, definition: string | null, closed = false) =>
        id(admin`insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id, system_to)
                 values (${w}, ${sheet}, ${index}, ${header}, ${role}, ${definition}, case when ${closed} then now() + interval '1 hour' end) returning id`),
      columnCoord: (column: string, dimension: string, member: string) =>
        admin`insert into fourdb.column_coord (workspace_id, column_id, dimension_id, member_id) values (${w}, ${column}, ${dimension}, ${member})`,
      sheetCoord: (sheet: string, dimension: string, member: string) =>
        admin`insert into fourdb.sheet_coord (workspace_id, sheet_id, dimension_id, member_id) values (${w}, ${sheet}, ${dimension}, ${member})`,
      record: (sheet: string, key: string, o: { box?: string; closed?: boolean } = {}) =>
        id(admin`insert into fourdb.record (workspace_id, sheet_id, row_key, box_id, system_from, system_to)
                 values (${w}, ${sheet}, ${key}, ${o.box ?? null}, case when ${o.closed ?? false} then now() - interval '2 days' else clock_timestamp() end,
                         case when ${o.closed ?? false} then now() - interval '1 day' end) returning id`),
      value: (sheet: string, record: string, column: string, o: { calculated?: boolean; num?: number; txt?: string; closed?: boolean } = {}) =>
        admin`insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, txt, formula, origin, system_from, system_to)
              values (${w}, ${sheet}, ${record}, ${column}, ${o.calculated ? "calculated" : "raw"}, ${o.num ?? null}, ${o.txt ?? null}, ${o.calculated ? "=1+1" : null}, 'import',
                      case when ${o.closed ?? false} then '2026-01-01'::timestamptz else clock_timestamp() end, case when ${o.closed ?? false} then '2026-02-01'::timestamptz end)`,
      table: (name: string, definition: object, updatedAt: string, deleted = false) =>
        id(admin`insert into fourdb.sheet_definition (workspace_id, name, definition, updated_at, deleted_at)
                 values (${w}, ${name}, ${admin.json(definition as never)}, ${updatedAt}, case when ${deleted} then now() end) returning id`),
      run: (sheet: string, status: string, o: { at: string; done?: string; error?: string; id?: string }) =>
        admin`insert into fourdb.import_run (id, workspace_id, sheet_id, status, started_at, finished_at, error)
              values (coalesce(${o.id ?? null}::uuid, gen_random_uuid()), ${w}, ${sheet}, ${status}, ${o.at}, ${o.done ?? null}, ${o.error ?? null})`,
    };
  };

  it("home(手で組んだ世界): 単位ごとの欄が、決めた値になる(Card の項目は行で結ばれたシートだけ・ƒ は今の版の計算された値だけ・期間・元のシート・Table)", async () => {
    const w = dave.workspaceId!;
    const x = helpers(w);
    const bX = await x.box("X社", "法人");
    const bY = await x.box("Y社", "法人");
    const bZ = await x.box("Z拠点", "拠点");
    const bShop = await x.box("X店", "店舗", bX);
    await x.box("X担当", "担当", bShop);
    const dCorp = await x.dimension("法人軸", "entity");
    const dSite = await x.dimension("拠点軸", "entity");
    const dMonth = await x.dimension("月D", "time");
    const mX = await x.member(dCorp, "X社", { box: bX });
    const mY = await x.member(dCorp, "Y社", { box: bY });
    const mZ = await x.member(dSite, "Z拠点", { box: bZ });
    void mZ;
    const y2025 = await x.member(dMonth, "2025", { start: "2025-01-01", end: "2026-01-01" });
    const m2601 = await x.member(dMonth, "2026-01", { start: "2026-01-01", end: "2026-02-01" });
    const m2603 = await x.member(dMonth, "2026-03", { start: "2026-03-01", end: "2026-04-01" });
    const m2702 = await x.member(dMonth, "2027-02", { start: "2027-02-01", end: "2027-03-01" });
    const mOpen = await x.member(dMonth, "2026-08-15", { start: "2026-08-15" }); // 終わりがない
    const y2020 = await x.member(dMonth, "2020", { start: "2020-01-01", end: "2021-01-01" });
    const y2030 = await x.member(dMonth, "2030", { start: "2030-01-01", end: "2031-01-01" });
    const y2031 = await x.member(dMonth, "2031", { start: "2031-01-01", end: "2032-01-01" });
    const y2032 = await x.member(dMonth, "2032", { start: "2032-01-01", end: "2033-01-01" });
    // カラム
    const cCorp = await x.definition("法人列", "dimension", { dimension: dCorp });
    const cSite = await x.definition("拠点列", "dimension", { dimension: dSite });
    const cSales = await x.definition("売上", "measure");
    const cGross = await x.definition("粗利", "measure");
    const cBudget = await x.definition("予算", "measure");
    const cGuests = await x.definition("客数", "measure");
    const cOwner = await x.definition("担当者", "attribute");
    const cOldAttr = await x.definition("旧項目", "attribute", { status: "deprecated" });
    const cOldMeasure = await x.definition("旧数値", "measure", { status: "deprecated" });
    const cMemo = await x.definition("メモ列", "attribute");
    const cLabel = await x.definition("ラベル", "attribute");
    // ファイルとシート
    const f1 = await x.file("店舗売上");
    const f2 = await x.file("消したファイル", true);
    const s1 = await x.sheet(f1, "売上", { read: "2026-05-01T00:00:00Z" });
    const s2 = await x.sheet(f1, "予算", { read: "2026-06-01T00:00:00Z" });
    const s3 = await x.sheet(f1, "消したシート", { deleted: true });
    const s4 = await x.sheet(f2, "消したファイルの中");
    const s5 = await x.sheet(f1, "結びのないシート");
    const s6 = await x.sheet(f1, "閉じた行だけ");
    const s7 = await x.sheet(f1, "客数");
    const s8 = await x.sheet(f1, "閉じた列だけ");
    // S1
    await x.column(s1, 0, "法人", "dimension", cCorp);
    const gross1 = await x.column(s1, 2, "粗利", "measure", cGross);
    const sales1 = await x.column(s1, 3, "売上", "measure", cSales);
    const owner1 = await x.column(s1, 5, "担当者", "attribute", cOwner);
    await x.column(s1, 6, "旧項目", "attribute", cOldAttr);
    const oldMeasure1 = await x.column(s1, 1, "旧数値", "measure", cOldMeasure);
    await x.columnCoord(oldMeasure1, dMonth, y2020);
    await x.value(s1, await x.record(s1, "r3", { box: bX }), oldMeasure1, { calculated: true, num: 9 });
    await x.columnCoord(gross1, dMonth, m2603);
    await x.columnCoord(sales1, dMonth, m2601);
    await x.sheetCoord(s1, dCorp, mX); // 軸の列・シート全体・行の 3 つで結ばれても、元のシートは 1 件
    const r1 = await x.record(s1, "r1", { box: bX });
    await x.record(s1, "r2"); // Box に結ばれていない行
    await x.value(s1, r1, gross1, { calculated: true, num: 2 });
    await x.value(s1, r1, sales1, { num: 100 });
    await x.value(s1, r1, sales1, { calculated: true, num: 100, closed: true }); // 閉じた版の計算された値は数えない
    await x.value(s1, r1, owner1, { txt: "山田" });
    // S2
    await x.sheetCoord(s2, dCorp, mY);
    await x.sheetCoord(s2, dMonth, m2702);
    const budget2 = await x.column(s2, 4, "予算", "measure", cBudget);
    await x.column(s2, 5, "メモ", "attribute", cMemo);
    await x.columnCoord(budget2, dMonth, y2025);
    const r2 = await x.record(s2, "r1");
    await x.value(s2, r2, budget2, { num: 5 });
    // S3(消したシート)・S4(消したファイルの中): 入ると 売上・粗利 の位置が 1・0 になり、期間も延びる
    await x.column(s3, 0, "法人", "dimension", cCorp);
    await x.columnCoord(await x.column(s3, 1, "売上", "measure", cSales), dMonth, y2030);
    await x.column(s4, 0, "法人", "dimension", cCorp);
    await x.column(s4, 1, "粗利", "measure", cGross);
    // S5(結びのない): 売上に計算された値があっても、売上の ƒ にはならない
    const sales5 = await x.column(s5, 0, "売上", "measure", cSales);
    await x.columnCoord(sales5, dMonth, y2031);
    await x.sheetCoord(s5, dMonth, y2032);
    await x.value(s5, await x.record(s5, "r1"), sales5, { calculated: true, num: 1 });
    // S6(閉じた行だけ)・S8(閉じた列だけ)
    await x.column(s6, 0, "予算", "measure", cBudget);
    await x.record(s6, "r1", { box: bY, closed: true });
    await x.column(s8, 0, "法人", "dimension", cCorp, true);
    // S7(拠点)
    await x.column(s7, 0, "拠点", "dimension", cSite);
    const guests7 = await x.column(s7, 1, "客数", "measure", cGuests);
    await x.column(s7, 2, "ラベル", "attribute", cLabel);
    await x.columnCoord(guests7, dMonth, mOpen);
    // 表の定義
    const use = (rows: string | null, columns: string | null, sources: string[] | null, filters: string[] = []) => ({
      sources,
      rows: rows ? { dimensionId: rows } : null,
      columns: columns ? { dimensionId: columns } : null,
      filters: filters.map((d) => ({ dimensionId: d })),
    });
    const t1 = await x.table("T1 全法人", use(dCorp, dMonth, null), "2026-03-01T00:00:00Z");
    await x.table("T2 月だけ", use(dMonth, dMonth, null), "2026-04-01T00:00:00Z");
    const t3 = await x.table("T3 S1 の表", use(null, null, [s1], [dCorp]), "2026-05-01T00:00:00Z");
    await x.table("T4 他のシート", use(dCorp, null, [s5]), "2026-06-01T00:00:00Z");
    await x.table("T5 消した表", use(dCorp, null, null), "2026-07-01T00:00:00Z", true);
    await x.table("T6 こわれた定義", { rows: 5, sources: "x", filters: [1, null, "z"] }, "2026-08-01T00:00:00Z");
    const t7 = await x.table("T7 拠点の表", use(dSite, dMonth, [s7]), "2026-02-01T00:00:00Z");

    const h = await withScope(dave, (tx) => loadHome(tx, dave));
    expect(h.topBoxes).toBe(3);
    expect(h.others).toEqual({ items: [], more: 0 });
    expect(h.units.map((u) => u.key)).toEqual(["u:法人", "u:拠点"]);
    expect(h.units[0]).toEqual({
      key: "u:法人",
      unitType: "法人",
      count: 2,
      names: { items: ["X社", "Y社"], more: 0 },
      inside: { items: [{ unitType: "店舗", count: 1 }, { unitType: "担当", count: 1 }], more: 0 }, // 同じ数なら名前の順
      cardFields: { items: ["担当者"], more: 0 }, // メモ(S2。行で結ばれていないシートの属性)は出ない
      measures: { items: [{ name: "粗利", calculated: true }, { name: "売上", calculated: false }, { name: "予算", calculated: false }], more: 0 },
      period: { from: "2025-01", to: "2027-02" },
      sheets: {
        items: [{ sheetId: s1, file: "店舗売上", sheet: "売上" }, { sheetId: s2, file: "店舗売上", sheet: "予算" }], // 行で結ばれたシートが先
        more: 0,
        lastReadAt: "2026-06-01T00:00:00.000Z",
      },
      tables: { items: [{ id: t3, name: "T3 S1 の表" }, { id: t1, name: "T1 全法人" }], more: 0 },
    });
    expect(h.units[1]).toEqual({
      key: "u:拠点",
      unitType: "拠点",
      count: 1,
      names: { items: ["Z拠点"], more: 0 },
      inside: null,
      cardFields: null, // ラベルは、行で結ばれていないシートの属性なので出ない
      measures: { items: [{ name: "客数", calculated: false }], more: 0 },
      period: { from: "2026-08", to: "2026-08" }, // 終わりのない月は、始まりの月だけ
      sheets: { items: [{ sheetId: s7, file: "店舗売上", sheet: "客数" }], more: 0, lastReadAt: null },
      tables: { items: [{ id: t7, name: "T7 拠点の表" }], more: 0 },
    });
  });

  it("home(多い単位): 6 つまでが立体、残りは「ほかの単位」30 件まで(それ以上は more)。単位の種類は 500 まで。総数は切る前の数。深さは 16 段まで。名前の順はデータベースの並び", async () => {
    const w = gina.workspaceId!;
    const x = helpers(w);
    // 単位 A(10 個。大文字小文字・かな・記号・数字の混じった名前)・単位 U001〜U520(1 個ずつ)・子のある単位 C(1 個。下に 20 段の鎖)
    const mixed = ["b", "B", "a", "A", "ア", "あ", "_x", "10", "9", "é"];
    for (const n of mixed) await x.box(n, "A");
    await admin`insert into fourdb.box (workspace_id, type, unit_type, name) select ${w}, 'entity', 'U' || lpad(g::text, 3, '0'), 'g' || g from generate_series(1, 520) g`;
    let parent = await x.box("chain0", "C");
    for (let i = 1; i <= 20; i++) parent = await x.box(`chain${i}`, "L", parent);

    const h = await withScope(gina, (tx) => loadHome(tx, gina));
    expect(h.topBoxes).toBe(531); // 10 + 520 + 1。単位の種類を 500 で切る前の数
    expect(h.units.map((u) => u.unitType)).toEqual(["C", "A", "U001", "U002", "U003", "U004"]); // 子のある C が先、次に数の多い A、あとは名前の順
    // ほかの単位: 500 種類で切ったうち、立体にならない 494(U005〜U498)から 30 件、残りは more
    expect(h.others.items).toHaveLength(30);
    expect(h.others.items[0]).toEqual({ unitType: "U005", count: 1 });
    expect(h.others.items[29]).toEqual({ unitType: "U034", count: 1 });
    expect(h.others.more).toBe(494 - 30);
    // 中に: 鎖は 16 段までしかたどらない
    expect(unitOf(h, "C").inside).toEqual({ items: [{ unitType: "L", count: 16 }], more: 0 });
    // 名前: A の先頭 5 件は、データベースの (name, id) の順と同じ(照合順序によらず)
    const fromDb = await admin<{ name: string }[]>`select name from fourdb.box where workspace_id = ${w} and parent_id is null and unit_type = 'A' order by name, id limit 5`;
    expect(unitOf(h, "A").names).toEqual({ items: fromDb.map((r) => r.name), more: 5 });
    expect(unitOf(h, "C").names).toEqual({ items: ["chain0"], more: 0 });
  });

  it("home: 同じ呼び出しを 2 回すると同じ結果(読むだけで、何も書き換えない)", async () => {
    const a = await withScope(dave, (tx) => loadHome(tx, dave));
    const b = await withScope(dave, (tx) => loadHome(tx, dave));
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // JSON にしても変わらない(日付・bigint を生で返していない)
  });

  // ---------- tasks ----------
  it("tasks(alice): 取り込み済みの「2026年度」は Task でなく、読み取っただけの「メモ」が承認待ち。進み具合はファイルごとに数える", async () => {
    const t = await withScope(alice, (tx) => loadTasks(tx, alice));
    expect(t.count).toBe(1);
    expect(t.items.more).toBe(0);
    expect(t.items.items).toHaveLength(1);
    expect(t.items.items[0]).toMatchObject({ kind: "approval", runStatus: "staged", sheetId: memoSheetId, sheet: "メモ", file: "店舗別売上(試験用)", finishedAt: null });
    expect(Object.keys(t.items.items[0]).sort()).toEqual(["file", "fileId", "finishedAt", "kind", "runId", "runStatus", "sheet", "sheetId", "startedAt"]); // error など、ほかの項目は返さない
    expect(t.files.items).toEqual([{ fileId: t.files.items[0].fileId, file: "店舗別売上(試験用)", started: 2, migrated: 0, inProgress: 1, imported: 1, failed: 0, notStarted: 0 }]);
    expect(await withScope(alice, (tx) => countTasks(tx, alice))).toBe(1);
  });

  it("tasks(手で組んだ世界 erin): 最後の取り込みの状態で分ける。消したシート・消したファイル・取り消した取り込みは Task にならない。error の文は返さない", async () => {
    const x = helpers(erin.workspaceId!);
    const fa = await x.file("F-A 進み具合");
    const fc = await x.file("F-C 空");
    const fd = await x.file("F-D 消した", true);
    const sheet = (title: string, o: { read?: string; migrated?: boolean; deleted?: boolean } = {}) => x.sheet(fa, title, o);
    const sApplied = await sheet("applied", { read: "2026-09-01T09:05:00Z" });
    const sMigrated = await sheet("migrated", { read: "2026-08-01T09:05:00Z", migrated: true });
    const sStaged = await sheet("staged");
    const sReading = await sheet("reading");
    const sApplying = await sheet("applying");
    const sFailedNew = await sheet("failed-new");
    const sFailedAfter = await sheet("failed-after-applied", { read: "2026-09-01T09:05:00Z" });
    const sTie = await sheet("tie");
    const sCancelledOnly = await sheet("cancelled-only");
    const sAppliedCancelled = await sheet("applied-then-cancelled", { read: "2026-09-20T09:05:00Z" });
    await sheet("none");
    const sDeleted = await sheet("deleted", { deleted: true });
    const sInDeletedFile = await x.sheet(fd, "in-deleted-file");
    await x.sheet(fc, "empty-file-sheet");
    await x.run(sApplied, "applied", { at: "2026-09-01T09:00:00Z", done: "2026-09-01T09:05:00Z" });
    await x.run(sMigrated, "applied", { at: "2026-08-01T09:00:00Z", done: "2026-08-01T09:05:00Z" });
    await x.run(sStaged, "staged", { at: "2026-10-01T09:00:00Z" });
    await x.run(sReading, "reading", { at: "2026-10-02T09:00:00Z" });
    await x.run(sApplying, "applying", { at: "2026-10-03T09:00:00Z" });
    await x.run(sFailedNew, "failed", { at: "2026-10-04T09:00:00Z", done: "2026-10-04T09:05:00Z", error: "secret セルの中身 A1" });
    await x.run(sFailedAfter, "applied", { at: "2026-09-01T09:00:00Z", done: "2026-09-01T09:05:00Z" });
    await x.run(sFailedAfter, "failed", { at: "2026-10-05T09:00:00Z", done: "2026-10-05T09:05:00Z", error: "secret 2" });
    // 同じ時刻の 2 つの取り込みは、id の大きいほうが最後
    await x.run(sTie, "applied", { at: "2026-10-06T09:00:00Z", done: "2026-10-06T09:05:00Z", id: "00000000-0000-4000-8000-000000000001" });
    await x.run(sTie, "failed", { at: "2026-10-06T09:00:00Z", done: "2026-10-06T09:05:00Z", id: "00000000-0000-4000-8000-000000000002", error: "secret 3" });
    await x.run(sCancelledOnly, "cancelled", { at: "2026-10-07T09:00:00Z", done: "2026-10-07T09:01:00Z" });
    await x.run(sAppliedCancelled, "applied", { at: "2026-09-20T09:00:00Z", done: "2026-09-20T09:05:00Z" });
    await x.run(sAppliedCancelled, "cancelled", { at: "2026-09-25T09:00:00Z", done: "2026-09-25T09:01:00Z" });
    await x.run(sDeleted, "staged", { at: "2026-10-08T09:00:00Z" });
    await x.run(sInDeletedFile, "staged", { at: "2026-10-09T09:00:00Z" });

    const t = await withScope(erin, (tx) => loadTasks(tx, erin));
    // Task: 承認待ち → 失敗(始めた日時の新しい順)→ 途中(同じ)
    expect(t.count).toBe(6);
    expect(t.items.more).toBe(0);
    expect(t.items.items.map((i) => [i.kind, i.runStatus, i.sheet])).toEqual([
      ["approval", "staged", "staged"],
      ["failed", "failed", "tie"],
      ["failed", "failed", "failed-after-applied"],
      ["failed", "failed", "failed-new"],
      ["in_progress", "applying", "applying"],
      ["in_progress", "reading", "reading"],
    ]);
    expect(t.items.items[0]).toMatchObject({ file: "F-A 進み具合", startedAt: "2026-10-01T09:00:00.000Z", finishedAt: null, sheetId: sStaged });
    expect(t.items.items[3]).toMatchObject({ startedAt: "2026-10-04T09:00:00.000Z", finishedAt: "2026-10-04T09:05:00.000Z" });
    expect(t.items.items[1].runId).toBe("00000000-0000-4000-8000-000000000002");
    // 進み具合: 移行完了 > 途中 > 取り込み済み > 失敗。始めていないシートは別。消したシート・消したファイルは数えない
    expect(t.files.items.map((f) => [f.file, f.started, f.migrated, f.inProgress, f.imported, f.failed, f.notStarted])).toEqual([
      ["F-A 進み具合", 9, 1, 3, 3, 2, 2],
      ["F-C 空", 0, 0, 0, 0, 0, 1],
    ]);
    expect(t.files.more).toBe(0);
    expect(await withScope(erin, (tx) => countTasks(tx, erin))).toBe(6);
    // 取り込みの error の文(セルの中身が入りうる)は、どこにも出ない
    expect(JSON.stringify(t)).not.toContain("secret");
  });

  it("tasks: 消していないシートは 5,000 行まで(上限を超えても一覧は止まらず、ファイルの題の順に数える)", async () => {
    const w = frank.workspaceId!;
    const f = await helpers(w).file("F 大きいファイル");
    await admin`insert into fourdb.source_sheet (workspace_id, container_id, title) select ${w}, ${f}, 'S' || lpad(g::text, 5, '0') from generate_series(1, 5010) g`;
    const t = await withScope(frank, (tx) => loadTasks(tx, frank));
    expect(t.files.items).toHaveLength(1);
    expect(t.files.items[0]).toMatchObject({ file: "F 大きいファイル", started: 0, notStarted: 5000 });
    expect(t.count).toBe(0);
    expect(await withScope(frank, (tx) => countTasks(tx, frank))).toBe(0);
  });

  it("tasks: 別の workspace の取り込みは見えない(bob・何もない workspace は空)。件数も同じ", async () => {
    const carol: Scope = { principal: "test:carol", workspaceId: await personalWorkspace("test:carol") };
    for (const s of [bob, carol]) {
      expect(await withScope(s, (tx) => loadTasks(tx, s)), s.principal).toEqual({ count: 0, items: { items: [], more: 0 }, files: { items: [], more: 0 } });
      expect(await withScope(s, (tx) => countTasks(tx, s)), s.principal).toBe(0);
    }
  });

  // ---------- history ----------
  async function allHistory(scope: Scope, limit: number, kind?: string) {
    const pages: number[] = [];
    const items: HistoryItem[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const page = await withScope(scope, (tx) => listHistory(tx, scope, { cursor, limit, kind }));
      pages.push(page.items.length);
      items.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return { pages, items };
  }

  it("history: 新しい順に 50 件ずつ。id で続きを読み、全件を重複なく最後まで読める", async () => {
    expect(HISTORY_DEFAULT_LIMIT).toBe(50);
    const first = await withScope(alice, (tx) => listHistory(tx, alice));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items[49].id);
    const [{ n }] = await admin`select count(*) as n from fourdb.history where workspace_id = ${aliceWs()}`;
    expect(Number(n)).toBe(133); // 取り込み 1 + 表の保存 1 + edit 130 + おかしい記録 1
    const { pages, items } = await allHistory(alice, 50);
    expect(pages).toEqual([50, 50, 33]);
    const ids = items.map((h) => BigInt(h.id));
    expect(new Set(ids.map(String)).size).toBe(133); // 重複なし
    expect(ids).toEqual([...ids].sort((a, b) => (a > b ? -1 : 1))); // 新しい順(id の大きい順)
    // 最後のページ: 最後の 1 件だけで、nextCursor は null
    const last = await withScope(alice, (tx) => listHistory(tx, alice, { cursor: items[items.length - 2].id, limit: 50 }));
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
  });

  it("history: limit の上限(100)。多い指定は 100 に、0 や負の数は 1 に丸める。件数ぴったりのときは続きがない", async () => {
    expect(HISTORY_MAX_LIMIT).toBe(100);
    const big = await withScope(alice, (tx) => listHistory(tx, alice, { limit: 100000 }));
    expect(big.items).toHaveLength(100);
    expect(big.nextCursor).toBe(big.items[99].id); // 133 件のうち 100 件。まだ残りがある
    expect((await withScope(alice, (tx) => listHistory(tx, alice, { limit: 0 }))).items).toHaveLength(1);
    expect((await withScope(alice, (tx) => listHistory(tx, alice, { limit: -5 }))).items).toHaveLength(1);
    const rest = await withScope(alice, (tx) => listHistory(tx, alice, { limit: 100, cursor: big.nextCursor }));
    expect(rest.items).toHaveLength(33);
    expect(rest.nextCursor).toBeNull();
    // 件数と同じ limit(bob は 1 件、limit 1)でも、続きはない
    const one = await withScope(bob, (tx) => listHistory(tx, bob, { limit: 1 }));
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).toBeNull();
  });

  it("history: kind で絞れる(その種類だけ)。ページ送りも種類の中で続く", async () => {
    const edits = await allHistory(alice, 100, "edit");
    expect(edits.items).toHaveLength(130);
    expect(edits.items.every((h) => h.kind === "edit")).toBe(true);
    expect(edits.pages).toEqual([100, 30]);
    const imports = await allHistory(alice, 50, "import");
    expect(imports.items.map((h) => h.kind)).toEqual(["import", "import"]); // 取り込み 1 件(「2026年度」)+ おかしい記録
    expect((await allHistory(alice, 50, "nothing")).items).toEqual([]);
  });

  it("history: 取り込みは sheetId・内訳(lines)、表の保存は definitionId を返す。detail の中身(定義)は返さない。おかしい記録は安全な値にする", async () => {
    const { items } = await allHistory(alice, 100);
    const imported = items.find((h) => h.kind === "import" && h.title === "「2026年度」を取り込んだ")!;
    expect(imported.sheetId).toBe(uriageSheetId);
    expect(imported.definitionId).toBeNull();
    expect(imported.lines.length).toBeGreaterThan(0);
    expect(imported.lines.join("")).toContain("行");
    const saved = items.find((h) => h.kind === "definition")!;
    expect(saved.definitionId).toBe(definitionId);
    expect(saved.sheetId).toBeNull();
    expect(saved.title).toBe("表「合計」を保存した(版 1)");
    expect(saved.lines).toEqual([]);
    expect(Object.keys(saved).sort()).toEqual(["at", "definitionId", "id", "kind", "lines", "sheetId", "title"]); // detail(定義の中身)は含まない
    expect(new Date(saved.at).getTime()).not.toBeNaN();
    // おかしい記録(uuid でない id・数の id・長すぎる行・多すぎる行・文字でない行)
    const odd = items.find((h) => h.title === "おかしい記録")!;
    expect(odd.sheetId).toBeNull();
    expect(odd.definitionId).toBeNull();
    expect(odd.lines).toHaveLength(10);
    expect(odd.lines.every((l) => l.length === 200)).toBe(true);
  });

  it("history: 別の workspace の記録は見えない(alice に bob の記録は出ず、bob に alice の記録は出ない)。alice の id の cursor を bob に使っても、bob の分だけ", async () => {
    const a = await allHistory(alice, 100);
    expect(a.items.some((h) => h.title === "bob の記録")).toBe(false);
    const b = await allHistory(bob, 100);
    expect(b.items.map((h) => h.title)).toEqual(["bob の記録"]);
    const aliceTop = await withScope(alice, (tx) => listHistory(tx, alice, { limit: 5 }));
    const viaAliceCursor = await withScope(bob, (tx) => listHistory(tx, bob, { cursor: String(BigInt(aliceTop.items[0].id) + BigInt(1000)), limit: 100 }));
    expect(viaAliceCursor.items.map((h) => h.title)).toEqual(["bob の記録"]);
  });

  it("history: 形の違う cursor・kind は 400(データベースの 500 にしない)。limit が数でなければ既定。題は 200 文字までに切って返す", async () => {
    for (const opts of [{ cursor: "abc" }, { cursor: "1; drop table x" }, { cursor: "-1" }, { cursor: "1234567890123456789" }, { cursor: "1\u0000" }, { kind: "Import" }, { kind: "a\u0000" }, { kind: "a'; --" }]) {
      const e: unknown = await withScope(alice, (tx) => listHistory(tx, alice, opts)).then(() => null, (x: unknown) => x);
      expect(e, JSON.stringify(opts)).toBeInstanceOf(ImportError);
      expect((e as ImportError).status).toBe(400);
    }
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect((await withScope(alice, (tx) => listHistory(tx, alice, { limit }))).items, String(limit)).toHaveLength(HISTORY_DEFAULT_LIMIT);
    }
    // とても長い題(定義の名前・シートの名前が長いときなど)
    await admin`insert into fourdb.history (workspace_id, actor, kind, title) values (${aliceWs()}, 'test:alice', 'edit', ${"題".repeat(500)})`;
    const top = (await withScope(alice, (tx) => listHistory(tx, alice, { limit: 1 }))).items[0];
    expect(top.title).toBe("題".repeat(200));
    await admin`delete from fourdb.history where workspace_id = ${aliceWs()} and title = ${"題".repeat(500)}`;
  });

  // ---------- boxes ----------
  async function allBoxes(scope: Scope, opts: { parentId?: string | null; unitType?: string; q?: string; limit: number }) {
    const pages: number[] = [];
    const boxes: BoxItem[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const page = await withScope(scope, (tx) => listBoxes(tx, scope, { ...opts, cursor }));
      if (!page) throw new Error("親が見つかりません");
      pages.push(page.boxes.length);
      boxes.push(...page.boxes);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return { pages, boxes };
  }

  it("boxes: いちばん上の Box を 100 件ずつ、名前順に、子の数つきで。続きを読むと全件が重複なく出る", async () => {
    expect(BOXES_DEFAULT_LIMIT).toBe(100);
    const first = await withScope(alice, (tx) => listBoxes(tx, alice));
    expect(first!.parent).toBeNull();
    expect(first!.boxes).toHaveLength(100);
    expect(first!.nextCursor).not.toBeNull();
    const { pages, boxes } = await allBoxes(alice, { limit: 100 });
    // いちばん上: A社・B社・店舗グループ・取り込みが作った店舗コード 3・P0001〜P0250・dup×5 = 261
    expect(boxes).toHaveLength(261);
    expect(pages).toEqual([100, 100, 61]);
    expect(new Set(boxes.map((b) => b.id)).size).toBe(261);
    expect(boxes.every((b) => b.parentId === null)).toBe(true);
    // 並びは、続きを読まずに (名前, id) で並べたもの(データベースの文字の並び)と同じ
    const ordered = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and parent_id is null order by name, id`;
    expect(boxes.map((b) => b.id)).toEqual(ordered.map((r) => r.id));
    expect(boxes.find((b) => b.name === "A社")).toMatchObject({ unitType: "法人", type: "entity", childCount: 3 });
    expect(boxes.find((b) => b.name === "B社")).toMatchObject({ childCount: 0 });
    expect(boxes.find((b) => b.name === "店舗グループ")).toMatchObject({ unitType: null, type: "group", childCount: 0 });
  });

  it("boxes: limit の上限(200)。多い指定は 200 に、0 は 1 に丸める。同じ名前の Box が続いても、ページをまたいで取りこぼし・重複がない", async () => {
    expect(BOXES_MAX_LIMIT).toBe(200);
    expect((await withScope(alice, (tx) => listBoxes(tx, alice, { limit: 100000 })))!.boxes).toHaveLength(200);
    expect((await withScope(alice, (tx) => listBoxes(tx, alice, { limit: 0 })))!.boxes).toHaveLength(1);
    const dup = await allBoxes(alice, { limit: 2, unitType: "同名" }); // 同じ名前 dup の 5 件を 2 件ずつ
    expect(dup.pages).toEqual([2, 2, 1]);
    expect(new Set(dup.boxes.map((b) => b.id)).size).toBe(5);
  });

  it("boxes: 親を指すと、その子(と親の情報)。unitType・q(大文字小文字を区別しない)で絞れる。% や _ はワイルドカードにならない", async () => {
    const [a] = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'A社'`;
    const kids = await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: a.id }));
    expect(kids!.parent).toMatchObject({ id: a.id, name: "A社", parentId: null, unitType: "法人" });
    expect(kids!.boxes.map((b) => b.name)).toEqual(["A社 店1", "A社 店2", "A社 店3"]);
    expect(kids!.boxes.every((b) => b.parentId === a.id && b.unitType === "店舗" && b.childCount === 0)).toBe(true);
    expect(kids!.nextCursor).toBeNull();

    expect((await allBoxes(alice, { unitType: "法人", limit: 100 })).boxes.map((b) => b.name)).toEqual(["A社", "B社"]);
    expect((await allBoxes(alice, { q: "p00", limit: 100 })).boxes).toHaveLength(99); // P0001〜P0099(大文字小文字を区別しない)
    expect((await allBoxes(alice, { q: "P0250", limit: 100 })).boxes.map((b) => b.name)).toEqual(["P0250"]);
    expect((await allBoxes(alice, { q: "%", limit: 100 })).boxes).toEqual([]);
    expect((await allBoxes(alice, { q: "P_001", limit: 100 })).boxes).toEqual([]);
    expect((await allBoxes(alice, { q: "社", unitType: "法人", limit: 100 })).boxes.map((b) => b.name)).toEqual(["A社", "B社"]);
  });

  it("boxes: 親がこの workspace の Box でなければ null(ないもの・別の workspace のもの)。別の workspace の Box は一覧にも出ない", async () => {
    const [a] = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'A社'`;
    const [b] = await admin`select id from fourdb.box where workspace_id = ${bobWs()} and name = 'A社'`;
    expect(await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: "00000000-0000-4000-8000-000000000000" }))).toBeNull();
    expect(await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: b.id }))).toBeNull(); // bob の Box
    expect(await withScope(bob, (tx) => listBoxes(tx, bob, { parentId: a.id }))).toBeNull(); // alice の Box
    const bobTop = await allBoxes(bob, { limit: 100 });
    expect(bobTop.boxes.map((x) => x.name)).toEqual(["A社", "B社だけ見える"]);
    expect(bobTop.boxes.every((x) => x.id !== a.id)).toBe(true);
    expect((await allBoxes(alice, { unitType: "秘密の単位", limit: 100 })).boxes).toEqual([]);
    expect((await allBoxes(alice, { q: "B社だけ", limit: 100 })).boxes).toEqual([]);
  });

  // ---------- 続きの印(cursor)・長い名前・形の違う入力 ----------
  it("boxes: 名前がとても長い Box でも、ページをまたいで続きを読める(続きの印は Box の id 1 つだけ。名前を入れない)", async () => {
    const long = "あ".repeat(4000); // UTF-8 で 12,000 バイト
    await withScope(alice, async (tx) => {
      await tx`insert into fourdb.box (workspace_id, type, unit_type, name) values (${aliceWs()}, 'group', '長い', '長い名前の親')`;
      const [p] = await tx<{ id: string }[]>`select id from fourdb.box where workspace_id = ${aliceWs()} and name = '長い名前の親'`;
      await tx`insert into fourdb.box (workspace_id, parent_id, type, unit_type, name)
               select ${aliceWs()}, ${p.id}, 'entity', '長い', ${long} || lpad(g::text, 2, '0') from generate_series(1, 5) g`;
    });
    const [parent] = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and name = '長い名前の親'`;
    // 2 件ずつ: 2 ページ目・3 ページ目へ渡す cursor は、長い名前の Box の id(36 文字)
    const first = await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: parent.id, limit: 2 }));
    expect(first!.boxes).toHaveLength(2);
    expect(first!.boxes[0].name.length).toBe(4002);
    expect(first!.nextCursor).toBe(first!.boxes[1].id);
    expect(first!.nextCursor!.length).toBe(36);
    const { pages, boxes } = await allBoxes(alice, { parentId: parent.id, limit: 2 });
    expect(pages).toEqual([2, 2, 1]);
    expect(new Set(boxes.map((b) => b.id)).size).toBe(5);
    const ordered = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and parent_id = ${parent.id} order by name, id`;
    expect(boxes.map((b) => b.id)).toEqual(ordered.map((r) => r.id));
    // いちばん上でも、長い名前の Box(親)をまたいで取りこぼし・重複がない
    const top = await allBoxes(alice, { limit: 50 });
    expect(top.boxes.some((b) => b.name === "長い名前の親")).toBe(true);
    expect(new Set(top.boxes.map((b) => b.id)).size).toBe(top.boxes.length);
    await withScope(alice, (tx) => tx`delete from fourdb.box where workspace_id = ${aliceWs()} and (id = ${parent.id} or parent_id = ${parent.id})`);
  });

  it("boxes: cursor の Box がこの workspace になければ(ない id・消えた Box・別の workspace の Box・形の違うもの)、どれも同じ 400 で断る。存在を知らせない", async () => {
    const [mine] = await admin`select id from fourdb.box where workspace_id = ${aliceWs()} and name = 'A社'`;
    const [theirs] = await admin`select id from fourdb.box where workspace_id = ${bobWs()} and name = 'A社'`;
    const [gone] = await withScope(alice, (tx) => tx<{ id: string }[]>`insert into fourdb.box (workspace_id, type, name) values (${aliceWs()}, 'entity', '一時の Box') returning id`);
    await withScope(alice, (tx) => tx`delete from fourdb.box where id = ${gone.id}`);
    const refusal = async (scope: Scope, cursor: string) => {
      const e: unknown = await withScope(scope, (tx) => listBoxes(tx, scope, { cursor })).then(() => null, (x: unknown) => x);
      expect(e, cursor.slice(0, 40)).toBeInstanceOf(ImportError);
      return { status: (e as ImportError).status, message: (e as ImportError).message };
    };
    const expected = { status: 400, message: "cursor が見つかりません。最初から読み直してください" };
    expect(await refusal(alice, "00000000-0000-4000-8000-000000000000")).toEqual(expected); // ない id
    expect(await refusal(alice, gone.id)).toEqual(expected); // 消えた Box
    expect(await refusal(alice, theirs.id)).toEqual(expected); // bob の Box(alice の cursor に)
    expect(await refusal(bob, mine.id)).toEqual(expected); // alice の Box(bob の cursor に)
    expect(await refusal(alice, "not-a-uuid")).toEqual(expected); // 形の違うもの
    expect(await refusal(alice, "x".repeat(5000))).toEqual(expected);
    // 自分の Box の cursor なら通る
    expect((await withScope(alice, (tx) => listBoxes(tx, alice, { cursor: mine.id })))!.boxes.length).toBeGreaterThan(0);
  });

  it("boxes: 形の違う入力は、データベースの 500 にならず 400(NUL)か、見つからない(uuid でない parent)。limit が数でなければ既定", async () => {
    for (const opts of [{ q: "a\u0000b" }, { q: "\u0000" }, { unitType: "法人\u0000" }, { unitType: "\u0000" }]) {
      const e: unknown = await withScope(alice, (tx) => listBoxes(tx, alice, opts)).then(() => null, (x: unknown) => x);
      expect(e, JSON.stringify(opts)).toBeInstanceOf(ImportError);
      expect((e as ImportError).status).toBe(400);
    }
    expect(await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: "not-a-uuid" }))).toBeNull();
    expect(await withScope(alice, (tx) => listBoxes(tx, alice, { parentId: "\u0000" }))).toBeNull();
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect((await withScope(alice, (tx) => listBoxes(tx, alice, { limit })))!.boxes, String(limit)).toHaveLength(BOXES_DEFAULT_LIMIT);
    }
  });

  // ---------- 重ねの守り: SQL のパラメータ(workspace)と RLS(トランザクションの設定)の両方で絞っている ----------
  it("守り: 設定(RLS)の workspace と SQL のパラメータの workspace を食い違わせると何も見えない(どちらか一方だけでは漏れない)", async () => {
    // [設定の scope, パラメータに渡す scope]: データのある世界(alice・dave・erin)を、別の設定のまま読む
    const pairs = [[alice, bob], [bob, alice], [alice, dave], [dave, alice], [alice, erin], [erin, dave]] as const;
    for (const [setting, param] of pairs) {
      const label = `${setting.principal} の設定で ${param.principal} のパラメータ`;
      expect(await withScope(setting, (tx) => loadHome(tx, param)), label).toEqual({ units: [], others: { items: [], more: 0 }, topBoxes: 0 });
      expect(await withScope(setting, (tx) => loadTasks(tx, param)), label).toEqual({ count: 0, items: { items: [], more: 0 }, files: { items: [], more: 0 } });
      expect(await withScope(setting, (tx) => countTasks(tx, param)), label).toBe(0);
      expect((await withScope(setting, (tx) => listHistory(tx, param))).items, label).toEqual([]);
      expect((await withScope(setting, (tx) => listBoxes(tx, param)))!.boxes, label).toEqual([]);
    }
    // 設定もパラメータも自分なら、同じ世界は見える(上の空は、データがないからではない)
    expect((await withScope(erin, (tx) => loadTasks(tx, erin))).count).toBe(6);
    expect((await withScope(dave, (tx) => loadHome(tx, dave))).topBoxes).toBe(3);
  });
});
