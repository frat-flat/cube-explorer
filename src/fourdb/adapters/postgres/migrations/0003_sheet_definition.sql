-- 表の定義(② 14章 SheetDefinition)。データはコピーせず、行・列・数値・絞り・合計のしかただけを持つ。
-- 保存するたびに version を上げ、前の定義は history に残す(② 26章)。元に戻すときは 0003_sheet_definition.down.sql。
begin;

create table fourdb.sheet_definition (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  -- { sources, rows, columns, measures, filters, subtotal_rules, grand_total_rules, sort_rules, format_rules }
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text,
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index sheet_definition_name on fourdb.sheet_definition (workspace_id, name) where deleted_at is null;

alter table fourdb.sheet_definition enable row level security;
alter table fourdb.sheet_definition force row level security;
create policy workspace_scope on fourdb.sheet_definition
  using (workspace_id = (select fourdb.current_workspace_id()))
  with check (workspace_id = (select fourdb.current_workspace_id()));
revoke all on fourdb.sheet_definition from public;

commit;
