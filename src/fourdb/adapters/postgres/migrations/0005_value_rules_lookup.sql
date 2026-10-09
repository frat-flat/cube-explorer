-- 値・スプシの合計を入れたときの確かめ(value_rules・source_total_rules)を、たくさん入れても遅くならない引き方にする。
-- 決まり(何を止めるか・止めるときの文)は 0001・0002 と同じ。元に戻すときは 0005_value_rules_lookup.down.sql。
-- 理由: 入れた行(new_rows)と表を結ぶと、統計がない・古い・「空のときに vacuum された」(reltuples = 0)ときに、
--       データベースが「表の側を外にして入れた行を何度もなめる」手順や「別の索引で列全体をなめる」手順を選び、
--       3,000 行 × 12 か月(約 4 万個)の反映が 180 秒、空のときに vacuum された表では 1 万行で 360 秒かかった
--       (入れた数 × 表の数 の比べ合い)。統計の状態しだいで、どの索引が選ばれるかは決まらない。
-- 直し方: 1行ずつ表を引かない。
--   (1) 今回の文で入れた行の id(行・列・表)を重ねずに集め、表ごとに1回だけ引く(= any(配列))。
--       配列は文の中に定数として書く(format の %L)。定数なので、どの手順が選ばれても1回の文で表を1回なめる以上にはならない
--   (2) 引いた分を id → 中身 の対応表(jsonb)にし、入れた行ごとにそこから引く(結びにしない)
--   (3) 文は毎回組み立てる(EXECUTE)。関数の中の文は接続ごとに計画が使い回されるため。
--       文はこのファイルに書いた固定の文と、id の配列(数・uuid)だけでできていて、外から受け取った文字はつなげない
-- 関数の search_path は pg_catalog, pg_temp(一時的な名前空間を最後に)。'' のままだと、型の名前(text・uuid・date など)は
-- 一時的な名前空間が先に探され、同じ名前の一時的な型に差し替えられうるため。
-- 流し方: 取り込み(反映)をしていない時間に流す。record_sheet を外すときに record 表をすべて押さえる(ACCESS EXCLUSIVE)ので、
--         待ちが 5 秒を超えたら止める(lock_timeout。止まったら、取り込みが終わってから流し直す。何も変わらない)。
begin;
set local lock_timeout = '5s';

create or replace function fourdb.value_rules() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare bad text; rids bigint[]; cids bigint[]; sids uuid[];
begin
  select pg_catalog.array_agg(distinct n.record_id), pg_catalog.array_agg(distinct n.column_id), pg_catalog.array_agg(distinct n.sheet_id)
    into rids, cids, sids
    from new_rows n where n.system_to is null;
  if rids is null then
    return null;   -- 今の版を入れていなければ、確かめることはない
  end if;

  -- 入れてよい場所と、移行の状態(行・列・表の性質を、今回の分だけ1回ずつ引いて対応表にする)
  execute pg_catalog.format($q$
    with rs as (select pg_catalog.jsonb_object_agg(x.id::text, pg_catalog.jsonb_build_array(x.kind, x.system_to is not null)) as o
                  from fourdb.record x where x.id = any (%L::bigint[])),
         cs as (select pg_catalog.jsonb_object_agg(x.id::text, pg_catalog.jsonb_build_array(x.role, x.system_to is not null)) as o
                  from fourdb.source_column x where x.id = any (%L::bigint[])),
         ss as (select pg_catalog.jsonb_object_agg(x.id::text, x.migration_status) as o
                  from fourdb.source_sheet x where x.id = any (%L::uuid[]))
    select pg_catalog.format('行 %%s・列 %%s: %%s', n.record_id, n.column_id,
             case
               when l.r_kind <> 'data' then '合計・小計の行には値を入れません'
               when l.c_role not in ('measure', 'attribute') then '数値か属性の列にだけ値を入れます(この列は ' || l.c_role || ')'
               when l.c_closed or l.r_closed then '閉じた行・列には値を入れません'
               when l.c_role = 'measure' and n.num is null then '数値の列には数値を入れます'
               when l.c_role = 'measure' and (n.valid_from is not null or n.valid_to is not null) then '数値の値には期間を付けません(時間は軸で表します)'
               when n.origin = 'manual' and l.s_status <> 'migrated' then '移行中の表は 4D Base で直せません(スプシで直して読み直してください)'
               when n.origin = 'manual' and n.kind <> 'raw' then '計算された値は直せません'
               when n.origin = 'import' and l.s_status <> 'migrating' then '移行完了した表には、スプシから取り込みません'
             end)
      from new_rows n
      cross join rs cross join cs cross join ss
      cross join lateral (
        select rs.o -> (n.record_id::text) ->> 0 as r_kind, (rs.o -> (n.record_id::text) ->> 1)::boolean as r_closed,
               cs.o -> (n.column_id::text) ->> 0 as c_role, (cs.o -> (n.column_id::text) ->> 1)::boolean as c_closed,
               ss.o ->> (n.sheet_id::text) as s_status) l
     where n.system_to is null
       and l.r_kind is not null and l.c_role is not null and l.s_status is not null   -- 見えない行・列・表は数えない(0001 の結びと同じ)
       and (l.r_kind <> 'data'
         or l.c_role not in ('measure', 'attribute')
         or l.c_closed or l.r_closed
         or (l.c_role = 'measure' and (n.num is null or n.valid_from is not null or n.valid_to is not null))
         or (n.origin = 'manual' and (l.s_status <> 'migrated' or n.kind <> 'raw'))
         or (n.origin = 'import' and l.s_status <> 'migrating'))
     limit 1 $q$, rids, cids, sids) into bad;
  if bad is not null then
    raise exception '%', bad;
  end if;

  -- 属性の期間の重なり(今の版どうし)。同じ workspace の属性の書き込みは順番に行う
  if exists (select 1 from new_rows n where n.system_to is null and (n.valid_from is not null or n.valid_to is not null)) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fourdb.value:' || n.workspace_id::text, 0))
       from (select distinct workspace_id from new_rows) n;
  end if;
  -- 今回の行の今の値(入れた分を含む)を、セル(行:列)ごとの一覧にして、入れた行ごとにその一覧とだけ比べる
  execute pg_catalog.format($q$
    with cur as (
      select pg_catalog.jsonb_object_agg(g.k, g.l) as o
        from (select o.record_id::text || ':' || o.column_id::text as k,
                     pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(o.id, o.valid_from, o.valid_to)) as l
                from fourdb.value o
               where o.record_id = any (%L::bigint[]) and o.system_to is null
               group by 1) g)
    select pg_catalog.format('行 %%s・列 %%s: 期間が重なる今の値がすでにあります', n.record_id, n.column_id)
      from new_rows n
      cross join cur
      cross join lateral pg_catalog.jsonb_array_elements(cur.o -> (n.record_id::text || ':' || n.column_id::text)) e
     where n.system_to is null
       and (e.value ->> 0)::bigint <> n.id
       and pg_catalog.daterange(n.valid_from, n.valid_to) operator(pg_catalog.&&) pg_catalog.daterange((e.value ->> 1)::date, (e.value ->> 2)::date)
     limit 1 $q$, rids) into bad;
  if bad is not null then
    raise exception '%', bad;
  end if;
  return null;
end $$;
revoke all on function fourdb.value_rules() from public;

-- 入れてよいのは、合計の行のセルか、合計の列のセルだけ(0002 と同じ決まり。引き方は上と同じ)
create or replace function fourdb.source_total_rules() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare bad text; rids bigint[]; cids bigint[];
begin
  select pg_catalog.array_agg(distinct n.record_id), pg_catalog.array_agg(distinct n.column_id)
    into rids, cids
    from new_rows n where n.system_to is null;
  if rids is null then
    return null;
  end if;
  execute pg_catalog.format($q$
    with rs as (select pg_catalog.jsonb_object_agg(x.id::text, x.kind) as o from fourdb.record x where x.id = any (%L::bigint[])),
         cs as (select pg_catalog.jsonb_object_agg(x.id::text, x.role) as o from fourdb.source_column x where x.id = any (%L::bigint[]))
    select pg_catalog.format('行 %%s・列 %%s: 合計の行か合計の列のセルだけを残します', n.record_id, n.column_id)
      from new_rows n
      cross join rs cross join cs
     where n.system_to is null
       and (rs.o ->> (n.record_id::text)) <> 'aggregate' and (cs.o ->> (n.column_id::text)) <> 'aggregate'
     limit 1 $q$, rids, cids) into bad;
  if bad is not null then
    raise exception '%', bad;
  end if;
  return null;
end $$;
revoke all on function fourdb.source_total_rules() from public;

-- 行(record)の sheet_id だけの索引を外す。決まり(制約)は変わらない。
-- 理由: 値・スプシの合計を入れるたびに、データベースは参照の確かめ(外部キー)で行を (workspace_id, sheet_id, id) で引く。
--       統計が「空のときに vacuum された」状態だと、どの索引の見積もりも同じになり、この索引が選ばれると
--       値 1 個ごとに表の全行をなめる(3,000 行で 10 秒以上)。
--       表の行を引く文は、どれも今の行だけ(record_current)か、行ごとの権限で workspace つき((workspace_id, sheet_id, id))なので、この索引は使っていない。
--       表を消したときに行を消す処理((workspace_id, sheet_id) の外部キー)も (workspace_id, sheet_id, id) で引ける。
drop index if exists fourdb.record_sheet;

commit;
