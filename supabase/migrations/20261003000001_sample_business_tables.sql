-- 設計書 5.1 サンプル業務テーブル
-- store_handover_notes が staff を参照するため、staff を先に作成する(設計書の記載順から入れ替え)

-- 担当者マスタ
create table staff (
  id    text primary key,
  name  text not null
);

-- 店舗マスタ
create table stores (
  id          text primary key,      -- 'S001'
  name        text not null,         -- 'A店'
  area        text not null,         -- '広島市中区'
  opened_on   date
);

-- 店舗の引き継ぎ情報(文字情報の軸の例)
create table store_handover_notes (
  id          bigserial primary key,
  store_id    text not null references stores(id),
  category    text not null,         -- '設備' '人員' '顧客対応' など
  content     text not null,
  written_at  timestamptz not null,
  author_id   text references staff(id)
);

-- 商品マスタ
create table products (
  id        text primary key,
  name      text not null,
  category  text not null            -- '飲料' '食品' など
);

-- 売上明細(奥行きになる大量データの例)
create table sales (
  id          bigserial primary key,
  store_id    text not null references stores(id),
  product_id  text not null references products(id),
  staff_id    text references staff(id),
  sold_at     timestamptz not null,
  quantity    int not null,
  amount      int not null           -- 円
);

-- Supabase の公開API(PostgREST)からは読めないようにする。本システムはサーバー側から直接接続する
alter table staff enable row level security;
alter table stores enable row level security;
alter table store_handover_notes enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
