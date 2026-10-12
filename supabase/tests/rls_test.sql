-- schema.sql 보안 규칙 자동 검사 (로컬 PostgreSQL + supabase_stub.sql 위에서 실행)
-- 실패하면 exception으로 멈춥니다. 마지막에 "ALL RLS TESTS PASSED" 출력.
\set ON_ERROR_STOP on

-- 사용자 4명: 엄마(A), 아빠(B), 딸(C, 초대 대기), 외부인(D)
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x.com', '{"nickname":"엄마"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'b@x.com', '{"nickname":"아빠"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'c@x.com', '{"nickname":"Daughter"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'd@x.com', '{"nickname":"stranger"}');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'TEST FAILED: %', msg; end if;
end $$;
create table pg_temp.ids (k text primary key, v uuid);
grant all on pg_temp.ids to authenticated;

do $$ begin
  -- 닉네임 중복 (대소문자 무시)
  begin
    insert into auth.users (email, raw_user_meta_data) values ('e@x.com', '{"nickname":"DAUGHTER"}');
    raise exception 'TEST FAILED: duplicate nickname accepted';
  exception when unique_violation then null; end;
  -- 닉네임 형식
  begin
    insert into auth.users (email, raw_user_meta_data) values ('f@x.com', '{"nickname":"a"}');
    raise exception 'TEST FAILED: short nickname accepted';
  exception when check_violation then null; end;
end $$;

-- anon: 닉네임 확인만 가능
set role anon;
select pg_temp.assert(public.is_nickname_available('새닉네임'), 'nickname available');
select pg_temp.assert(not public.is_nickname_available('daughter'), 'nickname taken (case-insensitive)');
select pg_temp.assert(not public.is_nickname_available('a b'), 'nickname invalid');
do $$ begin
  perform * from public.profiles;
  raise exception 'TEST FAILED: anon read profiles';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.create_group('x');
  raise exception 'TEST FAILED: anon created group';
exception when insufficient_privilege then null; end $$;
reset role;

-- 엄마가 그룹 생성
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into pg_temp.ids values ('g', public.create_group('우리 가족'));
select pg_temp.assert((select count(*) from public.family_groups) = 1, 'owner sees group');
select public.invite_by_nickname((select v from pg_temp.ids where k='g'), '아빠');
select public.invite_by_nickname((select v from pg_temp.ids where k='g'), 'daughter');
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='g'), '아빠');
  raise exception 'TEST FAILED: duplicate invite';
exception when raise_exception then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
end $$;
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='g'), '없는사람');
  raise exception 'TEST FAILED: invite unknown';
exception when raise_exception then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
end $$;
-- 글, 사진 경로
insert into public.posts (group_id, content, image_paths)
values ((select v from pg_temp.ids where k='g'), '첫 글', array[(select v from pg_temp.ids where k='g')::text || '/posts/a.jpg']);
insert into pg_temp.ids values ('p', (select id from public.posts limit 1));
insert into public.messages (group_id, content) values ((select v from pg_temp.ids where k='g'), '안녕');
insert into storage.objects (bucket_id, name) values ('family-photos', (select v from pg_temp.ids where k='g')::text || '/posts/a.jpg');
-- 작성자 위조 불가
do $$ begin
  insert into public.posts (group_id, content, author_id)
  values ((select v from pg_temp.ids where k='g'), '위조', 'aaaaaaaa-0000-0000-0000-000000000002');
  raise exception 'TEST FAILED: forged author';
exception when insufficient_privilege then null; end $$;
reset role;

-- 딸(초대만 받음): 그룹 내용 안 보임, 초대 목록은 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select pg_temp.assert((select count(*) from public.get_my_invitations()) = 1, 'invitee sees invitation');
select pg_temp.assert((select group_name from public.get_my_invitations()) = '우리 가족', 'invitation group name');
select pg_temp.assert((select inviter_nickname from public.get_my_invitations()) = '엄마', 'inviter nickname');
select pg_temp.assert((select count(*) from public.family_groups) = 0, 'invitee cannot see group');
select pg_temp.assert((select count(*) from public.posts) = 0, 'invitee cannot see posts');
select pg_temp.assert((select count(*) from public.messages) = 0, 'invitee cannot see messages');
select pg_temp.assert((select count(*) from public.group_members) = 0, 'invitee cannot see members');
select pg_temp.assert((select count(*) from storage.objects) = 0, 'invitee cannot see photos');
do $$ begin
  insert into public.posts (group_id, content) values ((select v from pg_temp.ids where k='g'), '침입');
  raise exception 'TEST FAILED: invitee posted';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('family-photos', (select v from pg_temp.ids where k='g')::text || '/posts/x.jpg');
  raise exception 'TEST FAILED: invitee uploaded';
exception when insufficient_privilege then null; end $$;
reset role;
-- 엄마가 보낸 초대 목록에서 대기 중인 사람 닉네임이 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.profiles where nickname in ('아빠', 'Daughter')) = 2, 'member sees pending invitee nicknames');
reset role;
-- 딸은 거절
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select public.respond_invitation((select id from public.get_my_invitations()), false);
select pg_temp.assert((select count(*) from public.get_my_invitations()) = 0, 'declined invite gone');
select pg_temp.assert((select count(*) from public.posts) = 0, 'declined still cannot see');
reset role;

-- 외부인: 아무것도 못 봄, 직접 멤버로 끼어들기 불가
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'stranger sees only self profile');
select pg_temp.assert((select count(*) from public.posts) = 0, 'stranger no posts');
select pg_temp.assert((select count(*) from public.group_invitations) = 0, 'stranger no invitations');
do $$ begin
  insert into public.group_members (group_id, user_id) values ((select v from pg_temp.ids where k='g'), 'aaaaaaaa-0000-0000-0000-000000000004');
  raise exception 'TEST FAILED: stranger joined';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='g'), 'stranger');
  raise exception 'TEST FAILED: stranger invited';
exception when raise_exception then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
end $$;
do $$ begin
  -- 남의 초대를 대신 수락 불가
  perform public.respond_invitation((select id from public.group_invitations limit 1), true);
  raise exception 'TEST FAILED: stranger accepted';
exception when raise_exception then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
end $$;
reset role;

-- 엄마가 딸을 다시 초대했다가 취소 → 딸에게 초대가 사라짐, 외부인은 취소 불가
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.invite_by_nickname((select v from pg_temp.ids where k='g'), 'Daughter');
insert into pg_temp.ids values ('inv2', (select id from public.group_invitations where status = 'pending' and invitee_id = 'aaaaaaaa-0000-0000-0000-000000000003'));
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000004');
do $$ begin
  perform public.cancel_invitation((select v from pg_temp.ids where k='inv2'));
  raise exception 'TEST FAILED: stranger canceled';
exception when raise_exception then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
end $$;
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.cancel_invitation((select v from pg_temp.ids where k='inv2'));
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select pg_temp.assert((select count(*) from public.get_my_invitations()) = 0, 'canceled invite gone');
reset role;

-- 아빠: 수락 후 모든 내용이 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.assert((select count(*) from public.posts) = 0, 'before accept no posts');
select pg_temp.assert((select count(*) from public.profiles) = 2, 'invitee sees inviter profile');
select public.respond_invitation((select id from public.get_my_invitations()), true);
select pg_temp.assert((select count(*) from public.posts) = 1, 'member sees posts');
select pg_temp.assert((select count(*) from public.messages) = 1, 'member sees old messages');
select pg_temp.assert((select count(*) from storage.objects) = 1, 'member sees photos');
select pg_temp.assert((select count(*) from public.group_members) = 2, 'member sees members');
-- 가입 전 메시지는 안 읽음으로 치지 않음
select pg_temp.assert((select unread from public.get_unread_counts()) = 0, 'old messages not unread');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.messages (group_id, content) values ((select v from pg_temp.ids where k='g'), '어서 와요');
select pg_temp.assert((select unread from public.get_unread_counts()) = 0, 'own message not unread');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.assert((select unread from public.get_unread_counts()) = 1, 'unread = 1');
select public.mark_chat_read((select v from pg_temp.ids where k='g'));
select pg_temp.assert((select unread from public.get_unread_counts()) = 0, 'unread = 0 after read');
-- 댓글/좋아요
insert into public.comments (post_id, content) values ((select v from pg_temp.ids where k='p'), '좋네요');
insert into public.post_likes (post_id) values ((select v from pg_temp.ids where k='p'));
-- 남의 글 수정/삭제 불가 (조용히 0건 처리)
update public.posts set content = '해킹' where id = (select v from pg_temp.ids where k='p');
delete from public.posts where id = (select v from pg_temp.ids where k='p');
-- 남의 사진 삭제 불가
delete from storage.objects;
reset role;
select pg_temp.assert((select content from public.posts) = '첫 글', 'other cannot edit post');
select pg_temp.assert((select count(*) from storage.objects) = 1, 'other cannot delete photo');

-- 엄마: 아빠 댓글 수정 불가, 자기 글 수정/삭제 가능
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.comments) = 1, 'owner sees comment');
select pg_temp.assert((select count(*) from public.post_likes) = 1, 'owner sees like');
update public.comments set content = '바꿈';
select pg_temp.assert((select content from public.comments) = '좋네요', 'cannot edit others comment');
update public.posts set content = '수정한 글' where id = (select v from pg_temp.ids where k='p');
select pg_temp.assert((select content from public.posts) = '수정한 글', 'author edits post');
do $$ begin
  update public.posts set group_id = gen_random_uuid();
  raise exception 'TEST FAILED: moved post group';
exception when insufficient_privilege then null; end $$;
delete from storage.objects;
select pg_temp.assert((select count(*) from storage.objects) = 0, 'owner deletes own photo');
delete from public.posts where id = (select v from pg_temp.ids where k='p');
select pg_temp.assert((select count(*) from public.posts) = 0, 'author deletes post');
reset role;

-- 아빠가 그룹을 나가면 다시 안 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
delete from public.group_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select pg_temp.assert((select count(*) from public.messages) = 0, 'left member sees nothing');
reset role;

select 'ALL RLS TESTS PASSED' as result;
