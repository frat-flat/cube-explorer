-- 0002_source_total.sql を元に戻す(スプシの合計の数字が消える)。
begin;
drop table if exists fourdb.source_total;
drop function if exists fourdb.source_total_rules();
commit;
