-- 入金キューブ(実データ用):申込者 › 契約者 › 法人 › ショップ › 月別入金(内訳つき)
-- 取り込みは CSV・Excel から。各表は「コード」で上書き(なければ追加)する。
-- 情報カードに出す項目のうち決まった列にないものは extra(jsonb)に入れる。

create table applicants (
  code        text primary key,
  name        text not null,
  extra       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table contractors (
  code            text primary key,
  applicant_code  text not null references applicants(code) on update cascade,
  name            text not null,
  extra           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table companies (
  code             text primary key,
  contractor_code  text not null references contractors(code) on update cascade,
  name             text not null,
  tax_category     text not null check (tax_category in ('課税', '免税')),
  postal_code      text,
  address          text,
  representative   text,
  founded_on       date,
  invoice_no       text,
  extra            jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

create table shops (
  code          text primary key,
  company_code  text not null references companies(code) on update cascade,
  name          text not null,
  mall          text not null,                -- '楽天' 'Yahoo' など
  extra         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- 月別入金の内訳。売上は正、費用は負の金額で入れる
create table deposits (
  shop_code   text not null references shops(code) on update cascade on delete cascade,
  month       date not null check (extract(day from month) = 1),   -- その月の1日
  item        text not null,                                       -- '売上' 'システム利用料' など
  amount      bigint not null,
  updated_at  timestamptz not null default now(),
  primary key (shop_code, month, item)
);

create index on contractors (applicant_code);
create index on companies (contractor_code);
create index on shops (company_code);

-- 読み書きはサーバー(ログイン確認済み)からだけ行う。API 経由の直接アクセスは閉じる
alter table applicants  enable row level security;
alter table contractors enable row level security;
alter table companies   enable row level security;
alter table shops       enable row level security;
alter table deposits    enable row level security;
