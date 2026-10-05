-- 設計書 5.2「事実テーブルから軸への結びつけ」
-- 軸の source_table を事実テーブルから結合するときに、source_table 側で行を特定する列
alter table cube_meta.axes add column key_column text;
