-- scale.sql のデータで、Projection Engine が出す形の集計の速さを測る(2回ずつ流し、2回目を見る)。
-- 入れ物の実行用の役割 fourdb_scale_app で、workspace を設定し、行ごとの権限がかかった状態で測る。
-- どの問い合わせも workspace の条件を明示する(行ごとの権限は、書き忘れたときの最後の守り)。
\set ws '''f0000000-0000-0000-0000-000000000001''::uuid'
\set shop '''f1000000-0000-0000-0000-000000000001''::uuid'
\set month '''f1000000-0000-0000-0000-000000000002''::uuid'

set role fourdb_scale_app;
select set_config('fourdb.workspace_id', 'f0000000-0000-0000-0000-000000000001', false);
\timing on

-- Q1: 項目01 を 法人 × 年 でまとめる(全法人。値 288,000 個を集計)
-- 軸の値は「列 → 行 → 表全体」の順に探す(coalesce)
\echo Q1
select corp.name as 法人, y.name as 年, sum(v.num)
  from fourdb.value v
  join fourdb.source_column c on c.id = v.column_id and c.workspace_id = :ws and c.system_to is null and c.role = 'measure'
  join fourdb.column_definition d on d.id = c.column_definition_id and d.workspace_id = :ws and d.name = '項目01'
  join fourdb.record r on r.id = v.record_id and r.workspace_id = :ws and r.system_to is null and r.kind = 'data'
  left join fourdb.column_coord cs on cs.column_id = c.id and cs.dimension_id = :shop
  left join fourdb.record_coord rs on rs.record_id = r.id and rs.dimension_id = :shop
  left join fourdb.sheet_coord ss on ss.sheet_id = v.sheet_id and ss.dimension_id = :shop
  left join fourdb.column_coord cm on cm.column_id = c.id and cm.dimension_id = :month
  left join fourdb.record_coord rm on rm.record_id = r.id and rm.dimension_id = :month
  left join fourdb.sheet_coord sm on sm.sheet_id = v.sheet_id and sm.dimension_id = :month
  join fourdb.member_ancestor ca on ca.member_id = coalesce(cs.member_id, rs.member_id, ss.member_id) and ca.workspace_id = :ws
  join fourdb.dimension_member corp on corp.id = ca.ancestor_id and corp.workspace_id = :ws and corp.level = 0
  join fourdb.member_ancestor ya on ya.member_id = coalesce(cm.member_id, rm.member_id, sm.member_id) and ya.workspace_id = :ws
  join fourdb.dimension_member y on y.id = ya.ancestor_id and y.workspace_id = :ws and y.level = 0
 where v.workspace_id = :ws and v.system_to is null and v.kind = 'raw'
 group by 1, 2 order by 1, 2;
\g

-- Q2: 1つの店舗(法人0001-店1)× 月(項目01)
\echo Q2
select m.name as 月, sum(v.num)
  from fourdb.dimension_member shop
  join fourdb.record_coord rs on rs.dimension_id = :shop and rs.member_id = shop.id and rs.workspace_id = :ws
  join fourdb.record r on r.id = rs.record_id and r.workspace_id = :ws and r.system_to is null and r.kind = 'data'
  join fourdb.record_coord rm on rm.record_id = r.id and rm.dimension_id = :month
  join fourdb.dimension_member m on m.id = rm.member_id and m.workspace_id = :ws
  join fourdb.value v on v.record_id = r.id and v.workspace_id = :ws and v.system_to is null and v.kind = 'raw'
  join fourdb.source_column c on c.id = v.column_id and c.workspace_id = :ws and c.system_to is null and c.role = 'measure'
  join fourdb.column_definition d on d.id = c.column_definition_id and d.workspace_id = :ws and d.name = '項目01'
 where shop.workspace_id = :ws and shop.dimension_id = :shop and shop.name = '法人0001-店1'
 group by 1 order by 1;
\g

-- Q2b: 法人0001 の全店舗(祖先が 法人0001 の店舗)× 2026 年の月(項目01)= Sheet の1画面分
\echo Q2b
select shop.name as 店舗, m.name as 月, sum(v.num)
  from fourdb.dimension_member corp
  join fourdb.member_ancestor ca on ca.ancestor_id = corp.id and ca.workspace_id = :ws
  join fourdb.dimension_member shop on shop.id = ca.member_id and shop.workspace_id = :ws and shop.level = 1
  join fourdb.record_coord rs on rs.dimension_id = :shop and rs.member_id = shop.id and rs.workspace_id = :ws
  join fourdb.record r on r.id = rs.record_id and r.workspace_id = :ws and r.system_to is null and r.kind = 'data'
  join fourdb.record_coord rm on rm.record_id = r.id and rm.dimension_id = :month
  join fourdb.dimension_member m on m.id = rm.member_id and m.workspace_id = :ws and m.period_start >= '2026-01-01' and m.period_end <= '2027-01-01'
  join fourdb.value v on v.record_id = r.id and v.workspace_id = :ws and v.system_to is null and v.kind = 'raw'
  join fourdb.source_column c on c.id = v.column_id and c.workspace_id = :ws and c.system_to is null and c.role = 'measure'
  join fourdb.column_definition d on d.id = c.column_definition_id and d.workspace_id = :ws and d.name = '項目01'
 where corp.workspace_id = :ws and corp.dimension_id = :shop and corp.name = '法人0001'
 group by 1, 2 order by 1, 2;
\g

-- Q3: すべての項目を 四半期 × 項目 でまとめる(値 2,880,000 個をすべて集計。いちばん重い)
\echo Q3
select q.name as 四半期, d.name as 項目, sum(v.num)
  from fourdb.value v
  join fourdb.source_column c on c.id = v.column_id and c.workspace_id = :ws and c.system_to is null and c.role = 'measure'
  join fourdb.column_definition d on d.id = c.column_definition_id and d.workspace_id = :ws
  join fourdb.record r on r.id = v.record_id and r.workspace_id = :ws and r.system_to is null and r.kind = 'data'
  join fourdb.record_coord rm on rm.record_id = r.id and rm.dimension_id = :month
  join fourdb.member_ancestor qa on qa.member_id = rm.member_id and qa.workspace_id = :ws
  join fourdb.dimension_member q on q.id = qa.ancestor_id and q.workspace_id = :ws and q.level = 1
 where v.workspace_id = :ws and v.system_to is null and v.kind = 'raw'
 group by 1, 2 order by 1, 2;
\g

-- Q4: 表を1枚消す(中の行 576・値 5,760 もいっしょに)。測ったら元に戻す
\echo Q4
begin;
delete from fourdb.source_sheet where id = (select id from fourdb.source_sheet where workspace_id = :ws order by title limit 1);
rollback;

-- Q5: workspace を設定しないと何も見えない(行ごとの権限)
\echo Q5
select set_config('fourdb.workspace_id', '', false);
select count(*) as "設定なしで見える値の数" from fourdb.value;
reset role;
