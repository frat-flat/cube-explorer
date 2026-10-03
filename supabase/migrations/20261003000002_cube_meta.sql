-- 設計書 5.2 メタデータテーブル(本システム用)
create schema cube_meta;

-- 軸の定義
create table cube_meta.axes (
  key            text primary key,   -- 'store' 'product_category' 'month'
  label          text not null,      -- '店舗'
  kind           text not null check (kind in ('entity', 'attribute', 'time', 'columns')),
  source_table   text,               -- 'stores'
  source_column  text,               -- 'id'
  label_column   text,               -- 'name'(表示名に使う列)
  time_grain     text check (time_grain in ('day', 'week', 'month', 'year')),
  master_key     text                -- 同じ「ものさし」を共有する軸の識別子(比較に使う)
);

-- 事実テーブル(コマの中身の出どころ)の定義
create table cube_meta.facts (
  key            text primary key,   -- 'sales' 'handover_notes'
  label          text not null,
  source_table   text not null,
  axis_columns   jsonb not null,     -- 軸キー → このテーブルの列
  measures       jsonb not null      -- 使える値と集約方法
);

-- 保存した立体(よく使う視点のブックマーク)
create table cube_meta.saved_cubes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  spec        jsonb not null,        -- CubeSpec
  created_at  timestamptz default now()
);
