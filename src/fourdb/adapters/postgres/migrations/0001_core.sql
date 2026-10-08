-- 4D Base の芯の表(Canonical Data Model)。設計は docs/4db/DATA_MODEL.md。元に戻すときは 0001_core.down.sql。
-- 素の PostgreSQL 15 以上で動くものだけを使う(拡張も、Neon・Supabase に固有の機能も使わない。D-004)。
-- 表はすべて名前空間 fourdb に置き、組み込み先のデータベースに同居してもぶつからないようにする。
--
-- 守り方の考え方:
-- - 「誰のデータか」は workspace。子は (workspace_id, 親の id) で親を指すので、別の workspace の行を指せない。
-- - 軸の値の組は表(sheet_coord・record_coord・column_coord)に持ち、(workspace_id, dimension_id, member_id) で
--   「同じ workspace の、その軸の値」しか入れられないようにする。
-- - 行ごとの権限(RLS)を全表で強制する。処理はトランザクションごとに fourdb.workspace_id を設定してから読み書きする。
--   設定がなければ何も見えない。表の持ち主の接続でも強制される(superuser と BYPASSRLS の役割は除く)。
-- - 「親を消すと子も消える」もの以外の参照(定義・軸の値など)は、トランザクションの終わりに確かめる(deferrable)。
--   workspace ごと消すときは中身がすべて消えるので通り、使われている定義だけを消そうとすると止まる。

begin;

create schema if not exists fourdb;

-- ---------- 今の処理の workspace と利用者(入れ物がトランザクションごとに設定する) ----------
create function fourdb.current_workspace_id() returns uuid
  language sql stable parallel safe set search_path = '' as
$$ select nullif(pg_catalog.current_setting('fourdb.workspace_id', true), '')::uuid $$;

create function fourdb.current_principal() returns text
  language sql stable parallel safe set search_path = '' as
$$ select nullif(pg_catalog.current_setting('fourdb.principal', true), '') $$;

-- ---------- 誰のデータか ----------
create table fourdb.workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- principal は入れ物が決める、変わらない利用者の印(例: neon:<ユーザー ID>)。メールアドレスのように変わりうるものは使わない
create table fourdb.workspace_member (
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  principal text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, principal)
);
create index workspace_member_principal on fourdb.workspace_member (principal);

-- ---------- Box(意味のある実体・まとまり) ----------
-- 深さは持たず、box_tree で数える(付け替えても古い深さが残らないように)
create table fourdb.box (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  parent_id uuid,
  type text not null check (type in ('entity', 'group')),   -- entity: A社などの実体 / group: 整理のためのまとまり
  unit_type text,                     -- 単位の名前(法人・店舗・申込者 …)。利用者が決める
  name text not null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, parent_id) references fourdb.box (workspace_id, id) deferrable initially deferred,
  check (parent_id is null or parent_id <> id)
);
create index box_parent on fourdb.box (workspace_id, parent_id);

-- ---------- 意味(Dimension・Column Registry・呼び名・関係) ----------
create table fourdb.dimension (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  name text not null,
  semantic_type text not null check (semantic_type in ('time', 'entity', 'category', 'custom')),
  levels text[] not null default '{}',   -- 階層の段の名前(上から)。例: {年,四半期,月}・{法人,店舗}。空なら段の数を問わない
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name)
);

-- 軸の値。合計(年合計・全店舗)は軸の値にしない(② 30章-2)。段(level)は親から決まる(トリガー)
create table fourdb.dimension_member (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  dimension_id uuid not null,
  parent_id uuid,
  level smallint not null default 0,  -- dimension.levels の何段目か(親の段 + 1。トリガーで入れる)
  name text not null,                 -- 正式な値(例: 2026-01・楽天)
  sort_order integer,
  period_start date,                  -- 時間の軸の値の期間 [period_start, period_end)
  period_end date,
  box_id uuid,                        -- 実体の軸の値と Box の対応(法人 = A社 ↔ Box A社)
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, dimension_id, id),
  unique nulls not distinct (dimension_id, parent_id, name),
  foreign key (workspace_id, dimension_id) references fourdb.dimension (workspace_id, id) on delete cascade,
  foreign key (workspace_id, dimension_id, parent_id) references fourdb.dimension_member (workspace_id, dimension_id, id) deferrable initially deferred,
  foreign key (workspace_id, box_id) references fourdb.box (workspace_id, id) on delete set null (box_id),
  check (period_start is null or period_end is null or period_start < period_end)
);
create index dimension_member_dim on fourdb.dimension_member (dimension_id, level);
create index dimension_member_parent on fourdb.dimension_member (parent_id) where parent_id is not null;
create index dimension_member_box on fourdb.dimension_member (box_id) where box_id is not null;

-- 段をまたいだまとめ(店舗 → 法人、月 → 年)のための祖先の一覧。自分自身も深さ 0 で入る(トリガーで入れる)
create table fourdb.member_ancestor (
  workspace_id uuid not null,
  member_id uuid not null,
  ancestor_id uuid not null,
  depth smallint not null,
  primary key (member_id, ancestor_id),
  foreign key (workspace_id, member_id) references fourdb.dimension_member (workspace_id, id) on delete cascade,
  foreign key (workspace_id, ancestor_id) references fourdb.dimension_member (workspace_id, id) on delete cascade
);
create index member_ancestor_ancestor on fourdb.member_ancestor (ancestor_id);

create table fourdb.column_group (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  name text not null,
  unique (workspace_id, id),
  unique (workspace_id, name)
);

-- Column Registry のカラム(意味の定義)。dimension = 軸になる分類 / measure = 数値 / attribute = Box の属性(Card)
create table fourdb.column_definition (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  name text not null,
  subtitle text,
  group_id uuid,
  kind text not null check (kind in ('dimension', 'measure', 'attribute')),
  dimension_id uuid,
  data_type text check (data_type in ('text', 'number', 'money', 'date', 'month', 'code', 'boolean', 'address', 'phone')),
  status text not null default 'active' check (status in ('active', 'deprecated')),
  description text,
  physical_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, id, kind),
  unique nulls not distinct (workspace_id, name, subtitle),
  foreign key (workspace_id, group_id) references fourdb.column_group (workspace_id, id) on delete set null (group_id),
  foreign key (workspace_id, dimension_id) references fourdb.dimension (workspace_id, id) deferrable initially deferred,
  check ((kind = 'dimension') = (dimension_id is not null))
);
create index column_definition_dimension on fourdb.column_definition (dimension_id) where dimension_id is not null;

-- ---------- 元(Source) ----------
-- 消すときは deleted_at を入れて隠す(論理削除)。移行完了した表は、workspace ごと消すとき以外は物理削除できない(トリガー)
create table fourdb.source_container (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  provider text not null check (provider in ('google_sheets', 'paste', 'native')),   -- native = 4D Base の中で入力した分
  external_id text,                   -- スプシの ID など(貼り付け・native は null)
  title text not null,
  url text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index source_container_external on fourdb.source_container (workspace_id, provider, external_id)
  where external_id is not null and deleted_at is null;

create table fourdb.source_sheet (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  container_id uuid not null,
  external_id text,                   -- スプシのタブの ID
  title text not null,
  box_id uuid,                        -- この表が属する Box
  header_row integer,                 -- 列名の行(0 始まり)
  group_row integer,                  -- その上のグループ名の行(なければ null)
  migration_status text not null default 'migrating' check (migration_status in ('migrating', 'migrated')),   -- D-002
  migrated_at timestamptz,
  migrated_by text,
  last_read_at timestamptz,
  source_row_count integer,
  source_col_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, container_id) references fourdb.source_container (workspace_id, id) on delete cascade deferrable initially deferred,
  foreign key (workspace_id, box_id) references fourdb.box (workspace_id, id) on delete set null (box_id),
  check ((migration_status = 'migrated') = (migrated_at is not null))
);
create index source_sheet_container on fourdb.source_sheet (container_id);
create unique index source_sheet_external on fourdb.source_sheet (container_id, external_id)
  where external_id is not null and deleted_at is null;

-- 元の列と、その列の意味(承認したもの)。値は作らず意味だけを持つので、意味を直しても値は書き換えない
create table fourdb.source_column (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  sheet_id uuid not null,
  col_index integer not null,         -- 0 始まり(A 列 = 0)
  header text not null,
  group_label text,
  role text not null default 'pending' check (role in ('pending', 'dimension', 'measure', 'attribute', 'aggregate', 'ignore')),
  -- dimension: 行ごとの値が軸の値になる(値は作らない) / measure: 数値 / attribute: 行の Box の属性(Card)
  -- aggregate: 合計・小計の列(値は作らない。中身は detail に残す) / ignore: 使わない / pending: まだ承認していない
  column_definition_id uuid,
  -- role から決まる「指してよいカラムの種類」。合計の列は数値のカラムを指してよい
  def_kind text generated always as (
    case role when 'dimension' then 'dimension' when 'measure' then 'measure' when 'attribute' then 'attribute' when 'aggregate' then 'measure' end
  ) stored,
  aggregate_function text check (aggregate_function in ('SUM', 'COUNT', 'AVG', 'MIN', 'MAX')),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),   -- 関数の例・呼び名の関係(≒ ⊃ ⊂)・承認のメモなど
  approved_at timestamptz,
  approved_by text,
  system_from timestamptz not null default clock_timestamp(),
  system_to timestamptz,              -- 元から列が消えたら閉じる
  unique (workspace_id, id),
  unique (workspace_id, sheet_id, id),
  foreign key (workspace_id, sheet_id) references fourdb.source_sheet (workspace_id, id) on delete cascade deferrable initially deferred,
  foreign key (workspace_id, column_definition_id, def_kind) references fourdb.column_definition (workspace_id, id, kind) deferrable initially deferred,
  check ((role = 'aggregate') = (aggregate_function is not null)),
  check (role not in ('dimension', 'measure', 'attribute') or column_definition_id is not null),
  check (role not in ('pending', 'ignore') or column_definition_id is null),
  check (system_to is null or system_from < system_to)
);
create unique index source_column_current on fourdb.source_column (sheet_id, col_index) where system_to is null;
create index source_column_sheet on fourdb.source_column (sheet_id);
create index source_column_definition on fourdb.source_column (column_definition_id) where column_definition_id is not null;

-- 元の行。合計・小計の行は kind = aggregate にして値を作らない(② 30章-2)
create table fourdb.record (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  sheet_id uuid not null,
  row_key text not null,              -- 読み直しても同じ行だと分かる鍵(鍵になる列の値。なければ行番号)
  row_index integer,                  -- 最後に読んだときの位置(0 始まり)。4D Base で足した行は null
  kind text not null default 'data' check (kind in ('data', 'aggregate')),
  box_id uuid,                        -- この行が表す実体(行の属性の値はこの Box の Card になる)
  system_from timestamptz not null default clock_timestamp(),
  system_to timestamptz,              -- 元から行が消えたら閉じる
  unique (workspace_id, id),
  unique (workspace_id, sheet_id, id),
  foreign key (workspace_id, sheet_id) references fourdb.source_sheet (workspace_id, id) on delete cascade deferrable initially deferred,
  foreign key (workspace_id, box_id) references fourdb.box (workspace_id, id) on delete set null (box_id),
  check (system_to is null or system_from < system_to)
);
create unique index record_current on fourdb.record (sheet_id, row_key) where system_to is null;
create index record_sheet on fourdb.record (sheet_id);
create index record_box on fourdb.record (box_id) where box_id is not null;

-- ---------- 軸の値の組(表全体 → 行 → 列 の順に決まり、後ろが優先) ----------
-- (workspace_id, dimension_id, member_id) で「同じ workspace の、その軸の値」しか入れられない。1つの軸に1つの値
create table fourdb.sheet_coord (
  workspace_id uuid not null,
  sheet_id uuid not null,
  dimension_id uuid not null,
  member_id uuid not null,
  primary key (sheet_id, dimension_id),
  foreign key (workspace_id, sheet_id) references fourdb.source_sheet (workspace_id, id) on delete cascade deferrable initially deferred,
  foreign key (workspace_id, dimension_id, member_id) references fourdb.dimension_member (workspace_id, dimension_id, id) deferrable initially deferred
);
create index sheet_coord_member on fourdb.sheet_coord (member_id);

create table fourdb.record_coord (
  workspace_id uuid not null,
  record_id bigint not null,
  dimension_id uuid not null,
  member_id uuid not null,
  primary key (record_id, dimension_id),
  foreign key (workspace_id, record_id) references fourdb.record (workspace_id, id) on delete cascade,
  foreign key (workspace_id, dimension_id, member_id) references fourdb.dimension_member (workspace_id, dimension_id, id) deferrable initially deferred
);
create index record_coord_member on fourdb.record_coord (dimension_id, member_id) include (record_id);

create table fourdb.column_coord (
  workspace_id uuid not null,
  column_id bigint not null,
  dimension_id uuid not null,
  member_id uuid not null,
  primary key (column_id, dimension_id),
  foreign key (workspace_id, column_id) references fourdb.source_column (workspace_id, id) on delete cascade,
  foreign key (workspace_id, dimension_id, member_id) references fourdb.dimension_member (workspace_id, dimension_id, id) deferrable initially deferred
);
create index column_coord_member on fourdb.column_coord (member_id);

-- ---------- Value(セル1つ = 行 × 列 の値) ----------
-- 行と列は同じタブのもの(sheet_id で揃える)。合計の行・列からは作らない。関数で計算されたセルは calculated(② 30章-3)
-- 直すときは前の版の system_to を閉じ、新しい版を足す(D-002。移行完了した表だけ)。版の中身は書き換えない(トリガー)
create table fourdb.value (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  sheet_id uuid not null,
  record_id bigint not null,
  column_id bigint not null,
  kind text not null check (kind in ('raw', 'calculated')),
  num numeric,
  txt text,                           -- 文字の値
  dt date,
  formula text,                       -- calculated のときの元の関数
  valid_from date,                    -- いつからの値か(なし = ずっと)。Card の属性だけに使う(数値の値は時間の軸で表す)
  valid_to date,
  system_from timestamptz not null default clock_timestamp(),   -- いつ記録したか
  system_to timestamptz,              -- いつ別の版に置き換わったか(今の版は null)
  origin text not null check (origin in ('import', 'manual')),
  recorded_by text,
  foreign key (workspace_id, sheet_id, record_id) references fourdb.record (workspace_id, sheet_id, id) on delete cascade,
  foreign key (workspace_id, sheet_id, column_id) references fourdb.source_column (workspace_id, sheet_id, id) on delete cascade,
  check (num_nonnulls(num, txt, dt) >= 1),
  check (valid_from is null or valid_to is null or valid_from < valid_to),
  check (system_to is null or system_from < system_to),
  check (kind = 'raw' or formula is not null)
);
create unique index value_current on fourdb.value (record_id, column_id, coalesce(valid_from, '-infinity'::date)) where system_to is null;
-- 次の2つは閉じた版も含む(部分索引にしない)。行・列を消すとき(on delete cascade)に閉じた版も探せるように
create index value_record on fourdb.value (record_id);
create index value_column on fourdb.value (column_id);

-- ---------- 取り込み(Saving の置き場。分割して読み、途中から再開できる) ----------
create table fourdb.import_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  sheet_id uuid not null,
  status text not null check (status in ('reading', 'staged', 'applying', 'applied', 'failed', 'cancelled')),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer not null default 0,
  cursor jsonb,                       -- 次に読む範囲(止まったらここから再開)
  error text,
  unique (workspace_id, id),
  foreign key (workspace_id, sheet_id) references fourdb.source_sheet (workspace_id, id) on delete cascade
);
create index import_run_sheet on fourdb.import_run (sheet_id);
-- 同じ表の取り込みは同時に1つだけ
create unique index import_run_active on fourdb.import_run (sheet_id) where status in ('reading', 'staged', 'applying');

-- 読み取った元のセル(反映するまでの置き場)。反映したら消す
create table fourdb.import_row (
  workspace_id uuid not null,
  run_id uuid not null,
  row_index integer not null,
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),   -- [{"v": 表示, "n": 数値 | null, "f": 関数 | null}, …]
  primary key (run_id, row_index),
  foreign key (workspace_id, run_id) references fourdb.import_run (workspace_id, id) on delete cascade
);

-- ---------- 関係(② 10章)と呼び名 ----------
-- 呼び名: 元の列名・値の書き方 → 正式なカラム・軸の値。範囲を表1枚だけにもできる
create table fourdb.alias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  alias text not null,
  column_definition_id uuid,
  member_id uuid,
  rel text not null check (rel in ('=', '≒', '⊃', '⊂')),
  scope_sheet_id uuid,                -- null = workspace 全体
  note text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, column_definition_id) references fourdb.column_definition (workspace_id, id) on delete cascade,
  foreign key (workspace_id, member_id) references fourdb.dimension_member (workspace_id, id) on delete cascade,
  foreign key (workspace_id, scope_sheet_id) references fourdb.source_sheet (workspace_id, id) on delete cascade,
  check (num_nonnulls(column_definition_id, member_id) = 1)
);
create unique index alias_unique on fourdb.alias (workspace_id, alias, coalesce(column_definition_id, member_id), coalesce(scope_sheet_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index alias_column on fourdb.alias (column_definition_id) where column_definition_id is not null;
create index alias_member on fourdb.alias (member_id) where member_id is not null;

-- 関係: HIERARCHY / SEMANTIC(equivalent・related)/ REFERENCE。今はカラム同士と Box 同士
create table fourdb.relation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  type text not null check (type in ('HIERARCHY', 'SEMANTIC', 'REFERENCE')),
  subtype text,                       -- SEMANTIC: equivalent / related
  from_column_id uuid,
  to_column_id uuid,
  from_box_id uuid,
  to_box_id uuid,
  note text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, from_column_id) references fourdb.column_definition (workspace_id, id) on delete cascade,
  foreign key (workspace_id, to_column_id) references fourdb.column_definition (workspace_id, id) on delete cascade,
  foreign key (workspace_id, from_box_id) references fourdb.box (workspace_id, id) on delete cascade,
  foreign key (workspace_id, to_box_id) references fourdb.box (workspace_id, id) on delete cascade,
  check ((from_column_id is not null and to_column_id is not null and from_box_id is null and to_box_id is null)
      or (from_box_id is not null and to_box_id is not null and from_column_id is null and to_column_id is null)),
  check (type <> 'SEMANTIC' or subtype in ('equivalent', 'related'))
);

-- ---------- 履歴(② 26章)。値ごとの前後は value の版で持つ ----------
create table fourdb.history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references fourdb.workspace (id) on delete cascade,
  at timestamptz not null default now(),
  actor text,                         -- principal
  kind text not null,                 -- import / mapping / migrate / edit / box / card / dictionary / definition …
  title text not null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);
create index history_recent on fourdb.history (workspace_id, at desc);

-- ---------- ビュー(見せ方だけ。RLS は呼んだ人の権限で効く) ----------
-- Card(② 5章)= Box の属性。値は value に入れる
create view fourdb.card_attribute with (security_invoker = true) as
select v.id,
       r.box_id,
       c.column_definition_id as attribute_definition_id,
       coalesce(v.txt, v.num::text, v.dt::text) as value,
       v.valid_from,
       v.valid_to,
       jsonb_build_object('sheet_id', v.sheet_id, 'row_index', r.row_index, 'col_index', c.col_index, 'origin', v.origin) as source_reference,
       v.workspace_id
  from fourdb.value v
  join fourdb.record r on r.id = v.record_id
  join fourdb.source_column c on c.id = v.column_id
  join fourdb.source_sheet s on s.id = v.sheet_id
 where c.role = 'attribute' and r.kind = 'data' and r.box_id is not null
   and v.system_to is null and r.system_to is null and c.system_to is null and s.deleted_at is null;

-- Box の深さ(② 4章の depth)。いちばん上が 0
create view fourdb.box_tree with (security_invoker = true) as
with recursive t as (
  select b.id, b.workspace_id, b.parent_id, 0 as depth from fourdb.box b where b.parent_id is null
  union all
  select b.id, b.workspace_id, b.parent_id, t.depth + 1 from fourdb.box b join t on b.parent_id = t.id
)
select id, workspace_id, parent_id, depth from t;

-- ---------- トリガー ----------
-- Box: 親を付け替えるとき、自分の子孫の下には入れない(輪にしない)。同じ workspace の付け替えは順番に行う
create function fourdb.box_no_cycle() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and new.parent_id is distinct from old.parent_id then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fourdb.box:' || new.workspace_id::text, 0));
    if exists (
      with recursive up as (
        select b.id, b.parent_id from fourdb.box b where b.id = new.parent_id
        union
        select b.id, b.parent_id from fourdb.box b join up on b.id = up.parent_id
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'Box を自分の中(子孫)に入れることはできません';
    end if;
  end if;
  return new;
end $$;
create trigger box_no_cycle before update of parent_id on fourdb.box
  for each row execute function fourdb.box_no_cycle();

-- 軸の値: 段は親の段 + 1。親は先に作っておく(同じ文の中で子を先に入れると止める)。段の数を超えない
create function fourdb.member_before_insert() returns trigger language plpgsql set search_path = '' as $$
declare parent_level smallint; max_levels integer;
begin
  if new.parent_id is null then
    new.level := 0;
  else
    select m.level into parent_level from fourdb.dimension_member m
     where m.id = new.parent_id and m.workspace_id = new.workspace_id and m.dimension_id = new.dimension_id;
    if not found then
      raise exception '軸の値の親(%)が、同じ軸にまだありません。親を先に作ってください', new.parent_id;
    end if;
    new.level := parent_level + 1;
  end if;
  select pg_catalog.cardinality(d.levels) into max_levels from fourdb.dimension d where d.id = new.dimension_id;
  if max_levels > 0 and new.level >= max_levels then
    raise exception '軸の段の数(%)を超えています', max_levels;
  end if;
  return new;
end $$;
create trigger member_before_insert before insert on fourdb.dimension_member
  for each row execute function fourdb.member_before_insert();

create function fourdb.member_after_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth) values (new.workspace_id, new.id, new.id, 0);
  if new.parent_id is not null then
    insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth)
    select new.workspace_id, new.id, a.ancestor_id, a.depth + 1 from fourdb.member_ancestor a where a.member_id = new.parent_id;
    if not found then
      raise exception '軸の値の親(%)の祖先の一覧がありません', new.parent_id;
    end if;
  end if;
  return new;
end $$;
create trigger member_after_insert after insert on fourdb.dimension_member
  for each row execute function fourdb.member_after_insert();

-- 軸の値の所属と親子は作ったあとで変えない(祖先の一覧が古くならないように)
create function fourdb.member_fixed() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.dimension_id, new.parent_id, new.level)
     is distinct from (old.id, old.workspace_id, old.dimension_id, old.parent_id, old.level) then
    raise exception '軸の値の所属・親・段は変えられません(新しい軸の値を作り、古いものを使わなくしてください)';
  end if;
  return new;
end $$;
create trigger member_fixed before update on fourdb.dimension_member
  for each row execute function fourdb.member_fixed();

-- 値: 版の中身は書き換えない。変えてよいのは「今の版を閉じる」ことだけ
create function fourdb.value_close_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.system_to is not null or new.system_to is null
     or (new.id, new.workspace_id, new.sheet_id, new.record_id, new.column_id, new.kind, new.num, new.txt, new.dt, new.formula,
         new.valid_from, new.valid_to, new.system_from, new.origin, new.recorded_by)
        is distinct from
        (old.id, old.workspace_id, old.sheet_id, old.record_id, old.column_id, old.kind, old.num, old.txt, old.dt, old.formula,
         old.valid_from, old.valid_to, old.system_from, old.origin, old.recorded_by) then
    raise exception '値の版は書き換えられません。今の版を閉じて(system_to)、新しい版を足してください';
  end if;
  return new;
end $$;
create trigger value_close_only before update on fourdb.value
  for each row execute function fourdb.value_close_only();

-- 値: 入れてよい場所と、移行の状態(D-002・② 30章)。属性の期間は重ねない
create function fourdb.value_rules() returns trigger language plpgsql set search_path = '' as $$
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
create trigger value_rules after insert on fourdb.value
  referencing new table as new_rows
  for each statement execute function fourdb.value_rules();

-- 移行完了した表は物理削除しない(workspace ごと消すときだけ通る)。消すときは deleted_at を入れて隠す
create function fourdb.sheet_keep_migrated() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.migration_status = 'migrated' and exists (select 1 from fourdb.workspace w where w.id = old.workspace_id) then
    raise exception '移行完了した表(%)は消せません。deleted_at を入れて隠してください', old.title;
  end if;
  return old;
end $$;
create trigger sheet_keep_migrated before delete on fourdb.source_sheet
  for each row execute function fourdb.sheet_keep_migrated();

-- ---------- 権限: 行ごとの権限を全表で強制し、芯は誰にも何も渡さない ----------
-- 入れ物(つなぎ)が自分の実行用の役割を作り、その役割に必要な権限だけを渡す(芯には書かない。D-004)
do $$
declare t text;
begin
  for t in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'fourdb' and c.relkind = 'r' loop
    execute pg_catalog.format('alter table fourdb.%I enable row level security', t);
    execute pg_catalog.format('alter table fourdb.%I force row level security', t);
    if t = 'workspace' then
      execute 'create policy workspace_scope on fourdb.workspace
                 using (id = (select fourdb.current_workspace_id()))
                 with check (id = (select fourdb.current_workspace_id()))';
    elsif t = 'workspace_member' then
      -- 自分がどの workspace に入っているかは、workspace を決める前に引けるようにする
      execute 'create policy workspace_scope on fourdb.workspace_member
                 using (workspace_id = (select fourdb.current_workspace_id()) or principal = (select fourdb.current_principal()))
                 with check (workspace_id = (select fourdb.current_workspace_id()))';
    else
      execute pg_catalog.format('create policy workspace_scope on fourdb.%I
                 using (workspace_id = (select fourdb.current_workspace_id()))
                 with check (workspace_id = (select fourdb.current_workspace_id()))', t);
    end if;
  end loop;
end $$;

revoke all on schema fourdb from public;
revoke all on all tables in schema fourdb from public;
revoke all on all sequences in schema fourdb from public;
revoke all on all functions in schema fourdb from public;
alter default privileges in schema fourdb revoke all on tables from public;
alter default privileges in schema fourdb revoke all on sequences from public;
alter default privileges in schema fourdb revoke execute on functions from public;

commit;
