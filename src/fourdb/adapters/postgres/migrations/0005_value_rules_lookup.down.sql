-- 0005_value_rules_lookup.sql を元に戻す(value_rules を 0001、source_total_rules を 0002 の形に戻し、行の sheet_id の索引 record_sheet を作り直す)。データは変わらない。
-- 索引を作る間は record への書き込みが待たされる(行の数に比例。取り込みをしていない時間に流す)。
-- 流したあとは fourdb_migrations.applied から '0005_value_rules_lookup.sql' の行を消す(消さないと、次の migrate で 0005 が流れない)。
begin;
set local lock_timeout = '5s';   -- 索引を作り直す間 record への書き込みを止めるので、待ちが 5 秒を超えたら止める(取り込みをしていない時間に流し直す)

create or replace function fourdb.value_rules() returns trigger language plpgsql set search_path = '' as $$
declare bad text;
begin
  select pg_catalog.format('行 %s・列 %s: %s', n.record_id, n.column_id,
           case
             when r.kind <> 'data' then '合計・小計の行には値を入れません'
             when c.role not in ('measure', 'attribute') then '数値か属性の列にだけ値を入れます(この列は ' || c.role || ')'
             when c.system_to is not null or r.system_to is not null then '閉じた行・列には値を入れません'
             when c.role = 'measure' and n.num is null then '数値の列には数値を入れます'
             when c.role = 'measure' and (n.valid_from is not null or n.valid_to is not null) then '数値の値には期間を付けません(時間は軸で表します)'
             when n.origin = 'manual' and s.migration_status <> 'migrated' then '移行中の表は 4D Base で直せません(スプシで直して読み直してください)'
             when n.origin = 'manual' and n.kind <> 'raw' then '計算された値は直せません'
             when n.origin = 'import' and s.migration_status <> 'migrating' then '移行完了した表には、スプシから取り込みません'
           end)
    into bad
    from new_rows n
    join fourdb.record r on r.id = n.record_id
    join fourdb.source_column c on c.id = n.column_id
    join fourdb.source_sheet s on s.id = n.sheet_id
   where n.system_to is null
     and (r.kind <> 'data'
       or c.role not in ('measure', 'attribute')
       or c.system_to is not null or r.system_to is not null
       or (c.role = 'measure' and (n.num is null or n.valid_from is not null or n.valid_to is not null))
       or (n.origin = 'manual' and (s.migration_status <> 'migrated' or n.kind <> 'raw'))
       or (n.origin = 'import' and s.migration_status <> 'migrating'))
   limit 1;
  if bad is not null then
    raise exception '%', bad;
  end if;

  -- 属性の期間の重なり(今の版どうし)。同じ workspace の属性の書き込みは順番に行う
  if exists (select 1 from new_rows n where n.system_to is null and (n.valid_from is not null or n.valid_to is not null)) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fourdb.value:' || n.workspace_id::text, 0))
       from (select distinct workspace_id from new_rows) n;
  end if;
  select pg_catalog.format('行 %s・列 %s: 期間が重なる今の値がすでにあります', n.record_id, n.column_id) into bad
    from new_rows n
    join fourdb.value o on o.record_id = n.record_id and o.column_id = n.column_id and o.id <> n.id and o.system_to is null
   where n.system_to is null
     and pg_catalog.daterange(n.valid_from, n.valid_to) operator(pg_catalog.&&) pg_catalog.daterange(o.valid_from, o.valid_to)
   limit 1;
  if bad is not null then
    raise exception '%', bad;
  end if;
  return null;
end $$;
revoke all on function fourdb.value_rules() from public;

create or replace function fourdb.source_total_rules() returns trigger language plpgsql set search_path = '' as $$
declare bad text;
begin
  select pg_catalog.format('行 %s・列 %s: 合計の行か合計の列のセルだけを残します', n.record_id, n.column_id) into bad
    from new_rows n
    join fourdb.record r on r.id = n.record_id
    join fourdb.source_column c on c.id = n.column_id
   where n.system_to is null and r.kind <> 'aggregate' and c.role <> 'aggregate'
   limit 1;
  if bad is not null then
    raise exception '%', bad;
  end if;
  return null;
end $$;
revoke all on function fourdb.source_total_rules() from public;

create index if not exists record_sheet on fourdb.record (sheet_id);

commit;
