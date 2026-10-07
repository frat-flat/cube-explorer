-- 規模の確認(D-006: 数十万行以上)。使い捨てのデータベースで、0001_core.sql のあとに superuser で流す。架空のデータを入れる(本番には流さない)。
-- 法人 500 × 店舗 16 = 8,000 店舗、月 36(2024-01〜2026-12)、数値の項目 10 → 行 288,000・値 2,880,000。
-- 法人ごとに1枚のタブ(500 枚)。列は 店舗・月(軸)と、数値の項目 10 列。
-- 測る側(scale_queries.sql)は、入れ物の実行用の役割 fourdb_scale_app で、行ごとの権限がかかった状態で測る。

\set ws '''f0000000-0000-0000-0000-000000000001''::uuid'
\set shop '''f1000000-0000-0000-0000-000000000001''::uuid'
\set month '''f1000000-0000-0000-0000-000000000002''::uuid'
\timing on
select setseed(0.42);

begin;
insert into fourdb.workspace (id, name) values (:ws, 'scale');
insert into fourdb.dimension (id, workspace_id, name, semantic_type, levels) values
  (:shop, :ws, '店舗', 'entity', '{法人,店舗}'),
  (:month, :ws, '月', 'time', '{年,四半期,月}');

-- 法人(段 0)と店舗(段 1)
insert into fourdb.dimension_member (workspace_id, dimension_id, name, sort_order)
select :ws, :shop, '法人' || lpad(g::text, 4, '0'), g from generate_series(1, 500) g;
insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, sort_order)
select :ws, :shop, c.id, c.name || '-店' || s, s
  from fourdb.dimension_member c cross join generate_series(1, 16) s
 where c.dimension_id = :shop and c.parent_id is null;

-- 年(段 0)・四半期(段 1)・月(段 2)
insert into fourdb.dimension_member (workspace_id, dimension_id, name, period_start, period_end)
select :ws, :month, y::text, make_date(y, 1, 1), make_date(y + 1, 1, 1) from generate_series(2024, 2026) y;
insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
select :ws, :month, y.id, y.name || '-Q' || q, make_date(y.name::int, q * 3 - 2, 1), (make_date(y.name::int, q * 3 - 2, 1) + interval '3 months')::date
  from fourdb.dimension_member y cross join generate_series(1, 4) q
 where y.dimension_id = :month and y.level = 0;
insert into fourdb.dimension_member (workspace_id, dimension_id, parent_id, name, period_start, period_end)
select :ws, :month, q.id, to_char(q.period_start + make_interval(months => m), 'YYYY-MM'),
       (q.period_start + make_interval(months => m))::date, (q.period_start + make_interval(months => m + 1))::date
  from fourdb.dimension_member q cross join generate_series(0, 2) m
 where q.dimension_id = :month and q.level = 1;

-- Column Registry: 数値の項目 10 個と、軸のカラム 2 個
insert into fourdb.column_definition (workspace_id, name, kind, data_type)
select :ws, '項目' || lpad(g::text, 2, '0'), 'measure', 'money' from generate_series(1, 10) g;
insert into fourdb.column_definition (workspace_id, name, kind, dimension_id) values
  (:ws, '店舗', 'dimension', :shop),
  (:ws, '月', 'dimension', :month);

-- スプシ1つ、法人ごとにタブ1枚
insert into fourdb.source_container (id, workspace_id, provider, external_id, title) values
  ('f2000000-0000-0000-0000-000000000001', :ws, 'google_sheets', 'scale-book', '規模の確認');
insert into fourdb.source_sheet (workspace_id, container_id, external_id, title, header_row)
select :ws, 'f2000000-0000-0000-0000-000000000001', 'gid-' || c.sort_order, c.name, 0
  from fourdb.dimension_member c where c.dimension_id = :shop and c.level = 0;

-- 列: A 店舗・B 月(軸)、C〜L 項目01〜10
insert into fourdb.source_column (workspace_id, sheet_id, col_index, header, role, column_definition_id)
select :ws, s.id, 0, '店舗', 'dimension', (select id from fourdb.column_definition where workspace_id = :ws and name = '店舗') from fourdb.source_sheet s where s.workspace_id = :ws
union all
select :ws, s.id, 1, '月', 'dimension', (select id from fourdb.column_definition where workspace_id = :ws and name = '月') from fourdb.source_sheet s where s.workspace_id = :ws
union all
select :ws, s.id, 1 + d.n, d.name, 'measure', d.id
  from fourdb.source_sheet s
  cross join (select id, name, row_number() over (order by name)::int as n from fourdb.column_definition where workspace_id = :ws and kind = 'measure') d
 where s.workspace_id = :ws;

-- 行: 店舗 × 月。row_key に軸の値の id を入れておき、そこから行の軸の値の組を作る
insert into fourdb.record (workspace_id, sheet_id, row_key, row_index)
select :ws, s.id, shop.id || '|' || mon.id,
       row_number() over (partition by s.id order by shop.sort_order, mon.period_start)::int
  from fourdb.source_sheet s
  join fourdb.dimension_member corp on corp.dimension_id = :shop and corp.level = 0 and corp.name = s.title
  join fourdb.dimension_member shop on shop.parent_id = corp.id
  cross join (select * from fourdb.dimension_member where dimension_id = :month and level = 2) mon
 where s.workspace_id = :ws;
insert into fourdb.record_coord (workspace_id, record_id, dimension_id, member_id)
select :ws, r.id, :shop, split_part(r.row_key, '|', 1)::uuid from fourdb.record r where r.workspace_id = :ws
union all
select :ws, r.id, :month, split_part(r.row_key, '|', 2)::uuid from fourdb.record r where r.workspace_id = :ws;

-- 値: 行 × 数値の列(取り込みの決まりの確かめ = トリガーも動く)
insert into fourdb.value (workspace_id, sheet_id, record_id, column_id, kind, num, origin)
select :ws, r.sheet_id, r.id, c.id, 'raw', round((random() * 1000000)::numeric, 0), 'import'
  from fourdb.record r
  join fourdb.source_column c on c.sheet_id = r.sheet_id and c.role = 'measure'
 where r.workspace_id = :ws;
commit;

analyze;

-- 入れ物の実行用の役割(持ち主でも superuser でもない)。測る側はこの役割で、行ごとの権限がかかった状態で測る
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fourdb_scale_app') then create role fourdb_scale_app login; end if;
end $$;
grant usage on schema fourdb to fourdb_scale_app;
grant select, insert, update, delete on all tables in schema fourdb to fourdb_scale_app;
grant execute on all functions in schema fourdb to fourdb_scale_app;

\timing off
select 'records' as what, count(*) from fourdb.record where workspace_id = :ws
union all select 'record_coords', count(*) from fourdb.record_coord where workspace_id = :ws
union all select 'values', count(*) from fourdb.value where workspace_id = :ws;

select c.relname as "表", pg_size_pretty(pg_relation_size(c.oid)) as "表だけ", pg_size_pretty(pg_indexes_size(c.oid)) as "索引", pg_size_pretty(pg_total_relation_size(c.oid)) as "合計"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'fourdb' and c.relkind = 'r' and pg_total_relation_size(c.oid) > 1000000
 order by pg_total_relation_size(c.oid) desc;
select pg_size_pretty(sum(pg_total_relation_size(c.oid))) as "fourdb 全体"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fourdb' and c.relkind = 'r';
