-- 計算された値(ƒ)の今の版だけの索引(D-017)。ホームの「数値」の欄で、数値ごとに「計算された値があるか」を引く(Q3b)ために使う。
-- 元に戻すときは 0007_value_calculated_index.down.sql。データも決まり(制約)も変わらない。
-- 理由: 列ごとの索引(value_column)は、すべての版・すべての種類の値を持つので、計算された値がない数値ほど、その列の値をすべてなめる
--       (規模の確認 test/scale_home.sql の V1: 数値 12 個・列 11,385 本で 24 万行を読み、1 秒以上)。
--       計算された値の今の版だけを持つ部分索引なら、ない列は索引を見るだけで終わる。
-- 流し方: 取り込み(反映)をしていない時間に流す。索引を作る間は value 表への書き込みが待たされる(読むのは止まらない。作る時間は値の数に比例)。
--         待ちが 5 秒を超えたら止める(lock_timeout。止まったら、取り込みが終わってから流し直す。何も変わらない)。
--         索引を作る時間が 60 秒を超えたら止める(statement_timeout。取引ごと元に戻り、索引は残らず、何も変わらない)。
--         もう一度流すと「すでにある」で止まり、何も変わらない。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index value_calculated on fourdb.value (column_id) where kind = 'calculated' and system_to is null;

commit;
