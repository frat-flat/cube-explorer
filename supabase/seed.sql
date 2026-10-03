-- サンプルデータ投入(設計書 5.1 シード規模の目安)
-- 店舗10、担当者20、商品50、引き継ぎメモ200、売上 約5万件(2025-10 〜 2026-09 の12か月分)
-- 乱数の種を固定しているので、何度投入しても同じデータになる
-- `npx supabase db reset` で、マイグレーションと合わせて自動投入される

select setseed(0.42);

-- 担当者 20名
insert into staff (id, name)
select format('E%s', lpad(i::text, 3, '0')), n
from unnest(array[
  '佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤',
  '吉田','山田','佐々木','山口','松本','井上','木村','林','清水','山崎'
]) with ordinality as t(n, i);

-- 店舗 10店
insert into stores (id, name, area, opened_on)
select format('S%s', lpad(i::text, 3, '0')), n || '店', a, o::date
from unnest(
  array['A','B','C','D','E','F','G','H','I','J'],
  array['広島市中区','広島市南区','広島市西区','広島市東区','広島市安佐南区',
        '広島市佐伯区','呉市','東広島市','福山市','尾道市'],
  array['2012-04-01','2014-07-15','2015-11-01','2017-03-20','2018-09-01',
        '2019-12-10','2021-05-01','2022-08-01','2023-10-15','2025-02-01']
) with ordinality as t(n, a, o, i);

-- 商品 50品(5カテゴリ × 10品)
insert into products (id, name, category)
select format('P%s', lpad((c.ci * 10 + p.pi - 10)::text, 3, '0')),
       c.cat || '商品' || lpad(p.pi::text, 2, '0'),
       c.cat
from unnest(array['飲料','食品','菓子','日用品','雑貨']) with ordinality as c(cat, ci)
cross join generate_series(1, 10) as p(pi);

-- 引き継ぎメモ 200件(店舗の偏りあり)
insert into store_handover_notes (store_id, category, content, written_at, author_id)
select
  format('S%s', lpad((1 + floor(10 * power(random(), 1.5)))::int::text, 3, '0')),
  cat,
  cat || ':' || (array[
    '次回の点検日を確認してください',
    '発注量を見直しました',
    'お客様から問い合わせがありました',
    'シフトの調整が必要です',
    'レイアウト変更の予定があります',
    '前任者から申し送りがあります'
  ])[1 + floor(random() * 6)::int],
  (date '2025-10-01' + floor(random() * 365)::int + time '09:00' + random() * interval '12 hours') at time zone 'Asia/Tokyo',
  format('E%s', lpad((1 + floor(random() * 20))::int::text, 3, '0'))
from (
  select (array['設備','人員','顧客対応','売場','その他'])[1 + floor(random() * 5)::int] as cat
  from generate_series(1, 200)
) s;

-- 売上 50,000件
-- 店舗は random()^2 で選ぶため、A店に多く J店に少なく偏る(奥行きの不揃いを再現)
-- 日時は日本時間の 9:00〜21:00 に収まるようにする
-- 単価は商品ごとに固定(100〜1,000円)
insert into sales (store_id, product_id, staff_id, sold_at, quantity, amount)
select
  store_id,
  product_id,
  staff_id,
  sold_at,
  quantity,
  quantity * (100 + ((product_no * 137) % 10) * 100)
from (
  select
    format('S%s', lpad((1 + floor(10 * power(random(), 2)))::int::text, 3, '0')) as store_id,
    (1 + floor(random() * 50))::int as product_no,
    format('E%s', lpad((1 + floor(random() * 20))::int::text, 3, '0')) as staff_id,
    (date '2025-10-01' + floor(random() * 365)::int + time '09:00' + random() * interval '12 hours')
      at time zone 'Asia/Tokyo' as sold_at,
    (1 + floor(random() * 5))::int as quantity
  from generate_series(1, 50000)
) s
cross join lateral (select format('P%s', lpad(s.product_no::text, 3, '0')) as product_id) p;

-- ─────────────────────────────────────────────
-- メタデータ:サンプル用の軸定義(設計書 5.2)
-- ─────────────────────────────────────────────
insert into cube_meta.axes (key, label, kind, source_table, source_column, label_column, time_grain, master_key) values
  ('store',            '店舗',             'entity',    'stores',               'id',       'name', null,    'stores'),
  ('staff',            '担当者',           'entity',    'staff',                'id',       'name', null,    'staff'),
  ('product',          '商品',             'entity',    'products',             'id',       'name', null,    'products'),
  ('product_category', '商品カテゴリ',     'attribute', 'products',             'category', null,   null,    'product_category'),
  ('note_category',    '引き継ぎカテゴリ', 'attribute', 'store_handover_notes', 'category', null,   null,    'note_category'),
  ('day',              '日',               'time',      null,                   null,       null,   'day',   'calendar_day'),
  ('week',             '週',               'time',      null,                   null,       null,   'week',  'calendar_week'),
  ('month',            '月',               'time',      null,                   null,       null,   'month', 'calendar_month'),
  ('year',             '年',               'time',      null,                   null,       null,   'year',  'calendar_year'),
  ('store_item',       '項目',             'columns',   'stores',               null,       null,   null,    null);

-- メタデータ:サンプル用の事実定義
insert into cube_meta.facts (key, label, source_table, axis_columns, measures) values
  ('sales', '売上', 'sales',
   '{"store":"store_id","product":"product_id","staff":"staff_id","day":"sold_at","week":"sold_at","month":"sold_at","year":"sold_at"}',
   '[{"key":"amount","label":"売上金額","column":"amount","type":"number","aggs":["sum","avg","count","min","max"]},
     {"key":"quantity","label":"数量","column":"quantity","type":"number","aggs":["sum","avg","count","min","max"]},
     {"key":"sold_at","label":"販売日時","column":"sold_at","type":"datetime","aggs":["min","max","count"]}]'),
  ('handover_notes', '引き継ぎメモ', 'store_handover_notes',
   '{"store":"store_id","note_category":"category","staff":"author_id","day":"written_at","week":"written_at","month":"written_at","year":"written_at"}',
   '[{"key":"content","label":"内容","column":"content","type":"text","aggs":["count","latest","list"]},
     {"key":"written_at","label":"記入日時","column":"written_at","type":"datetime","aggs":["min","max","count"]}]');
