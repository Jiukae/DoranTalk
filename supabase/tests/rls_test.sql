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
-- 사진 경로는 자기 그룹 폴더만
do $$ begin
  insert into public.posts (group_id, content, image_paths)
  values ((select v from pg_temp.ids where k='g'), '남의 폴더', array['00000000-0000-0000-0000-000000000000/posts/x.jpg']);
  raise exception 'TEST FAILED: foreign folder path accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.posts (group_id, content, image_paths)
  values ((select v from pg_temp.ids where k='g'), '상위폴더', array[(select v from pg_temp.ids where k='g')::text || '/posts/../../x.jpg']);
  raise exception 'TEST FAILED: dotdot path accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.messages (group_id, image_path)
  values ((select v from pg_temp.ids where k='g'), (select v from pg_temp.ids where k='g')::text || '/posts/a.jpg');
  raise exception 'TEST FAILED: chat image outside chat folder accepted';
exception when check_violation then null; end $$;
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
-- (버전 7부터는 거절당한 지 3일이 지나야 다시 초대할 수 있어서, 거절 시각을 4일 전으로)
update public.group_invitations set responded_at = now() - interval '4 days'
  where invitee_id = 'aaaaaaaa-0000-0000-0000-000000000003' and status = 'declined';
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
-- 떠난 아빠가 남긴 댓글의 닉네임은 엄마에게 계속 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.posts (group_id, content) values ((select v from pg_temp.ids where k='g'), '두 번째 글');
reset role;
insert into public.comments (post_id, author_id, content)
  select id, 'aaaaaaaa-0000-0000-0000-000000000002', '예전 댓글' from public.posts where content = '두 번째 글';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.profiles where nickname = '아빠') = 1, 'left author nickname visible');
reset role;
-- 외부인에게는 여전히 안 보임
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select pg_temp.assert((select count(*) from public.profiles where nickname = '아빠') = 0, 'stranger cannot see author');
reset role;

-- ===== 버전 5: 회원 탈퇴 · 방장 넘기기 =====
-- 딸을 그룹 멤버로 넣고, 엄마·딸이 각자 사진을 올림
insert into public.group_members (group_id, user_id, role, joined_at)
  values ((select v from pg_temp.ids where k='g'), 'aaaaaaaa-0000-0000-0000-000000000003', 'member', now());
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name) values ('family-photos', (select v from pg_temp.ids where k='g')::text || '/posts/mom1.jpg');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
insert into storage.objects (bucket_id, name) values ('family-photos', (select v from pg_temp.ids where k='g')::text || '/chat/kid1.jpg');
reset role;

-- 내 사진 목록에는 내 것만
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.my_photo_paths()) = 1, 'my_photo_paths only mine');
select pg_temp.assert((select bool_and(p like '%mom1.jpg') from public.my_photo_paths() p), 'my_photo_paths is mom photo');
reset role;
-- 외부인은 여전히 아무 사진도 못 봄 (내 것 보기 규칙이 남의 것을 보여 주지 않음)
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select pg_temp.assert((select count(*) from storage.objects) = 0, 'stranger still sees no photos');
select pg_temp.assert((select count(*) from public.my_photo_paths()) = 0, 'stranger has no photos');
-- 외부인이 혼자 그룹을 만든 뒤 탈퇴 → 그 그룹은 통째로 삭제
insert into pg_temp.ids values ('solo', public.create_group('혼자 그룹'));
select public.delete_my_account();
reset role;
select pg_temp.assert((select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000004') = 0, 'stranger account deleted');
select pg_temp.assert((select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000004') = 0, 'stranger profile deleted');
select pg_temp.assert((select count(*) from public.family_groups where id = (select v from pg_temp.ids where k='solo')) = 0, 'solo group deleted');

-- 방장 엄마가 탈퇴 → 그룹은 남고, 딸이 방장이 됨. 엄마 글·채팅·멤버 기록은 삭제
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.delete_my_account();
reset role;
select pg_temp.assert((select count(*) from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'mom account deleted');
select pg_temp.assert((select count(*) from public.posts where author_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'mom posts deleted');
select pg_temp.assert((select count(*) from public.messages where sender_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'mom messages deleted');
select pg_temp.assert((select count(*) from public.family_groups where id = (select v from pg_temp.ids where k='g')) = 1, 'group kept');
select pg_temp.assert((select role from public.group_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003') = 'owner', 'daughter promoted to owner');
select pg_temp.assert((select created_by from public.family_groups where id = (select v from pg_temp.ids where k='g')) = 'aaaaaaaa-0000-0000-0000-000000000003', 'created_by moved to daughter');

-- 방장 딸이 그냥 나가도 다음 가족(아빠)에게 넘어감
insert into public.group_members (group_id, user_id, role, joined_at)
  values ((select v from pg_temp.ids where k='g'), 'aaaaaaaa-0000-0000-0000-000000000002', 'member', now() + interval '1 minute');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
delete from public.group_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
reset role;
select pg_temp.assert((select role from public.group_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'owner', 'dad promoted after owner left');
select pg_temp.assert((select created_by from public.family_groups where id = (select v from pg_temp.ids where k='g')) = 'aaaaaaaa-0000-0000-0000-000000000002', 'created_by moved to dad');

-- 로그인 안 한 사람은 탈퇴 함수를 못 씀
set role anon;
do $$ begin
  perform public.delete_my_account();
  raise exception 'TEST FAILED: anon delete_my_account';
exception when insufficient_privilege then null; end $$;
reset role;

-- ===== 버전 6: 휴대폰 알림 =====
-- 새 가족: 할머니(P1, 방장) · 할아버지(P2, 기기 2대) · 손주(P3) · 이웃(P4, 그룹 밖)
insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'p1@x.com', '{"nickname":"할머니"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'p2@x.com', '{"nickname":"할아버지"}'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'p3@x.com', '{"nickname":"손주"}'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'p4@x.com', '{"nickname":"이웃"}');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into pg_temp.ids values ('pg', public.create_group('시골집'));
select public.invite_by_nickname((select v from pg_temp.ids where k='pg'), '할아버지');
select public.invite_by_nickname((select v from pg_temp.ids where k='pg'), '손주');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select public.respond_invitation((select id from public.get_my_invitations() limit 1), true);
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000003');
select public.respond_invitation((select id from public.get_my_invitations() limit 1), true);
reset role;

-- 로그인 안 한 사람은 알림 함수를 못 씀, 로그인한 사람도 표를 직접 못 읽음
set role anon;
do $$ begin
  perform public.push_subscribe('https://fcm.googleapis.com/fcm/send/x', repeat('a', 87), repeat('b', 22));
  raise exception 'TEST FAILED: anon push_subscribe';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform * from public.push_targets('test');
  raise exception 'TEST FAILED: anon push_targets';
exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
do $$ begin
  perform * from public.push_subscriptions;
  raise exception 'TEST FAILED: user read push_subscriptions table';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.unread_total_for('bbbbbbbb-0000-0000-0000-000000000001');
  raise exception 'TEST FAILED: user called unread_total_for';
exception when insufficient_privilege then null; end $$;
-- 주소 형식 검사 (https 만)
do $$ begin
  perform public.push_subscribe('http://evil.local/x', repeat('a', 87), repeat('b', 22));
  raise exception 'TEST FAILED: http endpoint accepted';
exception when check_violation then null; end $$;
reset role;

-- 기기 등록: 할머니 1대, 할아버지 2대, 손주 1대, 이웃 1대
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/p1', repeat('a', 87), repeat('b', 22), 'Android');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/p2a', repeat('a', 87), repeat('b', 22), 'Android');
select public.push_subscribe('https://web.push.apple.com/p2b', repeat('a', 87), repeat('b', 22), 'iPhone');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000003');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/p3', repeat('a', 87), repeat('b', 22));
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000004');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/p4', repeat('a', 87), repeat('b', 22));
reset role;
select pg_temp.assert((select count(*) from public.push_subscriptions where user_id::text like 'bbbbbbbb%') = 5, 'five devices registered');

-- 채팅: 할머니가 보내면 할아버지(2대) + 손주(1대)에게만, 같은 메시지로는 한 번만
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.messages (group_id, content) values ((select v from pg_temp.ids where k='pg'), '저녁 먹었니?');
insert into pg_temp.ids values ('pm', (select id from public.messages where content = '저녁 먹었니?'));
create temp table pt as select * from public.push_targets('message', (select v from pg_temp.ids where k='pm'));
select pg_temp.assert((select count(*) from pt) = 3, 'message → 3 devices');
select pg_temp.assert(not exists (select 1 from pt where endpoint in ('https://fcm.googleapis.com/fcm/send/p1', 'https://fcm.googleapis.com/fcm/send/p4')), 'not sender, not outsider');
select pg_temp.assert((select min(title) from pt) = '시골집 · 할머니', 'message title');
select pg_temp.assert((select min(body) from pt) = '저녁 먹었니?', 'message body');
select pg_temp.assert((select min(url) from pt) = '/#/group/' || (select v from pg_temp.ids where k='pg') || '/chat', 'message url');
select pg_temp.assert((select min(badge) from pt) = 1, 'unread badge 1');
select pg_temp.assert((select count(*) from public.push_targets('message', (select v from pg_temp.ids where k='pm'))) = 0, 'message only once');
reset role;
-- 보낸 사람이 아니면 / 그룹 밖이면 / 오래된 메시지면 아무에게도 안 감
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000004');
select pg_temp.assert((select count(*) from public.push_targets('message', (select v from pg_temp.ids where k='pm'))) = 0, 'outsider gets nothing');
reset role;
insert into public.messages (group_id, sender_id, content, created_at)
  values ((select v from pg_temp.ids where k='pg'), 'bbbbbbbb-0000-0000-0000-000000000001', '옛날 메시지', now() - interval '1 hour');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.push_targets('message', (select id from public.messages where content = '옛날 메시지'))) = 0, 'old message not pushed');
-- 사진 메시지는 "사진을 보냈어요"
insert into public.messages (group_id, image_path) values ((select v from pg_temp.ids where k='pg'), (select v from pg_temp.ids where k='pg') || '/chat/a.jpg');
select pg_temp.assert((select min(body) from public.push_targets('message', (select id from public.messages where image_path like '%/chat/a.jpg'))) = '사진을 보냈어요 📷', 'photo message body');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.assert((select count(*) from public.push_targets('message', (select v from pg_temp.ids where k='pm'))) = 0, 'non-sender gets nothing');
reset role;

-- 새 소식: 할머니 글 → 할아버지 2대 + 손주 1대
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.posts (group_id, content) values ((select v from pg_temp.ids where k='pg'), '텃밭에 상추가 잘 자라요');
insert into pg_temp.ids values ('pp', (select id from public.posts where content = '텃밭에 상추가 잘 자라요'));
drop table pt;
create temp table pt as select * from public.push_targets('post', (select v from pg_temp.ids where k='pp'));
select pg_temp.assert((select count(*) from pt) = 3, 'post → 3 devices');
select pg_temp.assert((select min(body) from pt) = '할머니: 텃밭에 상추가 잘 자라요', 'post body');
select pg_temp.assert((select min(title) from pt) = '시골집 · 새 소식', 'post title');
reset role;

-- 댓글: 할아버지 댓글 → 글쓴이 할머니(1대)만 / 손주 댓글 → 할머니 + 할아버지(2대)
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.comments (post_id, content) values ((select v from pg_temp.ids where k='pp'), '맛있겠다');
select pg_temp.assert((select count(*) from public.push_targets('comment', (select id from public.comments where content = '맛있겠다'))) = 1, 'comment → post author');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000003');
insert into public.comments (post_id, content) values ((select v from pg_temp.ids where k='pp'), '저도 먹고 싶어요');
drop table pt;
create temp table pt as select * from public.push_targets('comment', (select id from public.comments where content = '저도 먹고 싶어요'));
select pg_temp.assert((select count(*) from pt) = 3, 'comment → author + other commenter');
select pg_temp.assert((select min(body) from pt) = '손주: 저도 먹고 싶어요', 'comment body');
reset role;

-- 초대: 할머니가 이웃을 초대 → 이웃 기기 1대에만, 한 번만
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select public.invite_by_nickname((select v from pg_temp.ids where k='pg'), '이웃');
drop table pt;
create temp table pt as select * from public.push_targets('invite', (select v from pg_temp.ids where k='pg'));
select pg_temp.assert((select count(*) from pt) = 1 and (select min(endpoint) from pt) = 'https://fcm.googleapis.com/fcm/send/p4', 'invite → invitee');
select pg_temp.assert((select count(*) from public.push_targets('invite', (select v from pg_temp.ids where k='pg'))) = 0, 'invite only once');
reset role;
-- 다른 사람은 남의 그룹 이름으로 초대 알림을 못 만듦
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000004');
select pg_temp.assert((select count(*) from public.push_targets('invite', (select v from pg_temp.ids where k='pg'))) = 0, 'invite by non-inviter');
reset role;

-- 시험 알림: 내 기기(할아버지 2대)로만, 30초에 한 번
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.assert((select count(*) from public.push_targets('test')) = 2, 'test → my devices');
select pg_temp.assert((select count(*) from public.push_targets('test')) = 0, 'test rate limited');
select pg_temp.assert((select count(*) from public.push_targets('nonsense', gen_random_uuid())) = 0, 'unknown kind');
reset role;

-- 지우기: 그룹 밖 사람은 남의 주소를 못 지움, 같은 가족은 (알림 서버가 '없는 주소'라고 하면) 지울 수 있음
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000004');
select public.push_forget(array['https://fcm.googleapis.com/fcm/send/p2a']);
reset role;
select pg_temp.assert(exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/p2a'), 'outsider cannot forget');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000001');
select public.push_forget(array['https://fcm.googleapis.com/fcm/send/p2a']);
reset role;
select pg_temp.assert(not exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/p2a'), 'family member forgets gone endpoint');
-- 알림 끄기는 내 기기만
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000003');
select public.push_unsubscribe('https://web.push.apple.com/p2b');
select public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/p3');
reset role;
select pg_temp.assert(exists (select 1 from public.push_subscriptions where endpoint = 'https://web.push.apple.com/p2b'), 'cannot unsubscribe others');
select pg_temp.assert(not exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/p3'), 'unsubscribe own');
-- 탈퇴하면 기기 등록도 함께 지워짐
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000004');
select public.delete_my_account();
reset role;
select pg_temp.assert(not exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/p4'), 'deleted account devices removed');

-- ===== 버전 7: 공개 준비 (초대 · 그룹 만들기 제한) =====
insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-000000000001', 'q1@x.com', '{"nickname":"큐원"}'),
  ('dddddddd-0000-0000-0000-000000000002', 'q2@x.com', '{"nickname":"큐투"}');
-- 그룹 만들기: 하루 5개까지
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001');
select public.create_group('그룹' || n) from generate_series(1, 5) n;
do $$ begin
  perform public.create_group('여섯째');
  raise exception 'TEST FAILED: 6th group in a day';
exception when raise_exception then
  if sqlerrm not like '%하루에 5개%' then raise; end if;
end $$;
reset role;
-- 어제 만든 것으로 바꾸면 다시 만들 수 있음 / 들어가 있는 그룹 20개까지
update public.family_groups set created_at = now() - interval '2 days' where created_by = 'dddddddd-0000-0000-0000-000000000001';
insert into public.family_groups (id, name, created_by, created_at)
  select gen_random_uuid(), '옛그룹' || n, 'dddddddd-0000-0000-0000-000000000002', now() - interval '10 days' from generate_series(1, 15) n;
insert into public.group_members (group_id, user_id, role)
  select id, 'dddddddd-0000-0000-0000-000000000001', 'member' from public.family_groups where name like '옛그룹%';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001');
do $$ begin
  perform public.create_group('스물한째');
  raise exception 'TEST FAILED: more than 20 groups';
exception when raise_exception then
  if sqlerrm not like '%20개까지%' then raise; end if;
end $$;
reset role;

-- 초대 제한용 그룹 (큐투가 방장)
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002');
insert into pg_temp.ids values ('qg', public.create_group('큐네'));
reset role;
-- 거절당한 지 3일 안에는 다시 초대 못 함, 3일 지나면 가능
insert into public.group_invitations (group_id, inviter_id, invitee_id, status, responded_at)
  values ((select v from pg_temp.ids where k='qg'), 'dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'declined', now() - interval '1 day');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002');
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='qg'), '손주');
  raise exception 'TEST FAILED: re-invite right after decline';
exception when raise_exception then
  if sqlerrm not like '%최근에 이 초대를 거절%' then raise; end if;
end $$;
reset role;
update public.group_invitations set responded_at = now() - interval '4 days'
  where group_id = (select v from pg_temp.ids where k='qg') and status = 'declined';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002');
select public.invite_by_nickname((select v from pg_temp.ids where k='qg'), '손주');
reset role;
select pg_temp.assert((select count(*) from public.group_invitations where group_id = (select v from pg_temp.ids where k='qg') and status = 'pending') = 1, 're-invite after 3 days');

-- 대기 중 초대 20개까지 / 한 그룹 50명까지 / 하루 30번까지
insert into auth.users (email, raw_user_meta_data)
  select 'm' || n || '@x.com', json_build_object('nickname', 'mem' || lpad(n::text, 2, '0'))::jsonb from generate_series(1, 60) n;
insert into public.group_invitations (group_id, inviter_id, invitee_id)
  select (select v from pg_temp.ids where k='qg'), 'dddddddd-0000-0000-0000-000000000002', p.id
  from public.profiles p where p.nickname between 'mem01' and 'mem19';
reset role;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002');
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='qg'), 'mem20');
  raise exception 'TEST FAILED: more than 20 pending';
exception when raise_exception then
  if sqlerrm not like '%대기 중인 초대%' then raise; end if;
end $$;
reset role;
delete from public.group_invitations where group_id = (select v from pg_temp.ids where k='qg') and invitee_id in (select id from public.profiles where nickname like 'mem%');
-- 멤버 49명 + 손주 대기 1 = 50 → 더는 초대 못 함
insert into public.group_members (group_id, user_id, role)
  select (select v from pg_temp.ids where k='qg'), p.id, 'member' from public.profiles p where p.nickname between 'mem01' and 'mem48';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002');
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='qg'), 'mem55');
  raise exception 'TEST FAILED: more than 50 in group';
exception when raise_exception then
  if sqlerrm not like '%50명까지%' then raise; end if;
end $$;
reset role;
-- 꽉 찬 그룹(50명)은 초대를 받아도 수락 못 함
insert into public.group_members (group_id, user_id, role)
  select (select v from pg_temp.ids where k='qg'), p.id, 'member' from public.profiles p where p.nickname = 'mem49';
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000003');
do $$ begin
  perform public.respond_invitation((select i.id from public.group_invitations i where i.invitee_id = 'bbbbbbbb-0000-0000-0000-000000000003' and i.status = 'pending' and i.group_id = (select v from pg_temp.ids where k='qg')), true);
  raise exception 'TEST FAILED: accepted into full group';
exception when raise_exception then
  if sqlerrm not like '%꽉 찼어요%' then raise; end if;
end $$;
-- 거절은 할 수 있음
select public.respond_invitation((select i.id from public.group_invitations i where i.invitee_id = 'bbbbbbbb-0000-0000-0000-000000000003' and i.status = 'pending' and i.group_id = (select v from pg_temp.ids where k='qg')), false);
reset role;
-- 하루 30번: 오늘 보낸 초대 30개가 이미 있으면 더는 못 보냄
delete from public.group_members where user_id = 'dddddddd-0000-0000-0000-000000000001'
  and group_id in (select id from public.family_groups where name like '옛그룹%');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001');
insert into pg_temp.ids values ('qg1', public.create_group('큐원네'));
reset role;
update public.family_groups set created_at = now() - interval '2 days' where id = (select v from pg_temp.ids where k='qg1');
insert into public.group_invitations (group_id, inviter_id, invitee_id, status, responded_at)
  select (select v from pg_temp.ids where k='qg1'), 'dddddddd-0000-0000-0000-000000000001', p.id, 'canceled', now()
  from public.profiles p where p.nickname between 'mem01' and 'mem30';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001');
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='qg1'), 'mem31');
  raise exception 'TEST FAILED: more than 30 invites a day';
exception when raise_exception then
  if sqlerrm not like '%하루에 30번%' then raise; end if;
end $$;
reset role;

-- =====================================================================
-- (버전 8) 만 14세 미만: 보호자 동의로 가입
-- =====================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'g1@x.com', '{"nickname":"보호자엄마"}'),
  ('cccccccc-0000-0000-0000-000000000002', 'g2@x.com', '{"nickname":"이웃어른"}');

-- 비밀번호 확인 시각(amr)을 넣은 로그인 흉내 (ago: 몇 초 전에 비밀번호로 로그인했는지, null 이면 기록 없음)
create or replace function pg_temp.as_user_pw(uid text, ago int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', case when ago is null
    then json_build_object('sub', uid, 'role', 'authenticated')::text
    else json_build_object('sub', uid, 'role', 'authenticated',
      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - ago)))::text end, false);
  execute 'set role authenticated';
end $$;

-- 비밀번호 확인 없이 / 오래전 확인으로는 링크를 못 만듦
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
do $$ begin
  perform public.create_guardian_link('2026-10-14');
  raise exception 'TEST FAILED: guardian link without password check';
exception when raise_exception then
  if sqlerrm not like '%비밀번호를 다시%' then raise; end if;
end $$;
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', 1200);
do $$ begin
  perform public.create_guardian_link('2026-10-14');
  raise exception 'TEST FAILED: guardian link with stale password check';
exception when raise_exception then
  if sqlerrm not like '%비밀번호를 다시%' then raise; end if;
end $$;
-- 방금 비밀번호를 확인했으면 OK
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', 30);
insert into pg_temp.ids select 'gl1', null;
create table pg_temp.toks (k text primary key, v text);
grant all on pg_temp.toks to authenticated, anon;
insert into pg_temp.toks select 't1', token from public.create_guardian_link('2026-10-14');
insert into pg_temp.toks select 't2', token from public.create_guardian_link('2026-10-14');
select pg_temp.assert((select count(*) from public.my_guardian_links()) = 2, 'guardian sees 2 unused links');
select pg_temp.assert(length((select v from pg_temp.toks where k='t1')) = 32, 'token is 32 chars');
-- 표를 직접 읽을 수 없음
do $$ begin
  perform * from public.guardian_consents;
  raise exception 'TEST FAILED: authenticated read guardian_consents';
exception when insufficient_privilege then null; end $$;
-- 보호자 그룹
insert into pg_temp.ids values ('gg', public.create_group('보호자네'));
reset role;

-- 로그인 전(anon): 링크 확인
set role anon;
select pg_temp.assert((select status from public.guardian_link_info((select v from pg_temp.toks where k='t1'))) = 'ok', 'link ok');
select pg_temp.assert((select guardian_nickname from public.guardian_link_info((select v from pg_temp.toks where k='t1'))) = '보호자엄마', 'link shows guardian nickname');
select pg_temp.assert((select status from public.guardian_link_info('nope')) = 'not_found', 'unknown link');
do $$ begin
  perform * from public.guardian_consents;
  raise exception 'TEST FAILED: anon read guardian_consents';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.my_children();
  raise exception 'TEST FAILED: anon my_children';
exception when insufficient_privilege then null; end $$;
reset role;

-- 가입: 링크 없이 "만 14세 미만"이면 거절
do $$ begin
  insert into auth.users (email, raw_user_meta_data) values ('k0@x.com', '{"nickname":"꼬마영","under_14_with_guardian":true}');
  raise exception 'TEST FAILED: child signup without link';
exception when raise_exception then
  if sqlerrm not like '%가입 링크로%' then raise; end if;
end $$;
-- 링크로 가입 성공
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000011', 'k1@x.com',
   json_build_object('nickname', '꼬마일', 'under_14_with_guardian', true, 'guardian_token', (select v from pg_temp.toks where k='t1'))::jsonb);
select pg_temp.assert(public.is_child_account('cccccccc-0000-0000-0000-000000000011'), 'child account linked');
select pg_temp.assert((select status from public.guardian_link_info((select v from pg_temp.toks where k='t1'))) = 'used', 'link used');
-- 같은 링크로 두 번은 안 됨
do $$ begin
  insert into auth.users (email, raw_user_meta_data) values ('k2@x.com',
    json_build_object('nickname', '꼬마이', 'under_14_with_guardian', true, 'guardian_token', (select v from pg_temp.toks where k='t1'))::jsonb);
  raise exception 'TEST FAILED: link reused';
exception when raise_exception then
  if sqlerrm not like '%만료되었거나 이미 사용%' then raise; end if;
end $$;
select pg_temp.assert(not exists (select 1 from auth.users where email = 'k2@x.com'), 'reused link left no account');
-- 만료된 링크도 안 됨
update public.guardian_consents set expires_at = now() - interval '1 minute' where token = (select v from pg_temp.toks where k='t2');
do $$ begin
  insert into auth.users (email, raw_user_meta_data) values ('k3@x.com',
    json_build_object('nickname', '꼬마삼', 'under_14_with_guardian', true, 'guardian_token', (select v from pg_temp.toks where k='t2'))::jsonb);
  raise exception 'TEST FAILED: expired link';
exception when raise_exception then
  if sqlerrm not like '%만료되었거나 이미 사용%' then raise; end if;
end $$;
select pg_temp.assert((select status from public.guardian_link_info((select v from pg_temp.toks where k='t2'))) = 'expired', 'link expired');

-- 아이: 그룹을 직접 만들 수 없고, 보호자가 될 수 없음, 내 보호자는 보임
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000011', 10);
do $$ begin
  perform public.create_group('아이그룹');
  raise exception 'TEST FAILED: child created group';
exception when raise_exception then
  if sqlerrm not like '%직접 만들 수 없어요%' then raise; end if;
end $$;
do $$ begin
  perform public.create_guardian_link('2026-10-14');
  raise exception 'TEST FAILED: child became guardian';
exception when raise_exception then
  if sqlerrm not like '%보호자가 될 수 없어요%' then raise; end if;
end $$;
select pg_temp.assert((select guardian_nickname from public.my_guardian_info()) = '보호자엄마', 'child sees guardian');
select pg_temp.assert((select count(*) from public.my_children()) = 0, 'child has no children');
reset role;

-- 모르는 어른: 보호자가 없는 그룹으로는 아이를 초대할 수 없음 (아이 계정인지도 알 수 없게 "찾을 수 없어요")
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000002', null);
insert into pg_temp.ids values ('xg', public.create_group('이웃네'));
do $$ begin
  perform public.invite_by_nickname((select v from pg_temp.ids where k='xg'), '꼬마일');
  raise exception 'TEST FAILED: stranger invited child';
exception when raise_exception then
  if sqlerrm not like '%찾을 수 없어요%' then raise; end if;
end $$;
select pg_temp.assert((select count(*) from public.my_children()) = 0, 'stranger sees no children');
select pg_temp.assert((select count(*) from public.child_photo_paths('cccccccc-0000-0000-0000-000000000011')) = 0, 'stranger no child photo paths');
do $$ begin
  perform public.delete_child_account('cccccccc-0000-0000-0000-000000000011');
  raise exception 'TEST FAILED: stranger deleted child';
exception when raise_exception then
  if sqlerrm not like '%자녀 계정만%' then raise; end if;
end $$;
do $$ begin
  perform public.cancel_guardian_link((select id from public.guardian_consents limit 1));
  raise exception 'TEST FAILED: stranger read consents';
exception when insufficient_privilege then null; end $$;
-- 보호자를 먼저 초대
select public.invite_by_nickname((select v from pg_temp.ids where k='xg'), '보호자엄마');
reset role;

-- 보호자: 자기 그룹에 아이 초대 → 아이 수락
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
select public.invite_by_nickname((select v from pg_temp.ids where k='gg'), '꼬마일');
select pg_temp.assert((select count(*) from public.my_children()) = 1, 'guardian sees child');
select pg_temp.assert((select nickname from public.my_children()) = '꼬마일', 'guardian sees child nickname');
-- 이웃 그룹 초대 수락
select public.respond_invitation((select id from public.get_my_invitations() where group_name = '이웃네'), true);
reset role;
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000011', null);
select public.respond_invitation((select id from public.get_my_invitations() where group_name = '보호자네'), true);
select pg_temp.assert(public.is_group_member((select v from pg_temp.ids where k='gg')), 'child joined guardian group');
-- 아이가 사진을 올림
insert into storage.objects (bucket_id, name)
  values ('family-photos', (select v from pg_temp.ids where k='gg')::text || '/posts/kid1.jpg');
reset role;

-- 이제 보호자가 있는 이웃 그룹이라면 초대할 수 있음
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000002', null);
select public.invite_by_nickname((select v from pg_temp.ids where k='xg'), '꼬마일');
reset role;
-- 그런데 아이가 수락하기 전에 보호자가 그 그룹을 나가면 수락할 수 없음
delete from public.group_members where group_id = (select v from pg_temp.ids where k='xg') and user_id = 'cccccccc-0000-0000-0000-000000000001';
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000011', null);
do $$ begin
  perform public.respond_invitation((select id from public.get_my_invitations() where group_name = '이웃네'), true);
  raise exception 'TEST FAILED: child joined group without guardian';
exception when raise_exception then
  if sqlerrm not like '%보호자가 이 그룹에 없어서%' then raise; end if;
end $$;
-- 거절은 됨
select public.respond_invitation((select id from public.get_my_invitations() where group_name = '이웃네'), false);
reset role;

-- 사진 창고: 모르는 어른은 아이 사진을 지울 수 없고, 보호자는 지울 수 있음
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000002', null);
delete from storage.objects where name like '%/posts/kid1.jpg';
reset role;
select pg_temp.assert((select count(*) from storage.objects where name like '%/posts/kid1.jpg') = 1, 'stranger cannot delete child photo');
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
select pg_temp.assert((select count(*) from public.child_photo_paths('cccccccc-0000-0000-0000-000000000011')) = 1, 'guardian lists child photos');
delete from storage.objects where name like '%/posts/kid1.jpg';
reset role;
select pg_temp.assert((select count(*) from storage.objects where name like '%/posts/kid1.jpg') = 0, 'guardian deleted child photo');

-- 안 쓴 링크: 5개까지, 남의 링크는 취소 못 함, 내 링크는 취소
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', 30);
select public.create_guardian_link('2026-10-14') from generate_series(1, 5);
do $$ begin
  perform public.create_guardian_link('2026-10-14');
  raise exception 'TEST FAILED: more than 5 unused links';
exception when raise_exception then
  if sqlerrm not like '%5개 있어요%' then raise; end if;
end $$;
reset role;
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000002', null);
do $$ begin
  perform public.cancel_guardian_link((select c.id from public.guardian_consents c limit 1));
  raise exception 'TEST FAILED: stranger table access';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ declare lid uuid; begin
  select c.id into lid from public.guardian_consents c where c.guardian_id = 'cccccccc-0000-0000-0000-000000000001' and c.child_id is null and c.expires_at > now() limit 1;
  perform pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000002', null);
  begin
    perform public.cancel_guardian_link(lid);
    raise exception 'TEST FAILED: stranger canceled link';
  exception when raise_exception then
    if sqlerrm not like '%찾을 수 없어요%' then raise; end if;
  end;
  reset role;
  perform pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
  perform public.cancel_guardian_link(lid);
  if (select count(*) from public.my_guardian_links()) <> 4 then raise exception 'TEST FAILED: cancel link'; end if;
  reset role;
end $$;

-- 두 번째 아이 가입 (보호자 탈퇴 테스트용)
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000012', 'k4@x.com',
   json_build_object('nickname', '꼬마사', 'under_14_with_guardian', true,
     'guardian_token', (select c.token from public.guardian_consents c where c.guardian_id = 'cccccccc-0000-0000-0000-000000000001' and c.child_id is null and c.expires_at > now() limit 1))::jsonb);

-- 보호자: 동의 철회 = 첫째 아이 계정 삭제
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
select public.delete_child_account('cccccccc-0000-0000-0000-000000000011');
select pg_temp.assert((select count(*) from public.my_children()) = 1, 'one child left after delete');
reset role;
select pg_temp.assert(not exists (select 1 from auth.users where id = 'cccccccc-0000-0000-0000-000000000011'), 'child user deleted');
select pg_temp.assert(not exists (select 1 from public.guardian_consents where child_id = 'cccccccc-0000-0000-0000-000000000011'), 'child consent record deleted');

-- 보호자 탈퇴: 안 쓴 링크는 지워지고, 이미 가입한 아이의 동의 기록은 남음(보호자 칸만 비움)
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000001', null);
select public.delete_my_account();
reset role;
select pg_temp.assert(not exists (select 1 from public.guardian_consents where child_id is null and guardian_id is null), 'unused links removed with guardian');
select pg_temp.assert(public.is_child_account('cccccccc-0000-0000-0000-000000000012'), 'second child still has consent record');
select pg_temp.as_user_pw('cccccccc-0000-0000-0000-000000000012', null);
select pg_temp.assert((select guardian_nickname from public.my_guardian_info()) is null, 'guardian gone');
reset role;
select set_config('request.jwt.claims', '', false);

select 'ALL RLS TESTS PASSED' as result;
