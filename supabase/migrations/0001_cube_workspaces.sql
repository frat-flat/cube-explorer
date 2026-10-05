-- ダッシュボード(軸の辞書と箱)の中身を、ログインした人(メールアドレス)ごとに1件で持つ。
-- 読み書きはアプリのサーバーが秘密の鍵で行う。RLS をオンにして方針を置かないので、公開用の鍵からは見えない。
create table if not exists public.cube_workspaces (
  owner text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.cube_workspaces enable row level security;
revoke all on public.cube_workspaces from anon, authenticated;
