-- 0005_value_rules_lookup.sql の確かめ。使い捨てのデータベースで、superuser で流す(0001〜0005 を流したあと)。
-- 例: psql -v ON_ERROR_STOP=1 -f test/0005_value_rules.check.sql
-- 1つの文でたくさん入れたときも、値・スプシの合計の決まり(何を止めるか・止めるときの文)が 0001・0002 と同じかを見る。
-- 統計の状態はデータベースの来歴で変わる(統計なし・古い・空のときに vacuum された …)ので、この中でいちばん悪い状態を作ってから流す
-- (表の大きさの記録 reltuples を 0 や -1 にし、列の統計を消す。最後の rollback で元に戻る)。どの状態でも 20 秒以内に入ることを見る。
-- 失敗したら例外で止まる。最後にすべて rollback するので、何も残らない。「OK」の行が 20 出れば通過(NG は 0)。
-- 止まったときの文(例外の中身)は出さない(値を含みうるため)。決まった文の頭が含まれるか、決まった文とまったく同じか(0001 と同じ文か)だけを見る。
-- 表の大きさの記録(pg_class)・列の統計(pg_statistic)を書き換え、自動の vacuum を止めるので、使い捨ての試験用データベースでしか流せない
-- (名前が fourdb_it… か、test・check・perf を含むか、workspace が1つもないときだけ流れる。それ以外は最初に止まる)。

begin;
set constraints all immediate;

-- 使い捨ての試験用データベースでなければ、何もせずに止める
do $$
begin
  if not (pg_catalog.current_database() like 'fourdb\_it%' or pg_catalog.current_database() ~ '(test|check|perf)'
          or not exists (select 1 from fourdb.workspace)) then
    raise exception 'NG: 使い捨ての試験用データベースではないので流しません(名前が fourdb_it… か test・check・perf を含むか、workspace が空のときだけ)';
  end if;
  raise notice 'OK: 使い捨ての試験用データベース(%)', pg_catalog.current_database();
end $$;

create function pg_temp.expect_error(sql text, needle text, label text) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute sql;
  exception when others then
    msg := sqlerrm;
    if position(needle in msg) = 0 then
      raise exception 'NG: 止まったが、文が違う: %', label;
    end if;
    raise notice 'OK (拒否): %', label;
    return;
  end;
  raise exception 'NG: 通ってしまった: %', label;
end $$;

-- 止まったときの文が、決まった文とまったく同じか(行・列の番号まで。0001 の value_rules と同じ文か)
create function pg_temp.expect_error_exact(sql text, expected text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm is distinct from expected then
      raise exception 'NG: 止まったが、文が違う: %', label;
    end if;
    raise notice 'OK (拒否・文も同じ): %', label;
    return;
  end;
  raise exception 'NG: 通ってしまった: %', label;
end $$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'NG: %', label; end if;
  raise notice 'OK: %', label;
end $$;

-- 値・行・列・表・スプシの合計の表(と索引)の統計を、わざと悪い状態にする(superuser で。rollback で戻る)
--   empty_vacuumed: 空のときに vacuum された(reltuples = 0・relpages > 0)。どの索引の見積もりも同じになる
--   never_analyzed: 一度も vacuum・analyze されていない(reltuples = -1)
create function pg_temp.bad_stats(mode text) returns void language plpgsql as $$
declare t regclass;
begin
  foreach t in array array['fourdb.value', 'fourdb.record', 'fourdb.source_column', 'fourdb.source_sheet', 'fourdb.source_total']::regclass[] loop
    update pg_catalog.pg_class c
       set reltuples = case mode when 'empty_vacuumed' then 0 else -1 end,
           relpages = case mode when 'empty_vacuumed' then 1 else 0 end,
           relallvisible = 0
     where c.oid = t or c.oid in (select i.indexrelid from pg_catalog.pg_index i where i.indrelid = t);
    delete from pg_catalog.pg_statistic where starelid = t;
  end loop;
  raise notice 'OK: 統計を % の状態にした', mode;
end $$;

-- ========== 準備: workspace・軸・表(移行中)・列・行 ==========
insert into fourdb.workspace (id, name) values ('00000000-0000-0000-0000-0000000000a5', 'A5');
insert into fourdb.dimension (id, workspace_id, name, semantic_type) values
  ('10000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a5', '店舗', 'entity');
insert into fourdb.column_definition (id, workspace_id, name, kind) values
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5', '売上', 'measure'),
  ('40000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a5', '区分', 'attribute');
insert into fourdb.source_container (id, workspace_id, provider, external_id, title) values
  ('50000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a5', 'google_sheets', 'book-a5', 'スプシ');
insert into fourdb.source_sheet (id, workspace_id, container_id, external_id, title) values
  ('60000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-0000000000a5', 'gid-a5', 'タブ');
insert into fourdb.source_column (id, workspace_id, sheet_id, col_index, header, role, column_definition_id, aggregate_function) overriding system value values
  (9001, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 0, '売上', 'measure', '40000000-0000-0000-0000-0000000000a1', null),
  (9002, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 1, '区分', 'attribute', '40000000-0000-0000-0000-0000000000a2', null),
  (9003, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 2, '計', 'aggregate', null, 'SUM'),
  (9004, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 3, 'メモ', 'ignore', null, null);
-- データの行 1〜20000(行 id は 900001〜)と、合計の行(行 id 999999)
insert into fourdb.record (id, workspace_id, sheet_id, row_key, row_index, kind) overriding system value
select 900000 + g, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 'k' || g, g, 'data' from generate_series(1, 20000) g;
insert into fourdb.record (id, workspace_id, sheet_id, row_key, row_index, kind) overriding system value values
  (999999, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', '#20002', 20001, 'aggregate'),
  (920001, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 'k-empty', 20002, 'data');   -- 値のない行(止める確かめに使う)
-- 閉じた行(920002)と閉じた列(9005)
insert into fourdb.record (id, workspace_id, sheet_id, row_key, row_index, kind, system_from, system_to) overriding system value values
  (920002, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 'k-closed', 20003, 'data', now() - interval '1 day', now());
insert into fourdb.source_column (id, workspace_id, sheet_id, col_index, header, role, column_definition_id, system_from, system_to) overriding system value values
  (9005, '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 0, '売上(前の版)', 'measure', '40000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now());

-- 自動の vacuum・analyze がこの間に統計を書き換えないよう、表を押さえる(rollback で戻る)
alter table fourdb.value set (autovacuum_enabled = false);
alter table fourdb.record set (autovacuum_enabled = false);
alter table fourdb.source_column set (autovacuum_enabled = false);
alter table fourdb.source_sheet set (autovacuum_enabled = false);
alter table fourdb.source_total set (autovacuum_enabled = false);
select pg_temp.bad_stats('empty_vacuumed');

-- ここからは入れ物の実行用の役割を真似る(持ち主でも superuser でもない。行ごとの権限がかかる)。役割は最後の rollback で消える
create role fourdb_check5_app nologin;
grant usage on schema fourdb to fourdb_check5_app;
grant select, insert, update, delete on all tables in schema fourdb to fourdb_check5_app;
grant execute on all functions in schema fourdb to fourdb_check5_app;
set local role fourdb_check5_app;
select set_config('fourdb.workspace_id', '00000000-0000-0000-0000-0000000000a5', true);

-- ========== 値: たくさんを1つの文で(統計は「空のときに vacuum された」状態) ==========
-- 入れた数 × 表の数 の比べ合いにならない(0005 より前は数十秒〜、0005 の最初の形でも統計しだいで数十秒)
set local statement_timeout = '20s';
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin)
select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900000 + g, 9001, 'raw', g, 'import' from generate_series(1, 20000) g;
select pg_temp.ok((select count(*) from fourdb.value where column_id = 9001 and system_to is null) = 20000, '数値の値 2 万個を1つの文で、20 秒以内に入れられる');
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, origin)
select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900000 + g, 9002, 'raw', '区分' || (g % 3), 'import' from generate_series(1, 20000) g;
set local statement_timeout = 0;
select pg_temp.ok((select count(*) from fourdb.value where system_to is null) = 40000, '表に 2 万個ある状態で、属性の値 2 万個も 20 秒以内に入る');

select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin)
  select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', r, 9001, 'raw', 1, 'import' from unnest(array[999999]) r$$,
  '合計・小計の行には値を入れません', '合計の行に値を入れる(1つの文の中の1個だけ)');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, origin)
  select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900001, c, 'raw', 'x', 'import' from unnest(array[9004]) c$$,
  '数値か属性の列にだけ値を入れます', '使わない列に値を入れる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920001, 9001, 'raw', '文字', 'import')$$,
  '数値の列には数値を入れます', '数値の列に文字だけを入れる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920001, 9001, 'raw', 5, 'manual')$$,
  '移行中の表は 4D Base で直せません', '移行中の表を 4D Base で直す');
-- 次の 3 つは、止めるときの文が 0001 とまったく同じか(行・列の番号まで)を見る
select pg_temp.expect_error_exact($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920002, 9001, 'raw', 1, 'import')$$,
  '行 920002・列 9001: 閉じた行・列には値を入れません', '閉じた行に値を入れる');
select pg_temp.expect_error_exact($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920001, 9005, 'raw', 1, 'import')$$,
  '行 920001・列 9005: 閉じた行・列には値を入れません', '閉じた列に値を入れる');
select pg_temp.expect_error_exact($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, valid_from, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920001, 9001, 'raw', 1, '2026-01-01', 'import')$$,
  '行 920001・列 9001: 数値の値には期間を付けません(時間は軸で表します)', '数値の値に期間を付ける');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900002, 9002, 'raw', '新', '2025-01-01', 'import')$$,
  '期間が重なる今の値がすでにあります', '期間のない今の値があるセルに、期間つきの値を足す');

-- 属性の期間: 同じ文の中の2個どうしが重なれば止め、重ならなければ通す
update fourdb.value set system_to = clock_timestamp() where record_id in (900003, 900004) and column_id = 9002 and system_to is null;
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, valid_to, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900003, 9002, 'raw', '前', '2024-01-01', '2025-06-01', 'import'),
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900003, 9002, 'raw', '後', '2025-01-01', null, 'import')$$,
  '期間が重なる今の値がすでにあります', '同じ文の中で、同じセルの期間が重なる2個');
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, valid_to, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900004, 9002, 'raw', '前', '2024-01-01', '2025-01-01', 'import'),
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900004, 9002, 'raw', '後', '2025-01-01', null, 'import');
select pg_temp.ok((select count(*) from fourdb.value where record_id = 900004 and column_id = 9002 and system_to is null) = 2, '同じ文の中で、期間が重ならない2個は入る');

-- ========== スプシの合計(統計は「一度も analyze されていない」状態) ==========
reset role;
select pg_temp.bad_stats('never_analyzed');
set local role fourdb_check5_app;
set local statement_timeout = '20s';
insert into fourdb.source_total (workspace_id, sheet_id, record_id, column_id, num)
select '00000000-0000-0000-0000-0000000000a5'::uuid, '60000000-0000-0000-0000-0000000000a5'::uuid, 900000 + g, 9003, g from generate_series(1, 20000) g
union all select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 999999, 9001, 1;
set local statement_timeout = 0;
select pg_temp.ok((select count(*) from fourdb.source_total where system_to is null) = 20001, 'スプシの合計(合計の列 2 万個と合計の行)を1つの文で、20 秒以内に入れられる');
select pg_temp.expect_error($$insert into fourdb.source_total (workspace_id, sheet_id, record_id, column_id, num)
  select '00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', r, 9001, 1 from unnest(array[900005]) r$$,
  '合計の行か合計の列のセルだけを残します', 'データの行 × 数値の列のセルをスプシの合計として残す');

-- ========== 移行完了にした表へ、スプシから取り込む ==========
update fourdb.source_sheet set migration_status = 'migrated', migrated_at = now() where id = '60000000-0000-0000-0000-0000000000a5';
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, origin) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 900003, 9002, 'raw', 'x', 'import')$$,
  '移行完了した表には、スプシから取り込みません', '移行完了した表へスプシから取り込む');
select pg_temp.expect_error_exact($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, formula, origin, recorded_by) values
  ('00000000-0000-0000-0000-0000000000a5', '60000000-0000-0000-0000-0000000000a5', 920001, 9001, 'calculated', 1, '=1', 'manual', 'check')$$,
  '行 920001・列 9001: 計算された値は直せません', '移行完了した表で、計算された値を 4D Base で直す');
reset role;
select pg_temp.ok(true, 'ここまで(ほかの決まりは 0001_core.check.sql)');

rollback;
