-- =====================================================================
--  도란톡 업데이트: 버전 10 → 버전 11 (프로필 사진 · 색)
-- ---------------------------------------------------------------------
--  내 정보에서 프로필 사진을 올리거나 동그라미 색을 고를 수 있게 해요.
--  사진은 같은 그룹 가족처럼 내 닉네임을 볼 수 있는 사람만 볼 수 있어요.
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 11" 이 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 14. (버전 11) 프로필 사진 · 색
--   - avatar_color: 이름 동그라미 색 (0~7번, 비워 두면 닉네임에 따라 자동)
--   - avatar_path : 프로필 사진 파일 경로 'avatars/{내 id}/{파일}' (사진 창고 family-photos 안)
--   - 프로필 사진은 내 닉네임을 볼 수 있는 사람(같은 그룹 · 초대 관계 등)만 볼 수 있어요.
--   - 사진은 내 폴더에만 올릴 수 있고, 지우기 · 탈퇴 정리는 기존 사진 규칙(내가 올린 것)을 그대로 써요.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_color smallint;
alter table public.profiles add column if not exists avatar_path text;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_color_range
    check (avatar_color between 0 and 7);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_path_own
    check (avatar_path is null
           or (avatar_path like 'avatars/' || id::text || '/%'
               and avatar_path !~ '\.\.' and avatar_path !~ '/.*/.*/' and length(avatar_path) <= 200));
exception when duplicate_object then null; end $$;
grant update (avatar_color, avatar_path) on public.profiles to authenticated;

-- 이 사람의 프로필 사진을 볼 수 있는지 (경로의 두 번째 칸 = 주인 id, 이상한 값이면 false)
create or replace function public.can_see_avatar(p_owner text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_owner ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_see_profile(p_owner::uuid)
    else false
  end;
$$;
revoke execute on function public.can_see_avatar(text) from public, anon, authenticated;
grant execute on function public.can_see_avatar(text) to authenticated;

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-photos'
    and (storage.foldername(name))[1] = 'avatars'
    and public.can_see_avatar((storage.foldername(name))[2])
  );

-- 올리기: avatars/{내 id}/{파일} 에만 (더 깊은 폴더 · 남의 폴더는 안 돼요)
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-photos'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
  );


-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 11 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 11" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
