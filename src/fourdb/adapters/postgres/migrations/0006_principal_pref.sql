-- アカウント(principal)ごとの設定: 明暗・World・ホームの見た目(D-017)。1 アカウント 1 行。元に戻すときは 0006_principal_pref.down.sql。
-- workspace ではなく principal(入れ物が決める、変わらない利用者の印)ごとに持つ。どのパソコンでも同じ見た目にするため。
-- 守り方: 行ごとの権限(RLS)を強制し、「今の処理の利用者」(fourdb.current_principal()。0001 で定めたもの)の行だけを読み書きできる。
--         つなぎ(adapters/postgres/prefs.ts)は SQL のパラメータでも principal を絞る(RLS は重ねの守り)。
--         新しい設定(GUC)・SECURITY DEFINER の関数は作らない。実行用の役割への権限は入れ物が渡す(setup-remote・試験の grantApp)。
-- 中身の意味:
--   theme  明暗。null = パソコンの設定に合わせる
--   world  まわりの世界の id(P2 は plain だけ。P5 で増える)
--   look   ホームの見た目の部品(形・向き・台座・札・背景・並べ方)。中身の確かめ(許可リスト)は芯(core/prefs)が行い、表は形と大きさだけを見る
-- 流し方: 新しい表を作るだけで、ほかの表は押さえない。もう一度流すと「すでにある」で止まり、何も変わらない。
begin;
set local lock_timeout = '5s';

create table fourdb.principal_pref (
  principal text primary key check (length(principal) between 1 and 200),
  theme text check (theme in ('dark', 'light')),
  world text not null default 'plain' check (world ~ '^[a-z][a-z0-9_-]{0,31}$'),
  look jsonb not null default '{}' check (jsonb_typeof(look) = 'object' and pg_column_size(look) <= 2048),
  updated_at timestamptz not null default now()
);

alter table fourdb.principal_pref enable row level security;
alter table fourdb.principal_pref force row level security;
create policy principal_scope on fourdb.principal_pref
  using (principal = (select fourdb.current_principal()))
  with check (principal = (select fourdb.current_principal()));
revoke all on fourdb.principal_pref from public;

commit;
