-- 祖先の一覧(member_ancestor)に「祖先の段」(ancestor_level)を持たせる。元に戻すときは 0004_member_ancestor_level.down.sql。
-- 理由: 集計で「この軸の値の、段 L の祖先」を引くとき、段を dimension_member から引くと、データベースが段の側から
--       全件をなめる手順を選び、絞り込んだ少ない値でも遅かった(576 個で 5 秒以上)。(member_id, ancestor_level) の索引で1回で引く。
-- 軸の値の段は作ったあと変えられない(member_fixed トリガー)ので、写しても食い違わない。
-- 流し方: 必ず npm run fourdb:migrate か fourdb:setup-remote で、ファイル全体を1つの取引として流す。
--         途中で RLS の強制(FORCE)を外すので、SQL の画面で1文ずつ流して途中で止めると、外れたまま残る
--         (残った場合は、実行用の接続が assertSafeRole で止まる)。
begin;

alter table fourdb.member_ancestor add column ancestor_level smallint;

-- 書き写し(持ち主の接続で、行ごとの権限を一時的に外して全 workspace 分)
alter table fourdb.member_ancestor no force row level security;
alter table fourdb.dimension_member no force row level security;
update fourdb.member_ancestor a set ancestor_level = m.level from fourdb.dimension_member m where m.id = a.ancestor_id;
alter table fourdb.member_ancestor force row level security;
alter table fourdb.dimension_member force row level security;

alter table fourdb.member_ancestor alter column ancestor_level set not null;
create index member_ancestor_level on fourdb.member_ancestor (member_id, ancestor_level) include (ancestor_id);

-- 軸の値を作ったときに、祖先の段も入れる
create or replace function fourdb.member_after_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth, ancestor_level) values (new.workspace_id, new.id, new.id, 0, new.level);
  if new.parent_id is not null then
    insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth, ancestor_level)
    select new.workspace_id, new.id, a.ancestor_id, a.depth + 1, a.ancestor_level from fourdb.member_ancestor a where a.member_id = new.parent_id;
    if not found then
      raise exception '軸の値の親(%)の祖先の一覧がありません', new.parent_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function fourdb.member_after_insert() from public;

commit;
