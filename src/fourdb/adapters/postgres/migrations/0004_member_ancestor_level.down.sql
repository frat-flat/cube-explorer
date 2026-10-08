-- 0004_member_ancestor_level.sql を元に戻す(祖先の段の列と索引を外し、トリガーを 0001 の形に戻す)。
begin;
create or replace function fourdb.member_after_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth) values (new.workspace_id, new.id, new.id, 0);
  if new.parent_id is not null then
    insert into fourdb.member_ancestor (workspace_id, member_id, ancestor_id, depth)
    select new.workspace_id, new.id, a.ancestor_id, a.depth + 1 from fourdb.member_ancestor a where a.member_id = new.parent_id;
    if not found then
      raise exception '軸の値の親(%)の祖先の一覧がありません', new.parent_id;
    end if;
  end if;
  return new;
end $$;
drop index if exists fourdb.member_ancestor_level;
alter table fourdb.member_ancestor drop column if exists ancestor_level;
commit;
