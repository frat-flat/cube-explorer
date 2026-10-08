-- 0003_sheet_definition.sql を元に戻す(保存した表の定義が消える。履歴 history の記録は残る)。
begin;
drop table if exists fourdb.sheet_definition;
commit;
