// アカウントの設定(fourdb.principal_pref。0006)の結合テスト。FOURDB_TEST_ADMIN_URL がなければ飛ばす。
// ほかの結合テストとぶつからないよう、別のデータベース(<名前>_prefs)を作って使う(投影の _proj・ホームの _home と同じ)。
// 例: FOURDB_TEST_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_it npx vitest run src/fourdb/adapters/postgres/prefs.integration.test.ts
// 確かめること: 既定・一部だけの更新 / alice は bob の行を読めない・書けない(パラメータと RLS の両方) / 設定(GUC)とパラメータの食い違い /
//               表がない(down)・権限がないときは available: false(GET)と PrefsUnavailable(PUT)/ assertSafeRole が通り続ける。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LOOK, parsePrefsLenient, type Look, type PrefsPatch } from "@/fourdb/core/prefs";
import { assertSafeRole, withScope, type Scope } from "./db";
import { ImportError } from "./import-store";
import { applyMigrations, grantApp, MIGRATIONS_DIR } from "./migrate";
import { forgetPrefsAvailability, getPrefs, PrefsUnavailable, probePrefs, putPrefs, readPrefsRow, upsertPrefs } from "./prefs";

const ADMIN = process.env.FOURDB_TEST_ADMIN_URL;
const APP_ROLE = "fourdb_it_app";

const alice: Scope = { principal: "test:alice", workspaceId: null };
const bob: Scope = { principal: "test:bob", workspaceId: null };
const carol: Scope = { principal: "test:carol", workspaceId: null };
const LOOK_A: Look = { ...DEFAULT_LOOK, shape: "wire", layout: "arc" };
const LOOK_B: Look = { ...DEFAULT_LOOK, shape: "solid", bg: "grid" };
const DEFAULTS = parsePrefsLenient(undefined);

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
const failure = <T>(p: Promise<T>): Promise<unknown> => p.then(() => null, (e: unknown) => e);

describe.skipIf(!ADMIN)("アカウントの設定(結合)", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let upSql = "";
  let downSql = "";

  const row = async (s: Scope) =>
    (await admin<{ theme: string | null; world: string; look: unknown; updated_at: Date }[]>`
      select theme, world, look, updated_at from fourdb.principal_pref where principal = ${s.principal}`)[0] ?? null;
  const rowCount = async () => Number((await admin<{ n: string }[]>`select count(*) as n from fourdb.principal_pref`)[0].n);

  beforeAll(async () => {
    const base = new URL(ADMIN!);
    const dbName = `${base.pathname.slice(1)}_prefs`;
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
    const appUrl = Object.assign(new URL(adminUrl.toString()), { username: APP_ROLE, password: "" });
    process.env.FOURDB_DATABASE_URL = appUrl.toString();
    app = postgres(appUrl.toString(), { max: 1, onnotice: () => {} });
    upSql = await readFile(join(MIGRATIONS_DIR, "0006_principal_pref.sql"), "utf8");
    downSql = await readFile(join(MIGRATIONS_DIR, "0006_principal_pref.down.sql"), "utf8");
    forgetPrefsAvailability();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it("準備: 0006 が流れ、実行用の役割は assertSafeRole を通り(表は RLS の強制つき)、表と権限の確かめは「使える」", async () => {
    expect((await admin`select name from fourdb_migrations.applied where name = '0006_principal_pref.sql'`).length).toBe(1);
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
    expect(await withScope(alice, (tx) => probePrefs(tx))).toEqual({ present: true, allowed: true });
  });

  it("GET: 保存していない利用者は available・saved なし・既定の設定(行は作らない)", async () => {
    expect(await getPrefs(alice)).toEqual({ available: true, saved: false, prefs: DEFAULTS });
    expect(await row(alice)).toBeNull();
  });

  it("PUT: 送った欄だけが変わる(明暗 → 見た目 → World → 明暗を null に)。updated_at は書くたびに進む", async () => {
    const a1 = await putPrefs(alice, { theme: "dark" });
    expect(a1).toEqual({ available: true, saved: true, prefs: { ...DEFAULTS, theme: "dark" } });
    const r1 = (await row(alice))!;
    expect(r1).toMatchObject({ theme: "dark", world: "plain", look: {} }); // 見た目は送っていないので表の既定のまま({})。読むときに既定の見た目にする

    const a2 = await putPrefs(alice, { look: LOOK_A });
    expect(a2.prefs).toEqual({ theme: "dark", world: "plain", look: LOOK_A });
    const r2 = (await row(alice))!;
    expect(r2.look).toEqual(LOOK_A);
    expect(r2.updated_at.getTime()).toBeGreaterThan(r1.updated_at.getTime());

    const a3 = await putPrefs(alice, { world: "plain" });
    expect(a3.prefs).toEqual({ theme: "dark", world: "plain", look: LOOK_A });

    const a4 = await putPrefs(alice, { theme: null });
    expect(a4.prefs).toEqual({ theme: null, world: "plain", look: LOOK_A });
    expect(await getPrefs(alice)).toEqual({ available: true, saved: true, prefs: { theme: null, world: "plain", look: LOOK_A } });

    const a5 = await putPrefs(alice, { theme: "light", look: LOOK_B });
    expect(a5.prefs).toEqual({ theme: "light", world: "plain", look: LOOK_B });
    expect(await rowCount()).toBe(1); // 何度書いても alice の行は 1 つ
  });

  it("alice は bob の行を読めない・書けない(パラメータで絞り、RLS が重ねて守る)", async () => {
    await putPrefs(bob, { theme: "dark", look: LOOK_A });
    const bobBefore = (await row(bob))!;
    expect((await getPrefs(alice)).prefs.look).toEqual(LOOK_B); // alice には alice の設定
    expect((await getPrefs(bob)).prefs).toEqual({ theme: "dark", world: "plain", look: LOOK_A });

    // RLS だけでも: alice の取引から、条件なしで読む・bob の行を直す・消す
    const seen = await withScope(alice, (tx) => tx<{ principal: string }[]>`select principal from fourdb.principal_pref`);
    expect(seen.map((r) => r.principal)).toEqual(["test:alice"]);
    const upd = await withScope(alice, (tx) => tx`update fourdb.principal_pref set theme = 'light' where principal = ${bob.principal}`);
    expect(upd.count).toBe(0);
    const del = await withScope(alice, (tx) => tx`delete from fourdb.principal_pref where principal = ${bob.principal}`);
    expect(del.count).toBe(0);
    // alice の取引から bob の行を足す・上書きする・自分の行を bob に付け替える → RLS(with check)で止まる(42501)
    expect(codeOf(await failure(withScope(alice, (tx) => tx`insert into fourdb.principal_pref (principal, theme) values (${carol.principal}, 'dark')`)))).toBe("42501");
    expect(codeOf(await failure(withScope(alice, (tx) => tx`update fourdb.principal_pref set principal = ${bob.principal}`)))).toBe("42501");

    const after = (await row(bob))!;
    expect(after).toEqual(bobBefore);
    expect(await row(carol)).toBeNull();
  });

  it("設定(GUC)の利用者とパラメータの利用者が食い違うと、読めば何もなく、書けば止まって何も変わらない", async () => {
    const aliceBefore = (await row(alice))!;
    const bobBefore = (await row(bob))!;
    // alice の取引で bob のパラメータ・bob の取引で alice のパラメータ: 読めば null
    expect(await withScope(alice, (tx) => readPrefsRow(tx, bob))).toBeNull();
    expect(await withScope(bob, (tx) => readPrefsRow(tx, alice))).toBeNull();
    // 書けば RLS で止まる(行がある bob への上書きも、行がない carol への新規も)
    expect(codeOf(await failure(withScope(alice, (tx) => upsertPrefs(tx, bob, { theme: "light" }))))).toBe("42501");
    expect(codeOf(await failure(withScope(alice, (tx) => upsertPrefs(tx, carol, { theme: "light" }))))).toBe("42501");
    expect(await row(alice)).toEqual(aliceBefore);
    expect(await row(bob)).toEqual(bobBefore);
    expect(await row(carol)).toBeNull();
    // 利用者を設定しない取引(workspace だけ)では何も見えず、書けない
    const none = await app.begin(async (tx) => {
      await tx`select set_config('fourdb.principal', '', true)`;
      return tx<{ n: string }[]>`select count(*) as n from fourdb.principal_pref`;
    });
    expect(Number(none[0].n)).toBe(0);
    const blocked = await failure(
      app.begin(async (tx) => {
        await tx`select set_config('fourdb.principal', '', true)`;
        await tx`insert into fourdb.principal_pref (principal) values (${carol.principal})`;
      }),
    );
    expect(codeOf(blocked)).toBe("42501");
  });

  it("形の違う指定は 400(データベースの 500 にしない)。表の決まり(大きさ)に当たっても 400。どれも何も書かない", async () => {
    const before = (await row(alice))!;
    const bad: unknown[] = [{}, { color: "red" }, { theme: "blue" }, { theme: undefined }, { world: "Plain" }, { world: "" }, { look: [] }, { look: "glass" }, null, []];
    for (const p of bad) {
      const e = await failure(putPrefs(alice, p as PrefsPatch));
      expect(e, JSON.stringify(p)).toBeInstanceOf(ImportError);
      expect((e as ImportError).status).toBe(400);
    }
    // 芯の確かめをすり抜けた大きすぎる見た目(表の check: 2KB まで)
    const huge = await failure(putPrefs(alice, { look: { shape: "x".repeat(3000) } as unknown as Look }));
    expect(huge).toBeInstanceOf(ImportError);
    expect((huge as ImportError).status).toBe(400);
    expect(await row(alice)).toEqual(before);
    expect((await getPrefs(alice)).available).toBe(true); // 400 のあとも「使える」のまま
  });

  it("権限: SELECT だけでは「使えない」(まとめて確かめると 1 つでも通ってしまうので、1 つずつ見る)。権限が外れたら GET は available: false、PUT は PrefsUnavailable", async () => {
    await admin.unsafe(`revoke insert, update on fourdb.principal_pref from ${APP_ROLE}`);
    expect(await withScope(alice, (tx) => probePrefs(tx))).toEqual({ present: true, allowed: false });
    // 「使える」と覚えたままの GET は、読む権限があるので読める
    expect(await getPrefs(alice)).toMatchObject({ available: true, saved: true });
    // PUT は書けずに止まる → PrefsUnavailable。覚えたことを忘れ、次の GET で確かめ直して available: false
    expect(await failure(putPrefs(alice, { theme: "dark" }))).toBeInstanceOf(PrefsUnavailable);
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    expect(await failure(putPrefs(alice, { theme: "dark" }))).toBeInstanceOf(PrefsUnavailable);

    // 権限を戻すと使える。「使える」と覚えたあとで、すべての権限が外れても GET は 500 にならない
    await grantApp(admin, APP_ROLE);
    expect(await getPrefs(alice)).toMatchObject({ available: true, saved: true });
    await admin.unsafe(`revoke all on fourdb.principal_pref from ${APP_ROLE}`);
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    expect(await failure(putPrefs(alice, { theme: "dark" }))).toBeInstanceOf(PrefsUnavailable);
    await grantApp(admin, APP_ROLE);
    expect(await getPrefs(alice)).toMatchObject({ available: true, saved: true, prefs: { theme: "light", look: LOOK_B } });
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
  });

  it("元に戻す(down): 行があれば止まり、消す数を合わせたときだけ表が外れる。外れたら GET は available: false、PUT は PrefsUnavailable", async () => {
    const n = await rowCount();
    expect(n).toBe(2); // alice・bob
    // 行があるので止まる(P0001)。表も行も残る
    expect(codeOf(await failure(admin.unsafe(downSql)))).toBe("P0001");
    expect(await rowCount()).toBe(n);
    // 消す数が違えば止まる
    const wrong = await failure(
      admin.begin(async (tx) => {
        await tx`select set_config('fourdb.discard_principal_pref', ${String(n + 1)}, true)`;
        await tx.unsafe(downSql);
      }),
    );
    expect(codeOf(wrong)).toBe("P0001");
    expect(await rowCount()).toBe(n);
    // 数が合えば外れる
    await admin.begin(async (tx) => {
      await tx`select set_config('fourdb.discard_principal_pref', ${String(n)}, true)`;
      await tx.unsafe(downSql);
    });
    expect((await admin`select to_regclass('fourdb.principal_pref') as t`)[0].t).toBeNull();
    // もう一度流しても何もしない
    await admin.unsafe(downSql);

    // 「使える」と覚えたままの GET は、読み込みが止まる(42P01)ので忘れて available: false。次は確かめ直して available: false
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    expect(await withScope(alice, (tx) => probePrefs(tx))).toEqual({ present: false, allowed: false });
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    expect(await failure(putPrefs(alice, { theme: "dark" }))).toBeInstanceOf(PrefsUnavailable);
    // 表がなくても実行用の役割は assertSafeRole を通る
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
  });

  it("流し直し: 0006 をもう一度流すと表が戻る(権限は grantApp で渡すまで「使えない」)。表があるときに 0006 を流すと止まり、何も変わらない", async () => {
    await admin.unsafe(upSql).simple();
    expect(await withScope(alice, (tx) => probePrefs(tx))).toEqual({ present: true, allowed: false });
    expect(await getPrefs(alice)).toEqual({ available: false, saved: false, prefs: DEFAULTS });
    await grantApp(admin, APP_ROLE);
    expect(await getPrefs(alice)).toEqual({ available: true, saved: false, prefs: DEFAULTS }); // 前の行は down で消えている
    await putPrefs(alice, { theme: "dark" });
    expect(codeOf(await failure(admin.unsafe(upSql).simple()))).toBe("42P07");
    await admin`rollback`; // ファイルの begin のあとで止まったので、commit まで届かず取引が開いたまま。閉じる(何も変わらない)
    expect(await rowCount()).toBe(1);
    expect((await admin`select count(*)::int as n from pg_policy where polrelid = 'fourdb.principal_pref'::regclass`)[0].n).toBe(1);
    await expect(assertSafeRole(app)).resolves.toBeUndefined();
  });
});
