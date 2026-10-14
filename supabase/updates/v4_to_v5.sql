-- =====================================================================
--  도란톡 업데이트: 버전 4 → 버전 5 (회원 탈퇴 · 방장 넘기기)
-- ---------------------------------------------------------------------
--  4단계까지 실행해 둔 DB에, 바뀐 부분만 더합니다. (처음 설치라면 schema.sql 전체를 실행)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 5" 가 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 9. (버전 5) 회원 탈퇴 · 방장 넘기기
-- ---------------------------------------------------------------------

-- 방장이 그룹을 나가거나 탈퇴하면, 가장 먼저 들어온 가족에게 방장을 자동으로 넘겨요
create or replace function public.handle_member_left()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  next_owner uuid;
begin
  if old.role <> 'owner' then
    return null;
  end if;
  -- 그룹 자체가 지워지는 중이면 할 일 없음
  if not exists (select 1 from public.family_groups g where g.id = old.group_id) then
    return null;
  end if;
  select m.user_id into next_owner
  from public.group_members m
  where m.group_id = old.group_id
  order by m.joined_at
  limit 1;
  if next_owner is not null then
    update public.group_members set role = 'owner'
    where group_id = old.group_id and user_id = next_owner;
    update public.family_groups set created_by = next_owner where id = old.group_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_member_left on public.group_members;
create trigger on_member_left
  after delete on public.group_members
  for each row execute function public.handle_member_left();

-- 탈퇴 전에 내가 올린 사진 파일 목록 (앱이 사진 창고에서 먼저 지우는 데 사용)
create or replace function public.my_photo_paths()
returns setof text
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'family-photos' and o.owner_id = auth.uid()::text;
$$;

-- 회원 탈퇴: 나 혼자 남은 그룹은 통째로 지우고, 내 계정을 지워요.
-- 계정이 지워지면 내 닉네임·글·댓글·하트·채팅·초대·멤버 기록이 연결된 규칙(cascade)으로 함께 지워져요.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;

  delete from public.family_groups g
  where exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
    and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id <> uid);

  delete from auth.users where id = uid;
end;
$$;

revoke execute on function
  public.handle_member_left(),
  public.my_photo_paths(),
  public.delete_my_account()
  from public, anon, authenticated;
grant execute on function public.my_photo_paths(), public.delete_my_account() to authenticated;

-- 사진 창고: 내가 올린 사진은 (그룹을 나간 뒤라도) 내가 보고 지울 수 있게 — 탈퇴할 때 사진 정리용
drop policy if exists "family_photos_select_owner" on storage.objects;
create policy "family_photos_select_owner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-photos'
    and owner_id = (select auth.uid())::text
  );

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 5 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 5" 가 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
