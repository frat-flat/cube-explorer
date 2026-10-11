-- 0007_value_calculated_index.sql を元に戻す(計算された値の索引 value_calculated を外す)。データも決まり(制約)も変わらない。
-- 外すと、ホームの「数値」の欄の ƒ の判定が遅くなる(値の数に比例)。
-- 外す間は value 表を一瞬すべて押さえる(読み書きとも)。待ちが 5 秒を超えたら止める(取り込みをしていない時間に流し直す。何も変わらない)。
-- もう一度流しても、索引がなければ何もしない。
-- 流したあとは fourdb_migrations.applied から '0007_value_calculated_index.sql' の行を消す(消さないと、次の migrate で 0007 が流れない)。
begin;
set local lock_timeout = '5s';

drop index if exists fourdb.value_calculated;

commit;
