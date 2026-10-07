-- スプシに書かれていた合計の数字(DATA_MODEL.md 3.3)。値(value)にはしない。
-- 4D Base で計算した合計と見比べる(照合・Cell Inspector)ためだけに残す。元に戻すときは 0002_source_total.down.sql。
begin;

create table fourdb.source_total (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  sheet_id uuid not null,
  record_id bigint not null,
  column_id bigint not null,
  num numeric,
  txt text,
  formula text,                       -- 元の関数(値で貼られていれば null)
  system_from timestamptz not null default clock_timestamp(),
  system_to timestamptz,
  foreign key (workspace_id, sheet_id, record_id) references fourdb.record (workspace_id, sheet_id, id) on delete cascade,
  foreign key (workspace_id, sheet_id, column_id) references fourdb.source_column (workspace_id, sheet_id, id) on delete cascade,
  check (num_nonnulls(num, txt) >= 1),
  check (system_to is null or system_from < system_to)
);
create unique index source_total_current on fourdb.source_total (record_id, column_id) where system_to is null;
create index source_total_record on fourdb.source_total (record_id);
create index source_total_column on fourdb.source_total (column_id);

-- 入れてよいのは、合計の行のセルか、合計の列のセルだけ
create function fourdb.source_total_rules() returns trigger language plpgsql set search_path = '' as $$
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
create trigger source_total_rules after insert on fourdb.source_total
  referencing new table as new_rows
  for each statement execute function fourdb.source_total_rules();

alter table fourdb.source_total enable row level security;
alter table fourdb.source_total force row level security;
create policy workspace_scope on fourdb.source_total
  using (workspace_id = (select fourdb.current_workspace_id()))
  with check (workspace_id = (select fourdb.current_workspace_id()));

revoke all on fourdb.source_total from public;
revoke all on function fourdb.source_total_rules() from public;

commit;
