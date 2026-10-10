-- 0006_principal_pref.sql(アカウントごとの設定)の確かめ。使い捨てのデータベースで、superuser で流す(0001〜0006 を流したあと)。
-- 例: psql -v ON_ERROR_STOP=1 -f test/0006_principal_pref.check.sql(down は ../migrations/ から \ir で読む。置き場所の並びはそのまま)
-- 確かめること: RLS の強制(表の持ち主にもかかる)・方針(自分の行だけ読み書き)・表の決まり(check)・権限(PUBLIC に何も渡さない)・
--               元に戻す 0006_principal_pref.down.sql(行があれば止まる・数が合えば消える・もう一度流しても何もしない)。
-- 失敗したら例外で止まる。最後にすべて rollback するので、何も残らない(試験用の役割も)。「NOTICE: OK」の行が 48 出れば通過(NG は 0)。down の確かめでは、down が止まったときの ERROR が 2 回出る(行の数だけを含む。想定どおり)。
-- 止まったときの文(例外の中身)は出さない(値を含みうるため)。止まった理由の種類(SQLSTATE)だけを見る。
-- down は、ファイルをそのまま(\ir で)この取引の中で流す(down は 1 つの DO 文だけでできていて、begin / commit を含まない)。

begin;
set constraints all immediate;
set local search_path = pg_catalog;   -- 方針の条件の文字の形(関数の名前に名前空間が付くか)を、接続の設定によらず同じにする

-- 使い捨ての試験用データベースでなければ、何もせずに止める(0005 の確かめと同じ決まり)
do $$
begin
  if not (pg_catalog.current_database() like 'fourdb\_it%' or pg_catalog.current_database() ~ '(test|check|perf)'
          or not exists (select 1 from fourdb.workspace)) then
    raise exception 'NG: 使い捨ての試験用データベースではないので流しません(名前が fourdb_it… か test・check・perf を含むか、workspace が空のときだけ)';
  end if;
  if not (select rolsuper from pg_catalog.pg_roles where rolname = current_user) then
    raise exception 'NG: superuser で流してください(RLS を飛ばして、表の中身をすべて見て確かめるため)';
  end if;
  raise notice 'OK: 使い捨ての試験用データベース(%)を superuser で確かめる', pg_catalog.current_database();
end $$;

-- 止まることを確かめる。止まった理由の種類(SQLSTATE)が想定どおりかだけを見る(文は出さない)
create function pg_temp.expect_state(sql text, state text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate <> state then
      raise exception 'NG: 止まったが、理由の種類が違う(% ではなく %): %', state, sqlstate, label;
    end if;
    raise notice 'OK (拒否 %): %', state, label;
    return;
  end;
  raise exception 'NG: 通ってしまった: %', label;
end $$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'NG: %', label; end if;
  raise notice 'OK: %', label;
end $$;

-- 文を流して、変わった行の数を返す(RLS で見えない行は 0 になる)
create function pg_temp.affected(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ========== 表・RLS・方針・権限(カタログ) ==========
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is not null, '表 fourdb.principal_pref がある');
select pg_temp.ok((select c.relrowsecurity and c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = 'fourdb.principal_pref'::regclass),
  'RLS が有効で、強制(FORCE。表の持ち主にもかかる)');
select pg_temp.ok((select count(*) from pg_catalog.pg_policy p where p.polrelid = 'fourdb.principal_pref'::regclass) = 1, '方針は 1 つだけ');
select pg_temp.ok((select p.polname = 'principal_scope' and p.polcmd = '*' and p.polpermissive and p.polroles = '{0}'::oid[]
                     from pg_catalog.pg_policy p where p.polrelid = 'fourdb.principal_pref'::regclass),
  '方針 principal_scope は、すべての操作(読み・足し・直し・消し)・すべての役割にかかる、許可の方針');
select pg_temp.ok((select pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(principal = ( SELECT fourdb.current_principal() AS current_principal))'
                      and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = '(principal = ( SELECT fourdb.current_principal() AS current_principal))'
                     from pg_catalog.pg_policy p where p.polrelid = 'fourdb.principal_pref'::regclass),
  '方針の条件は、読み(using)も書き(with check)も「principal = 今の処理の利用者」');
select pg_temp.ok((select p.prosecdef = false and p.provolatile = 's' and p.proconfig = array['search_path=""']
                     from pg_catalog.pg_proc p where p.oid = 'fourdb.current_principal()'::regprocedure),
  'fourdb.current_principal() は呼んだ人の権限で動き(SECURITY DEFINER でない)、search_path が固定');
select pg_temp.ok((select count(*) from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
                    where c.oid = 'fourdb.principal_pref'::regclass and a.grantee = 0) = 0, 'PUBLIC には何の権限もない');
select pg_temp.ok((select count(*) from pg_catalog.pg_trigger t where t.tgrelid = 'fourdb.principal_pref'::regclass and not t.tgisinternal) = 0,
  'トリガーはない(書き込みで別の処理が動かない)');

-- ========== 表の決まり(check)と既定 ==========
insert into fourdb.principal_pref (principal) values ('check:defaults');
select pg_temp.ok((select theme is null and world = 'plain' and look = '{}'::jsonb and updated_at is not null
                     from fourdb.principal_pref where principal = 'check:defaults'),
  '既定: 明暗 null(パソコンに合わせる)・World plain・見た目 {}・updated_at あり');
insert into fourdb.principal_pref (principal, theme, world, look) values
  ('check:dark', 'dark', 'p5-world_1', '{"shape": "glass"}'),
  ('check:light', 'light', 'a', '{}'),
  (pg_catalog.repeat('p', 200), null, 'a' || pg_catalog.repeat('b', 31), '{}');
select pg_temp.ok(true, '明暗 dark・light、World の名前(小文字で始まる 32 文字まで)、principal 200 文字は入る');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, theme) values ('check:x', 'blue')$$, '23514', '明暗が dark・light・null 以外');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, theme) values ('check:x', 'Dark')$$, '23514', '明暗の大文字');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, world) values ('check:x', 'Plain')$$, '23514', 'World が大文字で始まる');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, world) values ('check:x', '')$$, '23514', 'World が空');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, world) values ('check:x', 'a' || repeat('b', 32))$$, '23514', 'World が 33 文字');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, world) values ('check:x', '../x')$$, '23514', 'World に使えない文字');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, world) values ('check:x', null)$$, '23502', 'World が null');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, look) values ('check:x', '[]')$$, '23514', '見た目が配列');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, look) values ('check:x', '"glass"')$$, '23514', '見た目が文字');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, look) values ('check:x', jsonb_build_object('k', repeat('x', 2100)))$$, '23514', '見た目が 2KB を超える');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, look) values ('check:x', null)$$, '23502', '見た目が null');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal) values ('')$$, '23514', 'principal が空');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal) values (repeat('p', 201))$$, '23514', 'principal が 201 文字');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal) values ('check:dark')$$, '23505', '同じ principal の行を 2 つ');

-- ========== 実行用の役割で: 自分の行だけ(RLS) ==========
-- 入れ物の実行用の役割を真似る(grantApp と同じ権限。持ち主でも superuser でもない)。役割は最後の rollback で消える
create role fourdb_check6_app nologin;
grant usage on schema fourdb to fourdb_check6_app;
grant select, insert, update, delete on all tables in schema fourdb to fourdb_check6_app;
grant execute on all functions in schema fourdb to fourdb_check6_app;
set local role fourdb_check6_app;

select set_config('fourdb.principal', '', true);
select pg_temp.ok((select count(*) from fourdb.principal_pref) = 0, '利用者を設定していなければ、何も見えない');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal) values ('check:alice')$$, '42501', '利用者を設定せずに書く');

select set_config('fourdb.principal', 'check:alice', true);
insert into fourdb.principal_pref (principal, theme) values ('check:alice', 'dark');
select pg_temp.ok((select pg_catalog.string_agg(principal, ',') from fourdb.principal_pref) = 'check:alice', 'alice には自分の行だけが見える');
select pg_temp.ok(pg_temp.affected($$update fourdb.principal_pref set theme = 'light' where principal = 'check:dark'$$) = 0, 'alice は別の人の行を直せない(0 行)');
select pg_temp.ok(pg_temp.affected($$delete from fourdb.principal_pref where principal = 'check:dark'$$) = 0, 'alice は別の人の行を消せない(0 行)');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, theme) values ('check:bob', 'light')$$, '42501', 'alice が別の人(bob)の行を足す');
select pg_temp.expect_state($$insert into fourdb.principal_pref (principal, theme) values ('check:dark', 'light') on conflict (principal) do update set theme = excluded.theme$$, '42501', 'alice が別の人の行を上書き(on conflict)する');
select pg_temp.expect_state($$update fourdb.principal_pref set principal = 'check:bob' where principal = 'check:alice'$$, '42501', 'alice が自分の行を別の人の行に付け替える');
insert into fourdb.principal_pref (principal, world) values ('check:alice', 'plain')
  on conflict (principal) do update set world = excluded.world, updated_at = now();
select pg_temp.ok((select theme = 'dark' from fourdb.principal_pref where principal = 'check:alice'), 'alice は自分の行を上書きでき、送らなかった欄(明暗)は残る');

select set_config('fourdb.principal', 'check:bob', true);
select pg_temp.ok((select count(*) from fourdb.principal_pref) = 0, 'bob からは alice の行も、ほかの行も見えない');
reset role;
select pg_temp.ok((select theme from fourdb.principal_pref where principal = 'check:dark') = 'dark'
              and not exists (select 1 from fourdb.principal_pref where principal = 'check:bob'),
  '(superuser で見て)別の人の行は変わっておらず、bob の行もできていない');

-- ========== 表の持ち主(superuser でない)にも RLS がかかる(FORCE) ==========
select c.relowner::regrole::text as orig_owner from pg_catalog.pg_class c where c.oid = 'fourdb.principal_pref'::regclass \gset
create role fourdb_check6_owner nologin;
grant usage on schema fourdb to fourdb_check6_owner;
grant execute on all functions in schema fourdb to fourdb_check6_owner;
alter table fourdb.principal_pref owner to fourdb_check6_owner;
set local role fourdb_check6_owner;
select set_config('fourdb.principal', '', true);
select pg_temp.ok((select count(*) from fourdb.principal_pref) = 0, '表の持ち主でも、利用者を設定しなければ何も見えない(FORCE)');
set local row_security = off;
select pg_temp.expect_state($$select count(*) from fourdb.principal_pref$$, '42501',
  '表の持ち主が row_security = off で全部を数えようとすると、0 行ではなくエラーになる');
set local row_security = on;
reset role;
alter table fourdb.principal_pref owner to :"orig_owner";

-- ========== 元に戻す(0006_principal_pref.down.sql をそのまま流す) ==========
select count(*) as n6 from fourdb.principal_pref \gset
select pg_temp.ok(:n6 > 0, '(down の確かめの前に)表に行がある: ' || :n6 || ' 行');

-- (1) 行があれば止まり(raise exception = P0001)、表も行も残る。down が止まると取引はエラーの状態になるので、保存点まで戻す
savepoint down_refuse;
\set LAST_ERROR_SQLSTATE 00000
\set ON_ERROR_STOP 0
\ir ../migrations/0006_principal_pref.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint down_refuse;
select pg_temp.ok(:'LAST_ERROR_SQLSTATE' = 'P0001', '行があるので、down は止まった(P0001)');
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is not null
              and (select count(*) from fourdb.principal_pref) = :n6
              and (select c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = 'fourdb.principal_pref'::regclass),
  'down が止まったあと、表・行・RLS の強制がそのまま残る');

-- (2) 消す数が今の行の数と食い違えば止まる
savepoint down_wrong_count;
select set_config('fourdb.discard_principal_pref', (:n6 - 1)::text, true);
\set LAST_ERROR_SQLSTATE 00000
\set ON_ERROR_STOP 0
\ir ../migrations/0006_principal_pref.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint down_wrong_count;
select pg_temp.ok(:'LAST_ERROR_SQLSTATE' = 'P0001'
              and pg_catalog.to_regclass('fourdb.principal_pref') is not null and (select count(*) from fourdb.principal_pref) = :n6,
  '消す数が今の行の数と違えば、down は止まり、表と行が残る');

-- (3) 数が合えば消える。もう一度流しても何もしない
savepoint down_ok;
select set_config('fourdb.discard_principal_pref', :'n6', true);
\ir ../migrations/0006_principal_pref.down.sql
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is null, '消す数が合えば、down で表が外れる');
select pg_temp.ok((select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid where c.relname = 'principal_pref') = 0,
  '方針も一緒に外れる');
\ir ../migrations/0006_principal_pref.down.sql
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is null, 'もう一度 down を流しても止まらず、何もしない');
select pg_temp.ok(pg_catalog.to_regclass('fourdb.workspace') is not null and pg_catalog.to_regclass('fourdb.value') is not null, 'ほかの表は残る');
rollback to savepoint down_ok;

-- (4) 空なら数の設定なしで消える
savepoint down_empty;
delete from fourdb.principal_pref;
select set_config('fourdb.discard_principal_pref', '', true);
\ir ../migrations/0006_principal_pref.down.sql
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is null, '行がなければ、数の設定なしで down で表が外れる');
rollback to savepoint down_empty;
select pg_temp.ok(pg_catalog.to_regclass('fourdb.principal_pref') is not null, '(保存点まで戻したので)表はまだある');

rollback;
