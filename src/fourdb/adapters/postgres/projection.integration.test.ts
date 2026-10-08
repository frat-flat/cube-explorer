// 集計(Projection Engine)の結合テスト。FOURDB_TEST_ADMIN_URL がなければ飛ばす。
// 取り込みの結合テストとぶつからないよう、別のデータベース(<名前>_proj)を作って使う。
// 試験用のスプシ(e2e/fixtures/sheets/fixture-uriage-2026.json)を取り込んでから集計し、スプシの合計と同じになるかを見る。
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultSpec } from "@/fourdb/core/import/spec";
import { PROJECTION_LIMITS, type ProjectionRequest } from "@/fourdb/core/projection/types";
import { fixtureReader } from "../google-sheets/fixture";
import { applyNext } from "./apply";
import { personalWorkspace, withScope, type Scope } from "./db";
import { checkApply, ImportError, proposal, readNext, registerBook, startRun } from "./import-store";
import { applyMigrations, grantApp } from "./migrate";
import { catalog, getDefinition, listDefinitions, project, saveDefinition, searchMembers, type Catalog } from "./projection";

const ADMIN = process.env.FOURDB_TEST_ADMIN_URL;
const APP_ROLE = "fourdb_it_app";

describe.skipIf(!ADMIN)("集計(結合)", () => {
  let admin: postgres.Sql;
  let alice: Scope;
  let cat: Catalog;
  const measure = (name: string) => cat.measures.find((m) => m.name === name)!.id;
  const dim = (name: string) => cat.dimensions.find((d) => d.name === name)!.id;
  const run = (req: Partial<ProjectionRequest>) =>
    withScope(alice, (tx) => project(tx, { measureId: measure("売上"), fn: "SUM", rows: null, columns: null, filters: [], sheetIds: null, ...req }));

  beforeAll(async () => {
    const base = new URL(ADMIN!);
    const dbName = `${base.pathname.slice(1)}_proj`;
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

    // 試験用のスプシを取り込む(取り込みの画面と同じ流れ)
    const reader = fixtureReader("e2e/fixtures/sheets");
    const sheets = await withScope(alice, async (tx) => registerBook(tx, await reader.book("fixture:fixture-uriage-2026")));
    const sheet = sheets.find((x) => x.title === "2026年度")!;
    const r = await withScope(alice, (tx) => startRun(tx, sheet.id, alice.principal));
    for (let i = 0; i < 20; i++) if ((await readNext(alice, r.id, reader)).done) break;
    const spec = defaultSpec((await withScope(alice, (tx) => proposal(tx, r.id))).proposal);
    expect((await withScope(alice, (tx) => checkApply(tx, r.id, spec))).errors).toEqual([]);
    let a = await applyNext(alice, r.id, spec);
    for (let i = 0; !a.done && i < 20; i++) a = await applyNext(alice, r.id, null);
    cat = await withScope(alice, (tx) => catalog(tx));
  });
  afterAll(async () => {
    await admin?.end();
  });

  it("選べるもの: 数値のカラム(売上・精算額)と、軸と段(月は 年・四半期・月。段の名前のない軸は軸の名前)", () => {
    expect(cat.measures.map((m) => m.name)).toEqual(["売上", "精算額"]);
    expect(cat.dimensions.find((d) => d.name === "月")!.levels).toEqual([{ level: 0, name: "年", count: 1 }, { level: 1, name: "四半期", count: 2 }, { level: 2, name: "月", count: 6 }]);
    expect(cat.dimensions.find((d) => d.name === "店舗コード")!.levels).toEqual([{ level: 0, name: "店舗コード", count: 3 }]);
  });

  it("店舗 × 月: 明細・行の合計・列の合計・総計が、スプシ(月の値・上期計・合計の行)と同じ", async () => {
    const p = await run({ rows: { dimensionId: dim("店舗コード"), level: null, subtotalLevel: null }, columns: { dimensionId: dim("月"), level: 2, subtotalLevel: null } });
    expect(p.rows.map((r) => r.name)).toEqual(["S-01", "S-02", "S-03"]);
    expect(p.columns.map((c) => c.name)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(p.cells.map((r) => r.map((c) => c.v))).toEqual([[100, 110, 120, 130, 140, 150], [50, 60, 70, 80, 90, 100], [10, 20, 30, 40, 50, 60]]);
    expect(p.rowTotals!.map((c) => c.v)).toEqual([750, 450, 210]);           // スプシの「上期計」の列
    expect(p.columnTotals!.map((c) => c.v)).toEqual([160, 190, 220, 250, 280, 310]);   // スプシの「合計」の行
    expect(p.grand).toMatchObject({ v: 1410, n: 18, kind: "raw" });          // スプシの 上期計 × 合計(L7)
  });

  it("段を上げる: 四半期(スプシの Q1計・Q2計と同じ)・年", async () => {
    const q = await run({ rows: { dimensionId: dim("店舗コード"), level: null, subtotalLevel: null }, columns: { dimensionId: dim("月"), level: 1, subtotalLevel: null } });
    expect(q.columns.map((c) => c.name)).toEqual(["2026-Q2", "2026-Q3"]);
    expect(q.cells.map((r) => r.map((c) => c.v))).toEqual([[330, 420], [180, 270], [60, 150]]);
    const y = await run({ columns: { dimensionId: dim("月"), level: 0, subtotalLevel: null } });
    expect(y.cells).toEqual([[{ v: 1410, n: 18, kind: "raw" }]]);
  });

  it("小計: 月を四半期ごとにまとめる(合計を軸の値にしない)", async () => {
    const p = await run({ rows: { dimensionId: dim("月"), level: 2, subtotalLevel: 1 } });
    expect(p.subtotals.map((x) => [x.name, x.cells[0].v])).toEqual([["2026-Q2", 570], ["2026-Q3", 840]]);
    expect(p.rows.map((r) => r.name)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(p.grand.v).toBe(1410);
  });

  it("絞り込み・集計のしかた・計算された値の印", async () => {
    const s01 = (await withScope(alice, (tx) => searchMembers(tx, dim("店舗コード"), null, "s-01")))[0];
    expect((await run({ filters: [{ dimensionId: dim("店舗コード"), memberIds: [s01.id] }] })).grand.v).toBe(750);
    expect((await run({ fn: "COUNT" })).grand.v).toBe(18);
    expect((await run({ fn: "MIN" })).grand.v).toBe(10);
    expect((await run({ fn: "MAX" })).grand.v).toBe(150);
    expect((await run({ fn: "AVG" })).grand.v).toBeCloseTo(1410 / 18);
    expect((await run({ measureId: measure("精算額") })).grand).toMatchObject({ v: 1269, kind: "calculated" });
  });

  it("表の定義を保存し、開き直せる。上書きで版が上がり、同じ名前は止める", async () => {
    const req: ProjectionRequest = { measureId: measure("売上"), fn: "SUM", rows: { dimensionId: dim("店舗コード"), level: null, subtotalLevel: null }, columns: { dimensionId: dim("月"), level: 1, subtotalLevel: null }, filters: [], sheetIds: null };
    const saved = await withScope(alice, (tx) => saveDefinition(tx, { id: null, name: "店舗×四半期", request: req }));
    expect(saved.version).toBe(1);
    expect((await withScope(alice, (tx) => getDefinition(tx, saved.id))).request).toEqual(req);
    const again = await withScope(alice, (tx) => saveDefinition(tx, { id: saved.id, name: "店舗×四半期", request: { ...req, fn: "AVG" } }));
    expect(again.version).toBe(2);
    await expect(withScope(alice, (tx) => saveDefinition(tx, { id: null, name: "店舗×四半期", request: req }))).rejects.toThrow("同じ名前");
    expect((await withScope(alice, (tx) => listDefinitions(tx))).map((d) => d.name)).toEqual(["店舗×四半期"]);
    const hist = await withScope(alice, (tx) => tx<{ n: string }[]>`select count(*) as n from fourdb.history where kind = 'definition'`);
    expect(hist[0].n).toBe("2");
  });

  it("表が大きすぎれば、中身を返さずに知らせる(行・列の数を添えて)", async () => {
    const before = PROJECTION_LIMITS.rows;
    PROJECTION_LIMITS.rows = 2;
    try {
      await expect(run({ rows: { dimensionId: dim("店舗コード"), level: null, subtotalLevel: null }, columns: { dimensionId: dim("月"), level: 2, subtotalLevel: null } })).rejects.toThrow("表が大きすぎます(行 3・列 6)");
    } finally {
      PROJECTION_LIMITS.rows = before;
    }
  });

  it("別の人(workspace)からは、数値のカラムも表の定義も軸の値も見えない", async () => {
    const bob: Scope = { principal: "test:bob", workspaceId: await personalWorkspace("test:bob") };
    await expect(withScope(bob, (tx) => project(tx, { measureId: measure("売上"), fn: "SUM", rows: null, columns: null, filters: [], sheetIds: null }))).rejects.toThrow(ImportError);
    expect((await withScope(bob, (tx) => catalog(tx))).measures).toEqual([]);
    expect(await withScope(bob, (tx) => listDefinitions(tx))).toEqual([]);
    // alice の表の定義を開く・上書きする、alice の軸の値を探す
    const [def] = await withScope(alice, (tx) => listDefinitions(tx));
    await expect(withScope(bob, (tx) => getDefinition(tx, def.id))).rejects.toThrow("見つかりません");
    const req: ProjectionRequest = { measureId: measure("売上"), fn: "SUM", rows: null, columns: null, filters: [], sheetIds: null };
    await expect(withScope(bob, (tx) => saveDefinition(tx, { id: def.id, name: "横取り", request: req }))).rejects.toThrow("見つかりません");
    expect(await withScope(bob, (tx) => searchMembers(tx, dim("店舗コード"), null, ""))).toEqual([]);
    expect((await withScope(alice, (tx) => getDefinition(tx, def.id))).name).toBe(def.name);
  });
});
