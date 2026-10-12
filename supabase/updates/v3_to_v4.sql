-- =====================================================================
--  TalkFeed 업데이트: 버전 3 → 버전 4 (4단계: 소식·사진·댓글·하트)
-- ---------------------------------------------------------------------
--  3단계까지 schema.sql 을 실행해 둔 DB에, 4단계에서 바뀐 부분만 더합니다.
--  (처음 설치라면 이 파일 대신 schema.sql 전체를 실행하세요)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 4" 가 보이면 성공.
-- =====================================================================

-- 1) 사진 경로 규칙: 글/채팅 사진은 반드시 자기 그룹 폴더 안에만
create or replace function public.paths_in_group_folder(paths text[], gid uuid, folder text)
returns boolean
language sql immutable set search_path = ''
as $$
  select not exists (
    select 1 from unnest(coalesce(paths, '{}')) as p
    where p not like gid::text || '/' || folder || '/%' or p like '%..%'
  );
$$;

alter table public.posts drop constraint if exists posts_image_paths_in_group;
alter table public.posts add constraint posts_image_paths_in_group
  check (public.paths_in_group_folder(image_paths, group_id, 'posts')) not valid;
alter table public.messages drop constraint if exists messages_image_path_in_group;
alter table public.messages add constraint messages_image_path_in_group
  check (image_path is null or public.paths_in_group_folder(array[image_path], group_id, 'chat')) not valid;

-- 닉네임 보기 규칙(아래 can_see_profile)이 빨리 동작하도록 색인 추가
create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists messages_sender_idx on public.messages (sender_id);

-- 2) 닉네임 보기 규칙: 그룹을 떠난 가족이 남긴 글·댓글·채팅의 닉네임도 보이게
create or replace function public.can_see_profile(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target = auth.uid()
  or exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = target
  )
  or exists (
    select 1 from public.group_invitations i
    where (i.invitee_id = auth.uid() and i.inviter_id = target)
       or (i.inviter_id = auth.uid() and i.invitee_id = target)
  )
  or exists (
    select 1 from public.group_invitations i
    join public.group_members m on m.group_id = i.group_id
    where m.user_id = auth.uid() and i.invitee_id = target and i.status = 'pending'
  )
  or exists (
    select 1 from public.posts p
    join public.group_members m on m.group_id = p.group_id
    where m.user_id = auth.uid() and p.author_id = target
  )
  or exists (
    select 1 from public.comments c
    join public.posts p on p.id = c.post_id
    join public.group_members m on m.group_id = p.group_id
    where m.user_id = auth.uid() and c.author_id = target
  )
  or exists (
    select 1 from public.messages msg
    join public.group_members m on m.group_id = msg.group_id
    where m.user_id = auth.uid() and msg.sender_id = target
  );
$$;

-- 3) 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 4 $$;

-- 4) 실행 권한
revoke execute on function public.paths_in_group_folder(text[], uuid, text) from public, anon;
grant execute on function public.paths_in_group_folder(text[], uuid, text) to authenticated;
revoke execute on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;
revoke execute on function public.talkfeed_schema_version() from public;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 5) 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 4" 가 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
