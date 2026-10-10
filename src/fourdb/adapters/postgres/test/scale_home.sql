-- ホーム(D-017)と Task の規模の確認。使い捨てのデータベースで、test/scale.sql のあとに superuser で流す(本番には流さない)。
--   psql -v ON_ERROR_STOP=1 -v variant=V1 -f test/scale_home.sql   (V1: 法人 500 がいちばん上、店舗 8,000 はその中)
--   psql -v ON_ERROR_STOP=1 -v variant=V2 -f test/scale_home.sql   (V2: 店舗の親を外し、8,500 がいちばん上)
-- 1 回目はデータを足し(数十秒〜数分)、2 回目からは V1・V2 の切り替え(店舗の親の付け直し)だけをする。何度流しても同じ形になる。
-- 測る側は home.scale.test.ts(実行用の役割 fourdb_scale_app で、行ごとの権限がかかった状態で測る)。
--
-- 足すもの(すべて架空。workspace は scale.sql と同じ f0000000-…-0001):
--   Box      法人 500(軸「店舗」の段 0 の値に結ぶ)・店舗 8,000(段 1 の値に結ぶ。V1 では法人の中)
--   行の Box  scale.sql の行 288,000 を、その行の店舗の Box に結ぶ(record.box_id)
--   列       scale.sql の 500 枚に「項目11」(計算された値 ƒ。288,000 個)と「課税区分」(属性。値なし)を足す
--   予算     別のファイル「予算」に法人ごとのシート 500 枚。行 = 店舗 16、列 = 2026 年の月 12(列に月 = column_coord)、値 96,000 個。
--            シート全体の軸の値(sheet_coord)に、法人(店舗の軸)と 2026 年(月の軸)を付ける
--   取り込み  シート 1,000 枚のうち 900 枚に、取り込みの記録を 13 回ずつ(最後の 1 回は 承認待ち・読み取り中・反映中・失敗・取り消し・反映済みに散らす)。
--            100 枚は取り込みなし。移行完了 200 枚、消したシート 10 枚
--   表の定義  60(行 = 店舗、列 = 月。シートを指すものと指さないもの)
-- 計算された値の索引(0007)は、このファイルでは作らない(あり・なしの両方を測るため。0007 を流す・外すのは別に行う)。

\set ws '''f0000000-0000-0000-0000-000000000001''::uuid'
\set shop '''f1000000-0000-0000-0000-000000000001''::uuid'
\set month '''f1000000-0000-0000-0000-000000000002''::uuid'
\set book '''f2000000-0000-0000-0000-000000000001''::uuid'
\set budget '''f2000000-0000-0000-0000-000000000002''::uuid'
\set ON_ERROR_STOP 1
\timing on

-- 使い捨ての試験用データベースで、scale.sql を流したあとでなければ、何もせずに止める
do $$
begin
  if not (pg_catalog.current_database() like 'fourdb\_it%' or pg_catalog.current_database() ~ '(test|check|perf)') then
    raise exception 'NG: 使い捨ての試験用データベースではないので流しません(名前が fourdb_it… か test・check・perf を含むときだけ)';
  end if;
  if not exists (select 1 from fourdb.workspace where id = 'f0000000-0000-0000-0000-000000000001') then
    raise exception 'NG: 先に test/scale.sql を流してください';
  end if;
end $$;
select (:'variant' in ('V1', 'V2')) as variant_ok, (:'variant' = 'V2') as v2 \gset
\if :variant_ok
\else
  \echo 'NG: -v variant=V1 か -v variant=V2 を付けてください'
  \quit
\endif
select not exists (select 1 from fourdb.box where workspace_id = :ws) as build \gset
select setseed(0.17);

\if :build
begin;
-- ---------- Box(法人・店舗)と軸の値・行への結び ----------
insert into fourdb.box (workspace_id, type, unit_type, name)
select :ws, 'entity', '法人', m.name from fourdb.dimension_member m where m.dimension_id = :shop and m.level = 0;
update fourdb.dimension_member m set box_id = b.id
  from fourdb.box b
 where m.dimension_id = :shop and m.level = 0 and b.workspace_id = :ws and b.unit_type = '法人' and b.name = m.name;
insert into fourdb.box (workspace_id, parent_id, type, unit_type, name)
select :ws, corp.box_id, 'entity', '店舗', s.name
  from fourdb.dimension_member s join fourdb.dimension_member corp on corp.id = s.parent_id
 where s.dimension_id = :shop and s.level = 1;
update fourdb.dimension_member s set box_id = b.id
  from fourdb.box b
 where s.dimension_id = :shop and s.level = 1 and b.workspace_id = :ws and b.unit_type = '店舗' and b.name = s.name;
update fourdb.record r set box_id = m.box_id
  from fourdb.record_coord rc join fourdb.dimension_member m on m.id = rc.member_id
 where rc.record_id = r.id and rc.dimension_id = :shop and r.workspace_id = :ws;

-- ---------- 計算された値の列(ƒ)と属性の列(scale.sql の 500 枚) ----------
insert into fourdb.column_definition (workspace_id, name, kind, data_type) values
  (:ws, '項目11', 'measure', 'money'),
  (:ws, '課税区分', 'attribute', 'text'),
  (:ws, '予算', 'measure', 'money');
insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id)
select :ws, s.id, 12, '項目11', 'measure', (select id from fourdb.column_definition where workspace_id = :ws and name = '項目11')
  from fourdb.source_sheet s where s.workspace_id = :ws and s.container_id = :book
union all
select :ws, s.id, 13, '課税区分', 'attribute', (select id from fourdb.column_definition where workspace_id = :ws and name = '課税区分')
  from fourdb.source_sheet s where s.workspace_id = :ws and s.container_id = :book;
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, formula, origin)
select :ws, r.sheet_id, r.id, c.id, 'calculated', round((random() * 1000000)::numeric, 0),
       '=SUM(C' || (r.row_index + 1) || ':L' || (r.row_index + 1) || ')', 'import'
  from fourdb.record r
  join fourdb.source_column c on c.sheet_id = r.sheet_id and c.col_index = 12 and c.system_to is null
 where r.workspace_id = :ws;

-- ---------- 予算(列に月があるシート)500 枚 ----------
insert into fourdb.source_container (id, workspace_id, provider, external_id, title) values (:budget, :ws, 'google_sheets', 'scale-budget', '予算');
insert into fourdb.source_sheet (workspace_id, container_id, external_id, title, header_row)
select :ws, :budget, 'gid-b' || c.sort_order, '予算 ' || c.name, 0
  from fourdb.dimension_member c where c.dimension_id = :shop and c.level = 0;
insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id)
select :ws, s.id, 0, '店舗', 'dimension', (select id from fourdb.column_definition where workspace_id = :ws and name = '店舗')
  from fourdb.source_sheet s where s.workspace_id = :ws and s.container_id = :budget
union all
select :ws, s.id, mo.n, mo.name, 'measure', (select id from fourdb.column_definition where workspace_id = :ws and name = '予算')
  from fourdb.source_sheet s
  cross join (select row_number() over (order by period_start)::int as n, name from fourdb.dimension_member
               where dimension_id = :month and level = 2 and period_start >= '2026-01-01') mo
 where s.workspace_id = :ws and s.container_id = :budget;
insert into fourdb.column_coord (workspace_id, column_id, dimension_id, member_id)
select :ws, c.id, :month, m.id
  from fourdb.source_column c
  join fourdb.source_sheet s on s.id = c.sheet_id and s.container_id = :budget
  join fourdb.dimension_member m on m.dimension_id = :month and m.level = 2 and m.name = c.header
 where c.workspace_id = :ws and c.role = 'measure';
insert into fourdb.sheet_coord (workspace_id, sheet_id, dimension_id, member_id)
select :ws, s.id, :shop, corp.id
  from fourdb.source_sheet s join fourdb.dimension_member corp on corp.dimension_id = :shop and corp.level = 0 and s.title = '予算 ' || corp.name
 where s.container_id = :budget
union all
select :ws, s.id, :month, y.id
  from fourdb.source_sheet s join fourdb.dimension_member y on y.dimension_id = :month and y.level = 0 and y.name = '2026'
 where s.container_id = :budget;
insert into fourdb.record (workspace_id, sheet_id, row_key, row_index, box_id)
select :ws, s.id, shop.id::text, shop.sort_order, shop.box_id
  from fourdb.source_sheet s
  join fourdb.dimension_member corp on corp.dimension_id = :shop and corp.level = 0 and s.title = '予算 ' || corp.name
  join fourdb.dimension_member shop on shop.parent_id = corp.id
 where s.container_id = :budget;
insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id)
select :ws, r.id, :shop, r.row_key::uuid
  from fourdb.record r join fourdb.source_sheet s on s.id = r.sheet_id and s.container_id = :budget;
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin)
select :ws, r.sheet_id, r.id, c.id, 'raw', round((random() * 100000)::numeric, 0), 'import'
  from fourdb.record r
  join fourdb.source_sheet s on s.id = r.sheet_id and s.container_id = :budget
  join fourdb.source_column c on c.sheet_id = r.sheet_id and c.role = 'measure';

-- ---------- 取り込みの記録・移行の状態・消したシート ----------
create temporary table scale_sheets on commit drop as
select s.id, row_number() over (order by s.container_id, s.title)::int as g from fourdb.source_sheet s where s.workspace_id = :ws;
-- 900 枚に、前の取り込み(反映済み・ときどき失敗・取り消し)12 回
insert into fourdb.import_run (workspace_id, sheet_id, status, started_by, started_at, finished_at, rows_read)
select :ws, x.id, case when k % 7 = 0 then 'failed' when k % 11 = 0 then 'cancelled' else 'applied' end, 'scale:owner',
       now() - make_interval(days => 400 - k * 30, hours => x.g % 24), now() - make_interval(days => 400 - k * 30, hours => x.g % 24) + interval '2 minutes', 576
  from scale_sheets x cross join generate_series(1, 12) k
 where x.g <= 900;
-- 最後の 1 回(同じシートの取り込み中は 1 つだけ。import_run_active)
insert into fourdb.import_run (workspace_id, sheet_id, status, started_by, started_at, finished_at, rows_read)
select :ws, x.id, st.status, 'scale:owner', now() - make_interval(hours => 1 + x.g % 48),
       case when st.status in ('reading', 'staged', 'applying') then null else now() - make_interval(hours => 1 + x.g % 48) + interval '2 minutes' end, 576
  from scale_sheets x
  cross join lateral (select case when x.g % 20 = 0 then 'staged' when x.g % 50 = 1 then 'reading' when x.g % 100 = 2 then 'applying'
                                  when x.g % 25 = 3 then 'failed' when x.g % 40 = 4 then 'cancelled' else 'applied' end as status) st
 where x.g <= 900;
update fourdb.source_sheet s set last_read_at = r.at
  from (select sheet_id, max(finished_at) as at from fourdb.import_run where workspace_id = :ws and status = 'applied' group by sheet_id) r
 where r.sheet_id = s.id;
update fourdb.source_sheet s set migration_status = 'migrated', migrated_at = now(), migrated_by = 'scale:owner'
  from scale_sheets x where x.id = s.id and x.g % 5 = 0 and x.g <= 900 and x.g % 20 <> 0;
update fourdb.source_sheet s set deleted_at = now()
  from scale_sheets x where x.id = s.id and x.g % 97 = 0;

-- ---------- 表の定義 60 ----------
insert into fourdb.sheet_definition (workspace_id, name, definition, created_by, updated_by, updated_at)
select :ws, '規模の表 ' || lpad(g::text, 2, '0'),
       jsonb_build_object(
         'sources', case when g % 3 = 0 then (select jsonb_agg(x.id) from scale_sheets x where x.g between g * 10 and g * 10 + 4) else 'null'::jsonb end,
         'rows', jsonb_build_object('dimensionId', 'f1000000-0000-0000-0000-000000000001', 'level', g % 2),
         'columns', jsonb_build_object('dimensionId', 'f1000000-0000-0000-0000-000000000002', 'level', g % 3),
         'measures', jsonb_build_array(jsonb_build_object('measureId', (select id from fourdb.column_definition where workspace_id = :ws and name = '項目' || lpad((1 + g % 10)::text, 2, '0')), 'fn', 'SUM')),
         'filters', '[]'::jsonb, 'subtotal_rules', jsonb_build_object('rows', null), 'grand_total_rules', jsonb_build_object('rows', true, 'columns', true),
         'sort_rules', '[]'::jsonb, 'format_rules', '{}'::jsonb),
       'scale:owner', 'scale:owner', now() - make_interval(hours => g)
  from generate_series(1, 60) g;
commit;
\endif

-- ---------- V1・V2 の切り替え(店舗の親) ----------
\if :v2
update fourdb.box set parent_id = null where workspace_id = :ws and unit_type = '店舗' and parent_id is not null;
\else
update fourdb.box b set parent_id = corp.box_id
  from fourdb.dimension_member s join fourdb.dimension_member corp on corp.id = s.parent_id
 where s.box_id = b.id and b.workspace_id = :ws and b.unit_type = '店舗' and b.parent_id is distinct from corp.box_id;
\endif

analyze;

\timing off
select :'variant' as "形",
       (select count(*) from fourdb.box where workspace_id = :ws and parent_id is null) as "いちばん上の Box",
       (select count(*) from fourdb.box where workspace_id = :ws) as "Box",
       (select count(*) from fourdb.record where workspace_id = :ws and box_id is not null) as "Box に結んだ行",
       (select count(*) from fourdb.value where workspace_id = :ws) as "値",
       (select count(*) from fourdb.value where workspace_id = :ws and kind = 'calculated' and system_to is null) as "計算された値",
       (select count(*) from fourdb.source_sheet where workspace_id = :ws and deleted_at is null) as "シート",
       (select count(*) from fourdb.import_run where workspace_id = :ws) as "取り込みの記録",
       (select count(*) from fourdb.sheet_definition where workspace_id = :ws) as "表の定義",
       pg_catalog.to_regclass('fourdb.value_calculated') is not null as "0007 の索引";
