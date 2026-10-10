-- 0006_principal_pref.sql を元に戻す(アカウントごとの設定の表 fourdb.principal_pref を外す)。ほかの表は変わらない。
-- 表に行があれば止まる(利用者が保存した設定は、0006 のあとに入った正当なデータなので、黙って消さない)。止まったときの文に行の数が出る。
--   消してよいと決めたときだけ、1 つの取引の中で、先に「消す行の数」を set local で設定してから流す(数が今の行の数と同じときだけ通る。そのあと増えていれば止まる):
--     begin; set local fourdb.discard_principal_pref = '<止まったときに出た行の数>'; <この down の SQL>; commit;
--   local を付けない set(セッションの設定)は使わない: 接続に残り、接続を使い回す所では、あとで流す別の down が数の確かめなしで通ってしまう。set local は取引が終われば消える。
--   これは消す数の確かめで、権限ではない(表を消せるのは表の持ち主か superuser だけ)。
-- 数えるときは、表の持ち主でもすべての行が見えるよう、この取引の中だけ RLS の強制(FORCE)を外す(止まれば元に戻る。通れば表ごと消える)。
-- 表の持ち主でも superuser でもない接続では、強制を外せずに止まる(何も変わらない)。
-- 1つの文(DO)だけでできているので、数を設定しないとき(行が 0 のとき)は、これだけで1つの取引として流れる(このファイルには begin / commit を書かない。確かめの SQL の取引の中でも流せるように)。
-- 流したあとは fourdb_migrations.applied から '0006_principal_pref.sql' の行を消す(消さないと、次の migrate で 0006 が流れない)。
-- もう一度流しても、表がなければ何もしない。
do $$
declare n bigint;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  if pg_catalog.to_regclass('fourdb.principal_pref') is null then
    raise notice '0006 down: fourdb.principal_pref はありません(何もしません)';
    return;
  end if;
  alter table fourdb.principal_pref no force row level security;
  perform pg_catalog.set_config('row_security', 'off', true);   -- まだ RLS がかかる接続なら、0 行と数えずにエラーで止める
  select count(*) into n from fourdb.principal_pref;
  if n > 0 and pg_catalog.current_setting('fourdb.discard_principal_pref', true) is distinct from n::text then
    raise exception '0006 down: fourdb.principal_pref に保存された設定が % 行あります。消さずに止めました(消すと決めたときは、取引の中で begin; set local fourdb.discard_principal_pref = ''%''; のあとにこの down を流し、commit; する)', n, n;
  end if;
  drop table fourdb.principal_pref;
  raise notice '0006 down: fourdb.principal_pref を外しました(% 行)', n;
end $$;
