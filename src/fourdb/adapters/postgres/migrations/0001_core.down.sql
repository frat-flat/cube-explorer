-- 0001_core.sql を元に戻す(fourdb の表・関数・ビューをすべて消す。中のデータも消える)。
-- 本番で流すときは、必ず事前にバックアップを取り、ユーザーの承認を得てから。
begin;
drop schema if exists fourdb cascade;
commit;
