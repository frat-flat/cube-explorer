-- 0001_core.sql の決まりが守られるかを確かめる。使い捨てのデータベースで、superuser で流す。
-- 失敗したら例外で止まる。最後にすべて rollback するので、何も残らない(試験用の役割も残らない)。
-- 例: psql -v ON_ERROR_STOP=1 -f migrations/0001_core.sql -f test/0001_core.check.sql
-- 「OK」の行の数が最後に出る(すべて通れば NG は 0)。

begin;
set constraints all immediate;   -- あとで確かめる参照(deferrable)も、文ごとに確かめる(workspace を消す試験だけ戻す)

create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'OK (拒否): % — %', label, sqlerrm;
    return;
  end;
  raise exception 'NG: 通ってしまった: %', label;
end $$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'NG: %', label; end if;
  raise notice 'OK: %', label;
end $$;

create function pg_temp.col(sheet uuid, idx int) returns bigint language sql as $$
  select id from fourdb.source_column where sheet_id = sheet and col_index = idx and system_to is null
$$;

-- ========== 準備: workspace A・B ==========
insert into fourdb.workspace (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'B');

insert into fourdb.dimension (id, workspace_id, name, semantic_type, levels) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '月', 'time', '{年,四半期,月}'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '店舗', 'entity', '{法人,店舗}'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000b', '月', 'time', '{月}');

-- 段(level)はわざと 0 で入れる(トリガーが親から決める)
insert into fourdb.dimension_member (id, workspace_id, dimension_id, parent_id, level, name, period_start, period_end) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', null, 0, '2026', '2026-01-01', '2027-01-01');
insert into fourdb.dimension_member (id, workspace_id, dimension_id, parent_id, level, name, period_start, period_end) values
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 0, '2026-Q1', '2026-01-01', '2026-04-01');
insert into fourdb.dimension_member (id, workspace_id, dimension_id, parent_id, level, name, period_start, period_end) values
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 0, '2026-01', '2026-01-01', '2026-02-01'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 0, '2026-02', '2026-02-01', '2026-03-01');
insert into fourdb.dimension_member (id, workspace_id, dimension_id, name) values
  ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'A社');
insert into fourdb.dimension_member (id, workspace_id, dimension_id, parent_id, name) values
  ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', 'A社 楽天店');
insert into fourdb.dimension_member (id, workspace_id, dimension_id, name) values
  ('20000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000009', 'B の 2026-01');

-- ========== 軸の値 ==========
select pg_temp.ok((select string_agg(depth::text, ',' order by depth) from fourdb.member_ancestor where member_id = '20000000-0000-0000-0000-000000000003') = '0,1,2', '月の祖先(自分・四半期・年)が入る');
select pg_temp.ok((select level from fourdb.dimension_member where id = '20000000-0000-0000-0000-000000000003') = 2, '段は親から決まる(0 で入れても 2 になる)');
select pg_temp.expect_error($$insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'x')$$, '店舗の親に月の値(2026)を指定する');
select pg_temp.expect_error($$insert into fourdb.dimension_member (id, workspace_id, dimension_id, parent_id, name) values
  ('20000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000c1', '子'),
  ('20000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', null, '親')$$, '同じ文で子を親より先に入れる');
select pg_temp.expect_error($$insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '2026-01-01')$$, '軸の段の数(年・四半期・月)を超える');
select pg_temp.expect_error($$update fourdb.dimension_member set parent_id = null where id = '20000000-0000-0000-0000-000000000003'$$, '軸の値の親の付け替え');
select pg_temp.expect_error($$update fourdb.dimension_member set dimension_id = '10000000-0000-0000-0000-000000000001' where id = '20000000-0000-0000-0000-000000000011'$$, '軸の値の所属(軸)の書き換え');
select pg_temp.expect_error($$insert into fourdb.dimension_member (workspace_id, dimension_id, name) values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'x')$$, '別の workspace の軸に値を作る');
select pg_temp.expect_error($$insert into fourdb.dimension_member (workspace_id, dimension_id, name, period_start, period_end) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'bad', '2026-02-01', '2026-01-01')$$, '期間の終わりが始まりより前');
update fourdb.dimension_member set name = 'A社(株)' where id = '20000000-0000-0000-0000-000000000011';
select pg_temp.ok(true, '軸の値の名前は直せる');

-- ========== Box ==========
insert into fourdb.box (id, workspace_id, type, unit_type, name) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'entity', '法人', 'A社');
insert into fourdb.box (id, workspace_id, parent_id, type, unit_type, name) values
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'entity', '店舗', 'A社 楽天店');
insert into fourdb.box (id, workspace_id, parent_id, type, name) values
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', 'group', '楽天店の中のグループ');
select pg_temp.ok((select string_agg(depth::text, ',' order by depth) from fourdb.box_tree where workspace_id = '00000000-0000-0000-0000-00000000000a') = '0,1,2', 'Box の深さ(0・1・2)が数えられる');
select pg_temp.expect_error($$update fourdb.box set parent_id = '30000000-0000-0000-0000-000000000003' where id = '30000000-0000-0000-0000-000000000001'$$, 'Box を自分の孫の下へ移す(輪になる)');
select pg_temp.expect_error($$insert into fourdb.box (workspace_id, parent_id, type, name) values ('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', 'entity', 'x')$$, '別の workspace の Box の中に Box を作る');

-- ========== Column Registry ==========
insert into fourdb.column_definition (id, workspace_id, name, kind, dimension_id) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '月', 'dimension', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '店舗', 'dimension', '10000000-0000-0000-0000-000000000002');
insert into fourdb.column_definition (id, workspace_id, name, kind, data_type) values
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '売上', 'measure', 'money'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '課税区分', 'attribute', 'text');
select pg_temp.expect_error($$insert into fourdb.column_definition (workspace_id, name, kind) values ('00000000-0000-0000-0000-00000000000a', '軸なし', 'dimension')$$, '分類(dimension)のカラムなのに軸がない');

-- ========== 元: スプシ › タブ ==========
insert into fourdb.source_container (id, workspace_id, provider, external_id, title) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'google_sheets', 'book-1', '売上管理');
insert into fourdb.source_container (workspace_id, provider, title) values
  ('00000000-0000-0000-0000-00000000000a', 'paste', '貼り付け1'),
  ('00000000-0000-0000-0000-00000000000a', 'paste', '貼り付け2');
select pg_temp.ok(true, '貼り付けの元を2つ作れる');
insert into fourdb.source_sheet (id, workspace_id, container_id, external_id, title, box_id) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'gid-1', '2026', '30000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'gid-2', '別のタブ', null);
select pg_temp.expect_error($$insert into fourdb.source_sheet (workspace_id, container_id, external_id, title) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'gid-1', '同じタブ')$$, '同じタブを2枚目として登録する');
select pg_temp.expect_error($$update fourdb.source_sheet set migration_status = 'migrated' where id = '60000000-0000-0000-0000-000000000001'$$, '日時なしで移行完了にする');
select pg_temp.expect_error($$insert into fourdb.source_sheet (workspace_id, container_id, title) values ('00000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', 'x')$$, '別の workspace のスプシにタブを作る');

-- 列: A 店舗(軸)・B 1月・C 2月(売上。列ごとに月)・D 年合計(合計の列)・E 課税区分(属性)・F メモ(使わない)
insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id, aggregate_function) values
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 0, '店舗', 'dimension', '40000000-0000-0000-0000-000000000004', null),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, '1月', 'measure', '40000000-0000-0000-0000-000000000002', null),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 2, '2月', 'measure', '40000000-0000-0000-0000-000000000002', null),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 3, '年合計', 'aggregate', '40000000-0000-0000-0000-000000000002', 'SUM'),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 4, '課税区分', 'attribute', '40000000-0000-0000-0000-000000000003', null),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 5, 'メモ', 'ignore', null, null),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 0, '売上', 'measure', '40000000-0000-0000-0000-000000000002', null);
insert into fourdb.column_coord (workspace_id, column_id, dimension_id, member_id) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.col('60000000-0000-0000-0000-000000000001', 1), '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-00000000000a', pg_temp.col('60000000-0000-0000-0000-000000000001', 2), '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004');

select pg_temp.expect_error($$insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 9, '合計?', 'aggregate')$$, '合計の列なのに関数がない');
select pg_temp.expect_error($$insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 9, '売上?', 'measure')$$, '数値の列なのに意味(カラム)がない');
select pg_temp.expect_error($$insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 9, '売上?', 'measure', '40000000-0000-0000-0000-000000000003')$$, '数値の列が属性のカラムを指す');
select pg_temp.expect_error($$insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 9, 'x', 'ignore', '40000000-0000-0000-0000-000000000002')$$, '使わない列がカラムを指す');
select pg_temp.expect_error($$insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, '重複', 'ignore')$$, '同じ位置に今の列が2つ');

-- 行: 1 データ(A社 楽天店)・2 合計の行・3 別のタブの行
insert into fourdb.record (id, workspace_id, sheet_id, row_key, row_index, kind, box_id) overriding system value values
  (1, '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 'A社 楽天店', 1, 'data', '30000000-0000-0000-0000-000000000002'),
  (2, '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', '合計', 2, 'aggregate', null),
  (3, '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', '1', 1, 'data', null);
insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id) values
  ('00000000-0000-0000-0000-00000000000a', 1, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000012');

-- ========== 軸の値の組 ==========
select pg_temp.expect_error($$insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id) values ('00000000-0000-0000-0000-00000000000a', 3, '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000091')$$, '行の軸の値に、別の workspace の値を入れる');
select pg_temp.expect_error($$insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id) values ('00000000-0000-0000-0000-00000000000a', 3, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003')$$, '店舗の軸に月の値を入れる');
select pg_temp.expect_error($$delete from fourdb.dimension_member where id = '20000000-0000-0000-0000-000000000012'$$, '行が使っている軸の値を消す');

-- ========== 値 ==========
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 1), 'raw', 100, 'import'),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 2), 'raw', 200, 'import');
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, valid_to, origin) values
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 4), 'raw', '免税事業者', '2023-04-01', '2025-04-01', 'import'),
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 4), 'raw', '課税事業者', '2025-04-01', null, 'import');
select pg_temp.ok(true, '数値の値と、期間つきの属性(重ならない2つ)を入れられる');

select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 1), 'raw', 999, 'import')$$, '同じセルに今の値が2つ');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 4), 'raw', '課税?', '2024-01-01', 'import')$$, '属性の期間が今の値と重なる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 1, 'import')$$, '行と列が別のタブ(行は別のタブ、sheet_id は今のタブ)');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 1, 'import')$$, '行と列が別のタブ(列は別のタブ)');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 2, pg_temp.col('60000000-0000-0000-0000-000000000001', 1), 'raw', 300, 'import')$$, '合計の行に値を入れる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 3), 'raw', 300, 'import')$$, '合計の列に値を入れる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 5), 'raw', 'メモ', 'import')$$, '使わない列に値を入れる');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, valid_from, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 1, '2026-01-01', 'import')$$, '数値の値に期間を付ける');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 1, 'manual')$$, '移行中の表を 4D Base で直す');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'calculated', 1, 'import')$$, '計算値なのに関数がない');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 'import')$$, '中身が空の値');
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin) values ('00000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-000000000002', 3, pg_temp.col('60000000-0000-0000-0000-000000000002', 0), 'raw', 1, 'import')$$, '別の workspace として行の値を入れる');
select pg_temp.expect_error($$update fourdb.value set num = 101 where record_id = 1 and column_id = pg_temp.col('60000000-0000-0000-0000-000000000001', 1)$$, '値の版を書き換える');

-- ========== 集計: 年でまとめると、合計の行・列を数えない ==========
create function pg_temp.year_total(y text) returns numeric language sql as $$
  select sum(v.num)
    from fourdb.value v
    join fourdb.record r on r.id = v.record_id and r.system_to is null and r.kind = 'data'
    join fourdb.source_column c on c.id = v.column_id and c.system_to is null and c.role = 'measure'
    left join fourdb.column_coord cc on cc.column_id = c.id and cc.dimension_id = '10000000-0000-0000-0000-000000000001'
    left join fourdb.record_coord rc on rc.record_id = r.id and rc.dimension_id = '10000000-0000-0000-0000-000000000001'
    left join fourdb.sheet_coord sc on sc.sheet_id = v.sheet_id and sc.dimension_id = '10000000-0000-0000-0000-000000000001'
    join fourdb.member_ancestor a on a.member_id = coalesce(cc.member_id, rc.member_id, sc.member_id)
    join fourdb.dimension_member ym on ym.id = a.ancestor_id and ym.level = 0
   where v.workspace_id = '00000000-0000-0000-0000-00000000000a' and v.system_to is null and v.kind = 'raw'
     and c.column_definition_id = '40000000-0000-0000-0000-000000000002' and ym.name = y
$$;
select pg_temp.ok(pg_temp.year_total('2026') = 300, '年(2026)でまとめた売上 = 300(合計の行・列は数えない)');

-- ========== 移行完了と、4D Base での修正(D-002) ==========
update fourdb.source_sheet set migration_status = 'migrated', migrated_at = now(), migrated_by = 'neon:owner' where id = '60000000-0000-0000-0000-000000000001';
-- 期間の重ならない属性のセルで試す(ほかの決まりに引っかからないように)
select pg_temp.expect_error($$insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, txt, valid_from, valid_to, origin) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 4), 'raw', '免税事業者', '2020-01-01', '2021-01-01', 'import')$$, '移行完了した表へスプシから取り込む');
-- 同じトランザクションで同じセルを2回直す(100 → 150 → 160)
update fourdb.value set system_to = clock_timestamp() where record_id = 1 and column_id = pg_temp.col('60000000-0000-0000-0000-000000000001', 1) and system_to is null;
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin, recorded_by) values
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 1), 'raw', 150, 'manual', 'neon:owner');
update fourdb.value set system_to = clock_timestamp() where record_id = 1 and column_id = pg_temp.col('60000000-0000-0000-0000-000000000001', 1) and system_to is null;
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin, recorded_by) values
  ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', 1, pg_temp.col('60000000-0000-0000-0000-000000000001', 1), 'raw', 160, 'manual', 'neon:owner');
select pg_temp.ok((select count(*) from fourdb.value where record_id = 1 and column_id = pg_temp.col('60000000-0000-0000-0000-000000000001', 1)) = 3
              and (select num from fourdb.value where record_id = 1 and column_id = pg_temp.col('60000000-0000-0000-0000-000000000001', 1) and system_to is null) = 160,
  '移行完了した表は 4D Base で直せ、版が3つ残り、今の値は1つ(同じトランザクションで2回直しても)');
select pg_temp.ok(pg_temp.year_total('2026') = 360, '直したあとの年の売上 = 360');

-- ========== 表の削除 ==========
select pg_temp.expect_error($$delete from fourdb.source_sheet where id = '60000000-0000-0000-0000-000000000001'$$, '移行完了した表を物理削除する');
select pg_temp.expect_error($$delete from fourdb.source_container where id = '50000000-0000-0000-0000-000000000001'$$, '移行完了した表を含むスプシを物理削除する');
update fourdb.source_sheet set deleted_at = now() where id = '60000000-0000-0000-0000-000000000002';
select pg_temp.ok(true, '表は deleted_at で隠せる');

-- ========== Card ==========
select pg_temp.ok((select count(*) from fourdb.card_attribute where box_id = '30000000-0000-0000-0000-000000000002'
                     and coalesce(valid_from, '-infinity') <= '2025-06-01' and coalesce(valid_to, 'infinity') > '2025-06-01') = 1
              and (select value from fourdb.card_attribute where box_id = '30000000-0000-0000-0000-000000000002' and valid_from = '2025-04-01') = '課税事業者',
  'Card: 2025-06-01 時点の課税区分は1つ(課税事業者)');

-- ========== 取り込み ==========
insert into fourdb.import_run (workspace_id, sheet_id, status) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 'reading');
select pg_temp.expect_error($$insert into fourdb.import_run (workspace_id, sheet_id, status) values ('00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000002', 'staged')$$, '同じ表の取り込みを同時に2つ');

-- ========== 権限(行ごとの権限・関数・ビュー) ==========
select pg_temp.ok((select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fourdb' and c.relkind = 'r'), 'すべての表で行ごとの権限が強制されている');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fourdb' and c.relkind = 'r'
                     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)) = 0, 'すべての表に workspace で絞る方針がある');
select pg_temp.ok((select bool_and(coalesce(c.reloptions @> '{security_invoker=true}', false)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fourdb' and c.relkind = 'v'), 'すべてのビューが呼んだ人の権限で動く');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'fourdb' and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) = 0, '関数を誰でも(PUBLIC)呼べる状態にない');

insert into fourdb.workspace_member (workspace_id, principal, role) values
  ('00000000-0000-0000-0000-00000000000a', 'neon:owner', 'owner'),
  ('00000000-0000-0000-0000-00000000000b', 'neon:other', 'owner');

-- 入れ物の実行用の役割を真似る(持ち主でも superuser でもない)
create role fourdb_check_app nologin;
grant usage on schema fourdb to fourdb_check_app;
grant select, insert, update, delete on all tables in schema fourdb to fourdb_check_app;
grant execute on all functions in schema fourdb to fourdb_check_app;
set local role fourdb_check_app;
select set_config('fourdb.workspace_id', '', true);
select pg_temp.ok((select count(*) from fourdb.dimension_member) = 0 and (select count(*) from fourdb.workspace) = 0, 'workspace を設定していなければ何も見えない');
select set_config('fourdb.workspace_id', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.ok((select count(*) from fourdb.dimension_member where workspace_id <> '00000000-0000-0000-0000-00000000000a') = 0
              and (select count(*) from fourdb.dimension_member) = 6, 'workspace A を設定すると A の軸の値だけが見える');
select pg_temp.ok((select count(*) from fourdb.card_attribute) = 2, 'ビュー(Card)も A の分だけ');
select pg_temp.expect_error($$insert into fourdb.history (workspace_id, kind, title) values ('00000000-0000-0000-0000-00000000000b', 'x', 'B へ書く')$$, 'A を設定したまま B の workspace に書く');
select set_config('fourdb.workspace_id', '', true);
select set_config('fourdb.principal', 'neon:owner', true);
select pg_temp.ok((select string_agg(workspace_id::text, ',') from fourdb.workspace_member) = '00000000-0000-0000-0000-00000000000a',
  'workspace を決める前でも、自分(principal)の所属だけは引ける');
reset role;

-- ========== workspace ごと消す(最後) ==========
set constraints all deferred;
delete from fourdb.workspace where id = '00000000-0000-0000-0000-00000000000a';
set constraints all immediate;   -- ここで後回しの参照をまとめて確かめる
select pg_temp.ok((select count(*) from fourdb.value) = 0 and (select count(*) from fourdb.source_column) = 0 and (select count(*) from fourdb.dimension_member where workspace_id = '00000000-0000-0000-0000-00000000000a') = 0,
  'workspace ごと消せる(移行完了の表・使われている定義を含めて中身もすべて)');
select pg_temp.ok((select count(*) from fourdb.dimension_member where workspace_id = '00000000-0000-0000-0000-00000000000b') = 1, '別の workspace(B)は残る');

rollback;
