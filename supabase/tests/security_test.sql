-- =====================================================================
--  도란톡 정식 보안 시험 — 데이터베이스 (보안 규칙 RLS · 권한 · 함수 · 사진 창고 · 메일 · 알림)
--  실행: supabase/tests/security_run.sh  (로컬 PostgreSQL 전용. 실제 Supabase에서 실행하지 마세요)
--
--  - 실제 Supabase처럼 "새 표 · 함수는 anon / authenticated 가 기본으로 모든 권한"인 상태
--    (supabase_defaults.sql)에서 schema.sql 을 실행한 뒤, 여러 사람으로 바꿔 가며 공격해 봐요.
--      엄마(그룹 방장) · 아빠(멤버) · 아이(만 14세 미만, 엄마가 보호자) · 외부인 · 운영자 · 새 사용자 …
--  - 결과는 한 줄에 하나씩:  RESULT|번호|분류|PASS 또는 FAIL|내용|자세히
--  - 하나라도 FAIL 이면 마지막에 오류로 멈춰요.
-- =====================================================================
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off
set client_min_messages = warning;

-- ---------------------------------------------------------------------
-- 시험 도구
-- ---------------------------------------------------------------------
create temp table ids (k text primary key, v text);
create temp table results (n serial primary key, id text not null, cat text not null, title text not null,
                           ok boolean not null, detail text);
grant all on ids, results to public;
grant usage, select on sequence results_n_seq to public;

create function pg_temp.id(text) returns text language sql stable as $$ select v from pg_temp.ids where k = $1 $$;
create function pg_temp.put(text, text) returns void language sql as $$
  insert into pg_temp.ids values ($1, $2) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.rec(p_id text, p_cat text, p_title text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.results (id, cat, title, ok, detail) values ($1, $2, $3, coalesce($4, false), $5) $$;

-- 해야 하는 일: 오류 없이 p_min 줄 이상 바뀌어야 PASS
create function pg_temp.allowed(p_id text, p_cat text, p_title text, p_sql text, p_min bigint default 1)
returns void language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  perform pg_temp.rec(p_id, p_cat, p_title, n >= p_min, format('허용됨 (%s줄)', n));
exception when others then
  perform pg_temp.rec(p_id, p_cat, p_title, false, format('오류 %s: %s', sqlstate, left(sqlerrm, 140)));
end $$;

-- 막혀야 하는 일: 오류가 나거나, 바뀐 줄이 0 이면 PASS
create function pg_temp.blocked(p_id text, p_cat text, p_title text, p_sql text)
returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    perform pg_temp.rec(p_id, p_cat, p_title, true, format('막힘 %s: %s', sqlstate, left(sqlerrm, 140)));
    return;
  end;
  perform pg_temp.rec(p_id, p_cat, p_title, n = 0, case when n = 0 then '막힘 (바뀐 줄 0)' else format('뚫림! %s줄 바뀜', n) end);
end $$;

-- 오류가 나야 하는 일 (p_like: 오류 문구 일부)
create function pg_temp.raises(p_id text, p_cat text, p_title text, p_sql text, p_like text default '%')
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform pg_temp.rec(p_id, p_cat, p_title, sqlerrm like p_like, format('막힘 %s: %s', sqlstate, left(sqlerrm, 140)));
    return;
  end;
  perform pg_temp.rec(p_id, p_cat, p_title, false, '뚫림! 오류 없이 실행됨');
end $$;

-- 값이 같아야 하는 일 (p_sql 은 값 하나를 돌려주는 select)
create function pg_temp.expect(p_id text, p_cat text, p_title text, p_sql text, p_expected text)
returns void language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  perform pg_temp.rec(p_id, p_cat, p_title, r is not distinct from p_expected,
                      format('결과=%s (기대=%s)', coalesce(r, 'null'), coalesce(p_expected, 'null')));
exception when others then
  perform pg_temp.rec(p_id, p_cat, p_title, false, format('오류 %s: %s', sqlstate, left(sqlerrm, 140)));
end $$;

-- 사람 바꾸기: 로그인 정보(JWT)를 실제 PostgREST 처럼 넣고 authenticated 로
--   p_pw_age: 비밀번호로 로그인한 지 몇 초 지났는지 (보호자 동의에 필요). null 이면 기록 없음
create function pg_temp.login(p_who text, p_pw_age int default null) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim', '', false);
  perform set_config('request.headers', '{}', false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', pg_temp.id(p_who), 'role', 'authenticated', 'aud', 'authenticated',
    'amr', case when p_pw_age is null then '[]'::json
                else json_build_array(json_build_object('method', 'password',
                       'timestamp', extract(epoch from now())::bigint - p_pw_age)) end)::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim', '', false);
  perform set_config('request.headers', '{}', false);
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
end $$;
create function pg_temp.db() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.headers', '{}', false);
end $$;

-- ---------------------------------------------------------------------
-- 준비: 사람 · 그룹 · 글 · 사진 · 알림 주소
-- ---------------------------------------------------------------------
insert into pg_temp.ids values
  ('mom',   '5ec00000-0000-0000-0000-000000000001'),
  ('dad',   '5ec00000-0000-0000-0000-000000000002'),
  ('kid',   '5ec00000-0000-0000-0000-000000000003'),
  ('out',   '5ec00000-0000-0000-0000-000000000004'),
  ('admin', '5ec00000-0000-0000-0000-000000000005'),
  ('new',   '5ec00000-0000-0000-0000-000000000006'),
  ('inv',   '5ec00000-0000-0000-0000-000000000007'),
  ('left',  '5ec00000-0000-0000-0000-000000000008'),
  ('gone',  '5ec00000-0000-0000-0000-000000000009'),
  ('mail1', '5ec00000-0000-0000-0000-00000000000a'),
  ('mail2', '5ec00000-0000-0000-0000-00000000000b'),
  ('today', ((now() at time zone 'Asia/Seoul')::date)::text);
insert into vault.decrypted_secrets values ('resend_api_key', 'test-resend-key');

insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.id('mom')::uuid,   'mom@sec.test',   '{"nickname":"엄마","handle":"sec_mom"}'),
  (pg_temp.id('dad')::uuid,   'dad@sec.test',   '{"nickname":"아빠","handle":"sec_dad"}'),
  (pg_temp.id('out')::uuid,   'out@sec.test',   '{"nickname":"외부인","handle":"sec_out"}'),
  (pg_temp.id('admin')::uuid, 'admin@dorantalk.com', '{"nickname":"도란톡","handle":"dorantalk"}'),
  (pg_temp.id('new')::uuid,   'new@sec.test',   '{"nickname":"새사람","handle":"sec_new"}'),
  (pg_temp.id('inv')::uuid,   'inv@sec.test',   '{"nickname":"초대받는이","handle":"sec_inv"}'),
  (pg_temp.id('left')::uuid,  'left@sec.test',  '{"nickname":"떠날사람","handle":"sec_left"}'),
  (pg_temp.id('gone')::uuid,  'gone@sec.test',  '{"nickname":"탈퇴할사람","handle":"sec_gone"}');

-- 아이: 엄마가 (비밀번호 다시 확인 후) 동의 링크를 만들고, 아이가 그 링크로 가입
select pg_temp.login('mom', 30);
insert into pg_temp.ids select 'tok_kid', token from public.create_guardian_link('2026-01-01');
select pg_temp.db();
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.id('kid')::uuid, 'kid@sec.test', jsonb_build_object('nickname', '아이', 'handle', 'sec_kid',
     'guardian_token', pg_temp.id('tok_kid'), 'under_14_with_guardian', 'true'));

-- 그룹1 "우리 가족": 엄마(방장) · 아빠 · 아이 · 떠날사람, 초대받는이는 대기
select pg_temp.login('mom');
select pg_temp.put('g1', public.create_group('우리 가족')::text);
select public.invite_by_handle(pg_temp.id('g1')::uuid, h) from unnest(array['sec_dad', 'sec_kid', 'sec_left', 'sec_inv']) h;
select pg_temp.put('inv_pending', (select id::text from public.group_invitations
                                    where invitee_id = pg_temp.id('inv')::uuid and status = 'pending'));
select pg_temp.login('dad');  select public.respond_invitation(id, true) from public.get_my_invitations();
select pg_temp.login('kid');  select public.respond_invitation(id, true) from public.get_my_invitations();
select pg_temp.login('left'); select public.respond_invitation(id, true) from public.get_my_invitations();
-- 그룹2 "남의 집": 외부인 혼자
select pg_temp.login('out');
select pg_temp.put('g2', public.create_group('남의 집')::text);
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/out', repeat('G', 87), repeat('H', 22), '컴퓨터');
with x as (insert into public.posts (group_id, content) values (pg_temp.id('g2')::uuid, '외부인 글') returning id)
insert into pg_temp.ids select 'p9', id::text from x;

-- 엄마: 사진 · 글 · 댓글 · 하트 · 채팅 · 달력 · 프로필 사진 · 알림 주소
select pg_temp.login('mom');
insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/mom1.jpg');
with x as (insert into public.posts (group_id, content, image_paths)
           values (pg_temp.id('g1')::uuid, '엄마 글', array[pg_temp.id('g1') || '/posts/mom1.jpg']) returning id)
insert into pg_temp.ids select 'p1', id::text from x;
with x as (insert into public.comments (post_id, content) values (pg_temp.id('p1')::uuid, '엄마 댓글') returning id)
insert into pg_temp.ids select 'c1', id::text from x;
insert into public.post_likes (post_id) values (pg_temp.id('p1')::uuid);
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '엄마 메시지') returning id)
insert into pg_temp.ids select 'm1', id::text from x;
with x as (insert into public.family_events (group_id, title, kind, calendar, month, day, next_dates)
           values (pg_temp.id('g1')::uuid, '할머니 생신', 'birthday', 'lunar', 3, 5,
                   array[pg_temp.id('today')::date + 1]) returning id)
insert into pg_temp.ids select 'e1', id::text from x;
insert into storage.objects (bucket_id, name) values ('family-photos', 'avatars/' || pg_temp.id('mom') || '/a.jpg');
update public.profiles set avatar_path = 'avatars/' || pg_temp.id('mom') || '/a.jpg' where id = pg_temp.id('mom')::uuid;
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/mom', repeat('A', 87), repeat('B', 22), '컴퓨터');

-- 아빠
select pg_temp.login('dad');
with x as (insert into public.posts (group_id, content) values (pg_temp.id('g1')::uuid, '아빠 글') returning id)
insert into pg_temp.ids select 'p2', id::text from x;
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '아빠 메시지') returning id)
insert into pg_temp.ids select 'm2', id::text from x;
with x as (insert into public.comments (post_id, content) values (pg_temp.id('p1')::uuid, '아빠 댓글') returning id)
insert into pg_temp.ids select 'c2', id::text from x;
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/dad', repeat('C', 87), repeat('D', 22), '안드로이드');

-- 아이
select pg_temp.login('kid');
insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/chat/kid1.jpg');
with x as (insert into public.messages (group_id, image_path) values (pg_temp.id('g1')::uuid, pg_temp.id('g1') || '/chat/kid1.jpg') returning id)
insert into pg_temp.ids select 'm3', id::text from x;
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/kid', repeat('E', 87), repeat('F', 22), '안드로이드');

-- 떠날사람: 나중에 그룹을 나간 뒤 시험할 일정
select pg_temp.login('left');
with x as (insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g1')::uuid, '떠날사람 일정', 7, 1) returning id)
insert into pg_temp.ids select 'e2', id::text from x;

-- 운영자: 쿠폰 1장
select pg_temp.login('admin');
insert into pg_temp.ids select 'code1', c from public.admin_create_premium_codes(1, 1, 'security-test') c;
select pg_temp.db();


-- =====================================================================
-- A. 설계 점검 (자동): 표 · 칸 · 함수 · 사진 창고 · 실시간 권한을 하나하나 확인
-- =====================================================================
select pg_temp.rec('DB-A01', '설계 점검', '모든 표에 행 단위 보안(RLS)이 켜져 있어요',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  (select coalesce(string_agg(c.relname, ', '), '없음') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity));

select pg_temp.rec('DB-A02', '설계 점검', '로그인 안 한 사람(anon)은 어떤 표 · 칸에도 권한이 없어요',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace,
                     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
              where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
                and (has_table_privilege('anon', c.oid, pr)
                     or (pr in ('SELECT', 'INSERT', 'UPDATE') and has_any_column_privilege('anon', c.oid, pr)))),
  '18개 표 × 7가지 권한');

with expected(t, pr) as (values
    ('profiles', 'SELECT'), ('family_groups', 'SELECT'), ('group_members', 'SELECT'), ('group_members', 'DELETE'),
    ('group_invitations', 'SELECT'), ('posts', 'SELECT'), ('posts', 'DELETE'), ('comments', 'SELECT'),
    ('comments', 'DELETE'), ('post_likes', 'SELECT'), ('post_likes', 'DELETE'), ('messages', 'SELECT'),
    ('chat_reads', 'SELECT'), ('family_events', 'SELECT'), ('family_events', 'DELETE')),
actual as (
  select c.relname::text t, pr from pg_class c join pg_namespace n on n.oid = c.relnamespace,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, pr)),
diff as ((select * from actual except select * from expected) union all (select * from expected except select * from actual))
select pg_temp.rec('DB-A03', '설계 점검', '로그인한 사람의 표 권한이 꼭 필요한 것(읽기 · 내 것 지우기)뿐이에요',
  not exists (select 1 from diff), (select coalesce(string_agg(t || ':' || pr, ', '), '차이 없음') from diff));

with expected(t, col) as (values
    ('profiles', 'nickname'), ('profiles', 'handle'), ('profiles', 'avatar_color'), ('profiles', 'avatar_path'),
    ('family_groups', 'name'), ('posts', 'content'), ('posts', 'image_paths'), ('comments', 'content'),
    ('family_events', 'title'), ('family_events', 'kind'), ('family_events', 'calendar'), ('family_events', 'month'),
    ('family_events', 'day'), ('family_events', 'leap'), ('family_events', 'year'), ('family_events', 'next_dates'),
    ('family_events', 'memo')),
actual as (
  select c.relname::text t, a.attname::text col from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r' and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')),
diff as ((select * from actual except select * from expected) union all (select * from expected except select * from actual))
select pg_temp.rec('DB-A04', '설계 점검', '고칠 수 있는 칸은 내용 칸뿐 (작성자 · 방장 · 프리미엄 기간 · 그룹 등은 못 고쳐요)',
  not exists (select 1 from diff), (select coalesce(string_agg(t || '.' || col, ', '), '차이 없음') from diff));

with expected(t, col) as (values
    ('posts', 'group_id'), ('posts', 'content'), ('posts', 'image_paths'), ('comments', 'post_id'),
    ('comments', 'content'), ('post_likes', 'post_id'), ('messages', 'group_id'), ('messages', 'content'),
    ('messages', 'image_path'), ('messages', 'greeting'), ('family_events', 'group_id'), ('family_events', 'title'),
    ('family_events', 'kind'), ('family_events', 'calendar'), ('family_events', 'month'), ('family_events', 'day'),
    ('family_events', 'leap'), ('family_events', 'year'), ('family_events', 'next_dates'), ('family_events', 'memo')),
actual as (
  select c.relname::text t, a.attname::text col from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r' and has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')),
diff as ((select * from actual except select * from expected) union all (select * from expected except select * from actual))
select pg_temp.rec('DB-A05', '설계 점검', '새로 넣을 수 있는 칸도 내용 칸뿐 (작성자 · 보낸 사람 · 시각은 서버가 정해요)',
  not exists (select 1 from diff), (select coalesce(string_agg(t || '.' || col, ', '), '차이 없음') from diff));

select pg_temp.rec('DB-A06', '설계 점검', '관리자 권한으로 도는 함수(security definer)는 모두 검색 경로가 고정돼 있어요',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  (select count(*) || '개 함수 확인' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef));

with allow(f) as (values ('talkfeed_schema_version'), ('is_nickname_available'), ('is_handle_available'),
                         ('guardian_link_info'), ('mail_ready')),
anon_exec as (
  select p.proname::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
    -- 확장 기능(pgcrypto 등)의 함수는 빼요 (실제 Supabase에서는 extensions 스키마에 있어요)
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
extra as (select f from anon_exec except select f from allow)
select pg_temp.rec('DB-A07', '설계 점검', '로그인 안 한 사람이 부를 수 있는 함수는 가입 · 확인용 5개뿐이에요',
  not exists (select 1 from extra), (select coalesce('더 있음: ' || string_agg(f, ', '), '허용 목록과 같음') from extra));

-- 로그인한 사람도 직접 부르면 안 되는 내부 함수들 (메일 보내기 · 운영자 확인 · 아이 계정 확인 등)
do $$
declare
  f text; i int := 0; oid_ regprocedure;
begin
  foreach f in array array['send_mail(text,text,text)', 'mail_layout(text,text,text,text)', 'html_escape(text)',
    'mail_plain(text)', 'is_admin()', 'is_child_account(uuid)', 'is_reserved_name(text)', 'unread_total_for(uuid)',
    'push_caller_ok()', 'media_summary(text[],text)', 'recently_signed_in_with_password()', 'handle_new_user()',
    'guard_reserved_names()', 'mail_on_invitation()', 'mail_on_group_request()', 'handle_member_left()',
    'touch_updated_at()'] loop
    i := i + 1;
    oid_ := to_regprocedure('public.' || f);
    perform pg_temp.rec(format('DB-A08-%s', lpad(i::text, 2, '0')), '설계 점검',
      format('내부 함수 %s 는 로그인한 사람도 직접 부를 수 없어요', split_part(f, '(', 1)),
      oid_ is null or not has_function_privilege('authenticated', oid_, 'EXECUTE'),
      case when oid_ is null then '함수 없음' when has_function_privilege('authenticated', oid_, 'EXECUTE') then '부를 수 있음!' else '막힘' end);
  end loop;
end $$;

select pg_temp.rec('DB-A09', '설계 점검', '사진 창고(family-photos)는 비공개예요 (주소만 알아도 못 봐요)',
  (select not public from storage.buckets where id = 'family-photos'), null);
select pg_temp.rec('DB-A10', '설계 점검', '사진 창고는 사진 · 동영상 형식만 받아요 (html · svg · js 같은 위험한 형식 없음)',
  (select bool_and(m ~ '^(image/(jpeg|png|webp|gif)|video/(mp4|quicktime|webm))$') from storage.buckets b, unnest(b.allowed_mime_types) m
    where b.id = 'family-photos'),
  (select array_to_string(allowed_mime_types, ', ') from storage.buckets where id = 'family-photos'));
select pg_temp.rec('DB-A11', '설계 점검', '파일 하나는 50MB 까지만',
  (select file_size_limit <= 52428800 from storage.buckets where id = 'family-photos'),
  (select (file_size_limit / 1024 / 1024) || 'MB' from storage.buckets where id = 'family-photos'));
select pg_temp.rec('DB-A12', '설계 점검', '사진 창고의 모든 보안 규칙은 family-photos 안에서만 동작해요',
  not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and coalesce(qual, '') || coalesce(with_check, '') not like '%family-photos%'),
  (select count(*) || '개 규칙 확인' from pg_policies where schemaname = 'storage' and tablename = 'objects'));
select pg_temp.rec('DB-A13', '설계 점검', '올린 파일을 바꿔치기(덮어쓰기)하는 규칙이 없어요',
  not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')),
  null);
select pg_temp.rec('DB-A14', '설계 점검', '"누구나 통과" 같은 느슨한 보안 규칙(true)이 하나도 없어요',
  not exists (select 1 from pg_policies where schemaname in ('public', 'storage')
              and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')),
  null);
select pg_temp.rec('DB-A15', '설계 점검', '모든 보안 규칙은 로그인한 사람(authenticated)에게만 적용돼요 (anon · public 규칙 없음)',
  not exists (select 1 from pg_policies where schemaname in ('public', 'storage') and roles <> '{authenticated}'),
  (select coalesce(string_agg(tablename || '.' || policyname, ', '), '없음') from pg_policies
    where schemaname in ('public', 'storage') and roles <> '{authenticated}'));
select pg_temp.rec('DB-A16', '설계 점검', '실시간 전달은 정해진 7개 표만 (알림 주소 · 보호자 동의 · 쿠폰 · 메일 기록은 절대 안 나가요)',
  not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
              and tablename not in ('messages', 'chat_reads', 'posts', 'comments', 'post_likes', 'group_invitations', 'group_members')),
  (select string_agg(tablename, ', ') from pg_publication_tables where pubname = 'supabase_realtime'));
select pg_temp.rec('DB-A17', '설계 점검', '보안 규칙을 건너뛰는 보기(view)가 없어요',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('v', 'm')), null);
select pg_temp.rec('DB-A18', '설계 점검', '함수 안에서 글자를 이어 붙여 SQL 을 실행하는 곳이 없어요 (SQL 주입 방지)',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.prosrc ~* 'execute\s+(?:(?!\musing\M|\minto\M)[^;])*\|\|' or p.prosrc ~* 'execute\s+format\([^;]*%s')),
  (select coalesce(string_agg(p.proname, ', '), '없음') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.prosrc ~* 'execute\s+(?:(?!\musing\M|\minto\M)[^;])*\|\|' or p.prosrc ~* 'execute\s+format\([^;]*%s')));
select pg_temp.rec('DB-A19', '설계 점검', '이메일 주소를 돌려주는 함수가 없어요',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                     unnest(p.proargnames, p.proargmodes, p.proallargtypes) as a(nm, md, ty)
              where n.nspname = 'public' and a.md in ('o', 't', 'b') and a.nm ilike '%email%' and a.ty = 'text'::regtype),
  null);
select pg_temp.rec('DB-A20', '설계 점검', '보호 장치(운영자 이름 보호 · 가입 처리 · 방장 넘기기 · 메일) 트리거가 모두 켜져 있어요',
  (select count(*) = 5 from pg_trigger where not tgisinternal and tgenabled <> 'D'
    and tgname in ('guard_reserved_names', 'on_auth_user_created', 'on_member_left', 'on_invitation_mail', 'on_group_request_mail')),
  null);


-- =====================================================================
-- B. 로그인 안 한 사람 (anon 키만 가진 사람)
-- =====================================================================
select pg_temp.anon();
do $$
declare t text; i int := 0;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' order by c.relname loop
    i := i + 1;
    perform pg_temp.raises(format('DB-B%s', lpad(i::text, 2, '0')), '로그인 안 함',
      format('로그인 안 한 사람은 %s 표를 읽을 수 없어요', t), format('select count(*) from public.%I', t));
  end loop;
end $$;
select pg_temp.raises('DB-B30', '로그인 안 함', '로그인 안 한 사람은 글을 쓸 수 없어요',
  $q$insert into public.posts (group_id, content) values (pg_temp.id('g1')::uuid, '해킹')$q$);
select pg_temp.expect('DB-B31', '로그인 안 함', '로그인 안 한 사람에게 사진 창고 파일이 하나도 안 보여요',
  $q$select count(*)::text from storage.objects$q$, '0');
select pg_temp.raises('DB-B32', '로그인 안 함', '로그인 안 한 사람은 파일을 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/anon.jpg')$q$);
select pg_temp.raises('DB-B33', '로그인 안 함', '로그인 안 한 사람은 그룹을 만들 수 없어요',
  $q$select public.create_group('익명 그룹')$q$);
select pg_temp.expect('DB-B34', '로그인 안 함', '(정상 기능) 가입 화면의 아이디 확인은 로그인 없이 돼요',
  $q$select public.is_handle_available('brand_new_id')::text$q$, 'true');
select pg_temp.expect('DB-B35', '로그인 안 함', '(정상 기능) 자녀 가입 링크 확인은 로그인 없이 되고, 없는 링크는 not_found',
  $q$select status from public.guardian_link_info('0123456789abcdef0123456789abcdef')$q$, 'not_found');
select pg_temp.db();


-- =====================================================================
-- N. 막 가입한 새 사용자 (아무 그룹에도 없음)
-- =====================================================================
select pg_temp.login('new');
select pg_temp.expect('DB-N01', '새 사용자', '남의 그룹이 하나도 안 보여요', $q$select count(*)::text from public.family_groups$q$, '0');
select pg_temp.expect('DB-N02', '새 사용자', '남의 그룹 멤버 목록이 안 보여요', $q$select count(*)::text from public.group_members$q$, '0');
select pg_temp.expect('DB-N03', '새 사용자', '남의 글이 안 보여요', $q$select count(*)::text from public.posts$q$, '0');
select pg_temp.expect('DB-N04', '새 사용자', '남의 댓글이 안 보여요', $q$select count(*)::text from public.comments$q$, '0');
select pg_temp.expect('DB-N05', '새 사용자', '남의 하트가 안 보여요', $q$select count(*)::text from public.post_likes$q$, '0');
select pg_temp.expect('DB-N06', '새 사용자', '남의 채팅이 안 보여요', $q$select count(*)::text from public.messages$q$, '0');
select pg_temp.expect('DB-N07', '새 사용자', '남의 읽음 표시가 안 보여요', $q$select count(*)::text from public.chat_reads$q$, '0');
select pg_temp.expect('DB-N08', '새 사용자', '남의 가족 달력이 안 보여요', $q$select count(*)::text from public.family_events$q$, '0');
select pg_temp.expect('DB-N09', '새 사용자', '남의 초대 목록이 안 보여요', $q$select count(*)::text from public.group_invitations$q$, '0');
select pg_temp.expect('DB-N10', '새 사용자', '회원 정보는 내 것 하나만 보여요', $q$select count(*)::text from public.profiles$q$, '1');
select pg_temp.expect('DB-N11', '새 사용자', '사진 창고에서 남의 파일이 하나도 안 보여요', $q$select count(*)::text from storage.objects$q$, '0');
select pg_temp.raises('DB-N12', '새 사용자', '알림 주소 표(push_subscriptions)를 직접 읽을 수 없어요', $q$select count(*) from public.push_subscriptions$q$);
select pg_temp.raises('DB-N13', '새 사용자', '보호자 동의 표를 직접 읽을 수 없어요', $q$select count(*) from public.guardian_consents$q$);
select pg_temp.raises('DB-N14', '새 사용자', '쿠폰 표를 직접 읽을 수 없어요', $q$select count(*) from public.premium_codes$q$);
select pg_temp.raises('DB-N15', '새 사용자', '메일 기록 표를 직접 읽을 수 없어요', $q$select count(*) from public.mail_log$q$);
select pg_temp.raises('DB-N16', '새 사용자', '자녀 그룹 요청 표를 직접 읽을 수 없어요', $q$select count(*) from public.group_requests$q$);
select pg_temp.raises('DB-N17', '새 사용자', '달력 알림 기록 표를 직접 읽을 수 없어요', $q$select count(*) from public.family_event_notices$q$);
select pg_temp.raises('DB-N18', '새 사용자', '알림 보낸 기록 표를 직접 읽을 수 없어요', $q$select count(*) from public.push_sent$q$);
select pg_temp.raises('DB-N19', '새 사용자', '프리미엄 관심 신청 표를 직접 읽을 수 없어요', $q$select count(*) from public.premium_interest$q$);
select pg_temp.blocked('DB-N20', '새 사용자', '사진 창고를 "공개"로 바꿀 수 없어요',
  $q$update storage.buckets set public = true where id = 'family-photos'$q$);
select pg_temp.blocked('DB-N21', '새 사용자', '새 공개 창고를 만들 수 없어요',
  $q$insert into storage.buckets (id, name, public) values ('hack', 'hack', true)$q$);


-- =====================================================================
-- I. 외부인이 남의 그룹(우리 가족)에 침입 시도
-- =====================================================================
select pg_temp.login('out');
select pg_temp.blocked('DB-I01', '남의 그룹 침입', '남의 그룹에 글을 쓸 수 없어요',
  $q$insert into public.posts (group_id, content) values (pg_temp.id('g1')::uuid, '침입')$q$);
select pg_temp.blocked('DB-I02', '남의 그룹 침입', '남의 글에 댓글을 달 수 없어요',
  $q$insert into public.comments (post_id, content) values (pg_temp.id('p1')::uuid, '침입')$q$);
select pg_temp.blocked('DB-I03', '남의 그룹 침입', '남의 글에 하트를 누를 수 없어요',
  $q$insert into public.post_likes (post_id) values (pg_temp.id('p1')::uuid)$q$);
select pg_temp.blocked('DB-I04', '남의 그룹 침입', '남의 그룹 채팅방에 메시지를 보낼 수 없어요',
  $q$insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '침입')$q$);
select pg_temp.blocked('DB-I05', '남의 그룹 침입', '남의 가족 달력에 일정을 넣을 수 없어요',
  $q$insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g1')::uuid, '침입', 1, 1)$q$);
select pg_temp.blocked('DB-I06', '남의 그룹 침입', '남의 글을 고칠 수 없어요',
  $q$update public.posts set content = '해킹' where id = pg_temp.id('p1')::uuid$q$);
select pg_temp.blocked('DB-I07', '남의 그룹 침입', '남의 글을 지울 수 없어요',
  $q$delete from public.posts where id = pg_temp.id('p1')::uuid$q$);
select pg_temp.blocked('DB-I08', '남의 그룹 침입', '남의 일정을 고칠 수 없어요',
  $q$update public.family_events set title = '해킹' where id = pg_temp.id('e1')::uuid$q$);
select pg_temp.blocked('DB-I09', '남의 그룹 침입', '남의 일정을 지울 수 없어요',
  $q$delete from public.family_events where id = pg_temp.id('e1')::uuid$q$);
select pg_temp.blocked('DB-I10', '남의 그룹 침입', '남의 그룹 이름을 바꿀 수 없어요',
  $q$update public.family_groups set name = '해킹' where id = pg_temp.id('g1')::uuid$q$);
select pg_temp.blocked('DB-I11', '남의 그룹 침입', '남의 그룹에서 다른 사람을 내보낼 수 없어요',
  $q$delete from public.group_members where group_id = pg_temp.id('g1')::uuid and user_id = pg_temp.id('dad')::uuid$q$);
select pg_temp.blocked('DB-I12', '남의 그룹 침입', '나 자신을 남의 그룹 멤버로 몰래 넣을 수 없어요',
  $q$insert into public.group_members (group_id, user_id) values (pg_temp.id('g1')::uuid, pg_temp.id('out')::uuid)$q$);
select pg_temp.blocked('DB-I13', '남의 그룹 침입', '나에게 남의 그룹 초대장을 몰래 만들 수 없어요',
  $q$insert into public.group_invitations (group_id, invitee_id) values (pg_temp.id('g1')::uuid, pg_temp.id('out')::uuid)$q$);
select pg_temp.raises('DB-I14', '남의 그룹 침입', '남의 그룹으로 다른 사람을 초대할 수 없어요',
  $q$select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_new')$q$, '%멤버만%');
select pg_temp.raises('DB-I15', '남의 그룹 침입', '다른 사람에게 온 초대를 대신 수락할 수 없어요',
  $q$select public.respond_invitation(pg_temp.id('inv_pending')::uuid, true)$q$, '%찾을 수 없어요%');
select pg_temp.raises('DB-I16', '남의 그룹 침입', '남의 그룹 초대를 취소할 수 없어요',
  $q$select public.cancel_invitation(pg_temp.id('inv_pending')::uuid)$q$);
select pg_temp.raises('DB-I17', '남의 그룹 침입', '남의 채팅방 읽음 표시를 바꿀 수 없어요',
  $q$select public.mark_chat_read(pg_temp.id('g1')::uuid)$q$);
select pg_temp.raises('DB-I18', '남의 그룹 침입', '남의 그룹에 쿠폰을 넣어 프리미엄을 켤 수 없어요',
  $q$select public.redeem_premium_code(pg_temp.id('g1')::uuid, pg_temp.id('code1'))$q$, '%멤버만%');
select pg_temp.expect('DB-I19', '남의 그룹 침입', '남의 채팅 메시지로 알림 받을 사람 목록을 뽑을 수 없어요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m1')::uuid)$q$, '0');
select pg_temp.expect('DB-I20', '남의 그룹 침입', '남의 일정으로 달력 알림을 보낼 수 없어요',
  $q$select count(*)::text from public.push_targets('event', pg_temp.id('e1')::uuid)$q$, '0');
select pg_temp.expect('DB-I21', '남의 그룹 침입', '오늘 · 내일 알림 목록에 남의 일정이 없어요',
  $q$select count(*)::text from public.due_event_reminders() r where r = pg_temp.id('e1')::uuid$q$, '0');
select pg_temp.expect('DB-I22', '남의 그룹 침입', '남의 그룹 사진 · 동영상이 안 보여요',
  $q$select count(*)::text from storage.objects where name like pg_temp.id('g1') || '/%'$q$, '0');
select pg_temp.raises('DB-I23', '남의 그룹 침입', '남의 그룹 폴더에 파일을 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/hack.jpg')$q$);
select pg_temp.blocked('DB-I24', '남의 그룹 침입', '남의 사진을 지울 수 없어요',
  $q$delete from storage.objects where name = pg_temp.id('g1') || '/posts/mom1.jpg'$q$);
select pg_temp.expect('DB-I25', '남의 그룹 침입', '모르는 사람의 프로필 사진이 안 보여요',
  $q$select count(*)::text from storage.objects where name like 'avatars/' || pg_temp.id('mom') || '/%'$q$, '0');
select pg_temp.expect('DB-I26', '남의 그룹 침입', '모르는 사람의 닉네임 · 아이디가 안 보여요',
  $q$select count(*)::text from public.profiles where id = pg_temp.id('mom')::uuid$q$, '0');
select pg_temp.expect('DB-I27', '남의 그룹 침입', '남의 그룹의 안 읽은 채팅 수를 볼 수 없어요',
  $q$select count(*)::text from public.get_unread_counts() where group_id = pg_temp.id('g1')::uuid$q$, '0');
select pg_temp.expect('DB-I28', '남의 그룹 침입', '남에게 온 초대가 내 초대 목록에 안 보여요',
  $q$select count(*)::text from public.get_my_invitations() where group_id = pg_temp.id('g1')::uuid$q$, '0');
select pg_temp.blocked('DB-I29', '남의 그룹 침입', '남의 그룹 사진 경로를 내 채팅에 붙여 몰래 보기 → 막힘',
  $q$insert into public.messages (group_id, image_path) values (pg_temp.id('g2')::uuid, pg_temp.id('g1') || '/chat/kid1.jpg')$q$);
select pg_temp.blocked('DB-I30', '남의 그룹 침입', '남의 그룹 사진 경로를 내 글에 붙여 몰래 보기 → 막힘',
  $q$insert into public.posts (group_id, image_paths) values (pg_temp.id('g2')::uuid, array[pg_temp.id('g1') || '/posts/mom1.jpg'])$q$);
select pg_temp.blocked('DB-I31', '남의 그룹 침입', '남의 사진 경로를 내 프로필 사진으로 지정할 수 없어요',
  $q$update public.profiles set avatar_path = pg_temp.id('g1') || '/posts/mom1.jpg' where id = pg_temp.id('out')::uuid$q$);
select pg_temp.raises('DB-I32', '남의 그룹 침입', '어떤 계정이 아이 계정인지 몰래 확인할 수 없어요',
  $q$select public.is_child_account(pg_temp.id('kid')::uuid)$q$);
select pg_temp.raises('DB-I33', '남의 그룹 침입', '아이 계정은 모르는 사람이 아이디로 찾아 초대할 수 없어요 (없는 아이디와 같은 안내)',
  $q$select public.invite_by_handle(pg_temp.id('g2')::uuid, 'sec_kid')$q$, '%찾을 수 없어요%');
select pg_temp.expect('DB-I34', '남의 그룹 침입', '남의 아이가 올린 사진 목록을 볼 수 없어요',
  $q$select count(*)::text from public.child_photo_paths(pg_temp.id('kid')::uuid)$q$, '0');
select pg_temp.raises('DB-I35', '남의 그룹 침입', '남의 아이 계정을 지울 수 없어요',
  $q$select public.delete_child_account(pg_temp.id('kid')::uuid)$q$);
select pg_temp.expect('DB-I36', '남의 그룹 침입', '탈퇴 정리용 "내 사진 목록"에 남의 파일이 안 섞여요',
  $q$select count(*)::text from public.my_photo_paths() p where p like pg_temp.id('g1') || '/%'$q$, '0');
select pg_temp.expect('DB-I37', '남의 그룹 침입', '남의 그룹 멤버인 척 확인 함수를 불러도 "아니요"',
  $q$select public.is_group_member(pg_temp.id('g1')::uuid)::text$q$, 'false');
select pg_temp.raises('DB-I38', '남의 그룹 침입', '남의 그룹 읽음 기록을 직접 넣을 수 없어요',
  $q$insert into public.chat_reads (group_id, user_id) values (pg_temp.id('g1')::uuid, pg_temp.id('out')::uuid)$q$);
select pg_temp.db();


-- =====================================================================
-- P. 같은 그룹 멤버(아빠)가 권한을 넘어서려는 시도
-- =====================================================================
select pg_temp.login('dad');
select pg_temp.blocked('DB-P01', '권한 올리기', '방장이 아닌 멤버는 그룹 이름을 바꿀 수 없어요',
  $q$update public.family_groups set name = '아빠 마음대로' where id = pg_temp.id('g1')::uuid$q$);
select pg_temp.raises('DB-P02', '권한 올리기', '스스로 방장(owner)이 될 수 없어요',
  $q$update public.group_members set role = 'owner' where group_id = pg_temp.id('g1')::uuid and user_id = pg_temp.id('dad')::uuid$q$);
select pg_temp.blocked('DB-P03', '권한 올리기', '다른 멤버(방장)를 그룹에서 내보낼 수 없어요',
  $q$delete from public.group_members where group_id = pg_temp.id('g1')::uuid and user_id = pg_temp.id('mom')::uuid$q$);
select pg_temp.raises('DB-P04', '권한 올리기', '프리미엄 기간을 마음대로 늘릴 수 없어요',
  $q$update public.family_groups set premium_until = now() + interval '10 years' where id = pg_temp.id('g1')::uuid$q$);
select pg_temp.blocked('DB-P05', '권한 올리기', '다른 가족의 글을 고칠 수 없어요',
  $q$update public.posts set content = '고쳐짐' where id = pg_temp.id('p1')::uuid$q$);
select pg_temp.blocked('DB-P06', '권한 올리기', '다른 가족의 글을 지울 수 없어요',
  $q$delete from public.posts where id = pg_temp.id('p1')::uuid$q$);
select pg_temp.blocked('DB-P07', '권한 올리기', '다른 가족의 댓글을 고칠 수 없어요',
  $q$update public.comments set content = '고쳐짐' where id = pg_temp.id('c1')::uuid$q$);
select pg_temp.blocked('DB-P08', '권한 올리기', '다른 가족의 댓글을 지울 수 없어요',
  $q$delete from public.comments where id = pg_temp.id('c1')::uuid$q$);
select pg_temp.blocked('DB-P09', '권한 올리기', '다른 가족이 만든 일정은 (방장이 아니면) 지울 수 없어요',
  $q$delete from public.family_events where id = pg_temp.id('e1')::uuid$q$);
select pg_temp.allowed('DB-P10', '권한 올리기', '(설계 확인) 가족 일정은 같은 그룹 가족이 고칠 수 있어요',
  $q$update public.family_events set memo = '아빠가 메모' where id = pg_temp.id('e1')::uuid$q$);
select pg_temp.raises('DB-P11', '권한 올리기', '다른 가족 이름으로 채팅을 보낼 수 없어요 (보낸 사람 위조)',
  $q$insert into public.messages (group_id, content, sender_id) values (pg_temp.id('g1')::uuid, '엄마인 척', pg_temp.id('mom')::uuid)$q$);
select pg_temp.raises('DB-P12', '권한 올리기', '다른 가족 이름으로 글을 쓸 수 없어요 (작성자 위조)',
  $q$insert into public.posts (group_id, content, author_id) values (pg_temp.id('g1')::uuid, '엄마인 척', pg_temp.id('mom')::uuid)$q$);
select pg_temp.raises('DB-P13', '권한 올리기', '다른 가족 대신 하트를 누를 수 없어요',
  $q$insert into public.post_likes (post_id, user_id) values (pg_temp.id('p2')::uuid, pg_temp.id('mom')::uuid)$q$);
select pg_temp.raises('DB-P14', '권한 올리기', '다른 가족 이름으로 일정을 만들 수 없어요',
  $q$insert into public.family_events (group_id, title, month, day, created_by) values (pg_temp.id('g1')::uuid, '위조', 1, 1, pg_temp.id('mom')::uuid)$q$);
select pg_temp.raises('DB-P15', '권한 올리기', '다른 가족의 읽음 위치를 직접 바꿀 수 없어요',
  $q$update public.chat_reads set last_read_at = now() where group_id = pg_temp.id('g1')::uuid$q$);
select pg_temp.blocked('DB-P16', '권한 올리기', '다른 가족이 올린 파일 이름을 바꿔치기할 수 없어요',
  $q$update storage.objects set name = name || '.bak' where name = pg_temp.id('g1') || '/posts/mom1.jpg'$q$);
select pg_temp.blocked('DB-P17', '권한 올리기', '다른 가족이 올린 사진을 지울 수 없어요',
  $q$delete from storage.objects where name = pg_temp.id('g1') || '/posts/mom1.jpg'$q$);
select pg_temp.blocked('DB-P18', '권한 올리기', '다른 가족의 닉네임을 바꿀 수 없어요',
  $q$update public.profiles set nickname = '바뀜' where id = pg_temp.id('mom')::uuid$q$);
select pg_temp.blocked('DB-P19', '권한 올리기', '프로필 사진 경로를 남의 폴더로 지정할 수 없어요',
  $q$update public.profiles set avatar_path = 'avatars/' || pg_temp.id('mom') || '/a.jpg' where id = pg_temp.id('dad')::uuid$q$);
select pg_temp.blocked('DB-P20', '권한 올리기', '프로필 사진 경로에 ".." (폴더 거슬러 오르기)를 쓸 수 없어요',
  $q$update public.profiles set avatar_path = 'avatars/' || pg_temp.id('dad') || '/../' || pg_temp.id('mom') || '/a.jpg' where id = pg_temp.id('dad')::uuid$q$);
select pg_temp.blocked('DB-P21', '권한 올리기', '정해진 색(0~7) 밖의 값을 넣을 수 없어요',
  $q$update public.profiles set avatar_color = 99 where id = pg_temp.id('dad')::uuid$q$);
select pg_temp.raises('DB-P22', '권한 올리기', '운영자가 아니면 광고 성과(가입 통계)를 볼 수 없어요',
  $q$select public.admin_stats()$q$, '%운영자만%');
select pg_temp.raises('DB-P23', '권한 올리기', '운영자가 아니면 쿠폰을 만들 수 없어요',
  $q$select public.admin_create_premium_codes(1, 12, 'hack')$q$, '%운영자만%');
select pg_temp.raises('DB-P24', '권한 올리기', '운영자가 아니면 쿠폰 목록을 볼 수 없어요',
  $q$select public.admin_premium_summary()$q$, '%운영자만%');
select pg_temp.raises('DB-P25', '권한 올리기', '"관리자" 닉네임으로 운영자인 척할 수 없어요',
  $q$update public.profiles set nickname = '관리자' where id = pg_temp.id('dad')::uuid$q$, '%운영자만%');
select pg_temp.raises('DB-P26', '권한 올리기', '"DoranTalk_kr" 아이디로 운영자인 척할 수 없어요',
  $q$update public.profiles set handle = 'DoranTalk_kr' where id = pg_temp.id('dad')::uuid$q$, '%운영자만%');
select pg_temp.raises('DB-P27', '권한 올리기', '"ADMIN" (대문자) 아이디도 막혀요',
  $q$update public.profiles set handle = 'ADMIN' where id = pg_temp.id('dad')::uuid$q$, '%운영자만%');
select pg_temp.raises('DB-P28', '권한 올리기', '다른 사람 아이디를 대소문자만 바꿔 가로챌 수 없어요',
  $q$update public.profiles set handle = 'SEC_MOM' where id = pg_temp.id('dad')::uuid$q$);
select pg_temp.raises('DB-P29', '권한 올리기', '보호자가 아니면 아이 계정을 지울 수 없어요',
  $q$select public.delete_child_account(pg_temp.id('kid')::uuid)$q$);
select pg_temp.expect('DB-P30', '권한 올리기', '보호자가 아니면 아이 사진 정리 목록을 볼 수 없어요',
  $q$select count(*)::text from public.child_photo_paths(pg_temp.id('kid')::uuid)$q$, '0');
select pg_temp.raises('DB-P31', '권한 올리기', 'posts · chat 이 아닌 폴더에는 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/secret/x.jpg')$q$);
select pg_temp.raises('DB-P32', '권한 올리기', '다른 사람의 프로필 사진 폴더에 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', 'avatars/' || pg_temp.id('mom') || '/x.jpg')$q$);
select pg_temp.raises('DB-P33', '권한 올리기', '주인 없는 프로필 사진 폴더(avatars/파일)에 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', 'avatars/x.jpg')$q$);
select pg_temp.expect('DB-P34', '권한 올리기', '아이의 보호자 정보는 아이 본인만 봐요',
  $q$select count(*)::text from public.my_guardian_info()$q$, '0');
select pg_temp.allowed('DB-P35', '권한 올리기', '(설계 확인) 대기 중인 초대는 같은 그룹 가족 누구나 취소할 수 있어요',
  $q$select public.cancel_invitation(pg_temp.id('inv_pending')::uuid)$q$);
select pg_temp.db();


-- =====================================================================
-- C. 만 14세 미만(아이) 보호
-- =====================================================================
select pg_temp.login('kid');
select pg_temp.raises('DB-C01', '만 14세 미만 보호', '아이는 혼자 그룹을 만들 수 없어요 (보호자 승인 필요)',
  $q$select public.create_group('아이 혼자')$q$, '%보호자%');
select pg_temp.raises('DB-C02', '만 14세 미만 보호', '아이는 쿠폰(돈과 관련된 일)을 넣을 수 없어요',
  $q$select public.redeem_premium_code(pg_temp.id('g1')::uuid, pg_temp.id('code1'))$q$, '%어른%');
select pg_temp.login('kid', 30);
select pg_temp.raises('DB-C03', '만 14세 미만 보호', '아이 계정은 다른 아이의 보호자가 될 수 없어요',
  $q$select * from public.create_guardian_link('2026-01-01')$q$, '%보호자가 될 수 없어요%');
select pg_temp.raises('DB-C04', '만 14세 미만 보호', '아이 계정에 다른 보호자를 몰래 덧붙일 수 없어요',
  $q$select public.attach_guardian_consent('0123456789abcdef0123456789abcdef')$q$, '%이미 보호자 동의%');
select pg_temp.login('kid');
insert into pg_temp.ids select 'req1', public.request_group('아이 그룹')::text;
select pg_temp.rec('DB-C05', '만 14세 미만 보호', '(정상 기능) 아이는 보호자에게 그룹 만들기 승인을 요청할 수 있어요',
  pg_temp.id('req1') is not null, null);
select pg_temp.login('out');
select pg_temp.raises('DB-C06', '만 14세 미만 보호', '모르는 사람은 아이의 그룹 요청을 승인할 수 없어요',
  $q$select public.decide_group_request(pg_temp.id('req1')::uuid, true)$q$);
select pg_temp.login('dad');
select pg_temp.raises('DB-C07', '만 14세 미만 보호', '같은 그룹 어른이라도 보호자가 아니면 승인할 수 없어요',
  $q$select public.decide_group_request(pg_temp.id('req1')::uuid, true)$q$);
select pg_temp.login('mom');
select pg_temp.put('g_kid', public.decide_group_request(pg_temp.id('req1')::uuid, true)::text);
select pg_temp.db();
select pg_temp.rec('DB-C08', '만 14세 미만 보호', '(정상 기능) 보호자가 승인하면 아이가 방장 · 보호자가 멤버인 그룹이 생겨요',
  (select count(*) = 2 from public.group_members where group_id = pg_temp.id('g_kid')::uuid
     and ((user_id = pg_temp.id('kid')::uuid and role = 'owner') or (user_id = pg_temp.id('mom')::uuid and role = 'member'))), null);
-- 보호자가 없는 그룹에서 아이에게 초대가 왔다고 가정 (정상 경로로는 만들 수 없지만, 수락 단계에서도 막히는지)
insert into public.group_invitations (group_id, inviter_id, invitee_id)
  values (pg_temp.id('g2')::uuid, pg_temp.id('out')::uuid, pg_temp.id('kid')::uuid);
select pg_temp.login('kid');
select pg_temp.raises('DB-C09', '만 14세 미만 보호', '보호자가 없는 그룹의 초대는 아이가 수락할 수 없어요',
  $q$select public.respond_invitation((select id from public.get_my_invitations() where group_id = pg_temp.id('g2')::uuid), true)$q$, '%보호자%');
select pg_temp.db();
delete from public.group_invitations where group_id = pg_temp.id('g2')::uuid and invitee_id = pg_temp.id('kid')::uuid;
select pg_temp.login('kid');
select pg_temp.rec('DB-C10', '만 14세 미만 보호', '(정상 기능) 아이는 보호자가 있는 가족 그룹 채팅은 그대로 봐요',
  (select count(*) > 0 from public.messages where group_id = pg_temp.id('g1')::uuid), null);
select pg_temp.db();


-- =====================================================================
-- G. 보호자 동의 링크 (아빠가 보호자가 되려는 경우)
-- =====================================================================
select pg_temp.login('dad');
select pg_temp.raises('DB-G01', '보호자 동의 링크', '비밀번호를 다시 확인하지 않으면 자녀 가입 링크를 만들 수 없어요',
  $q$select * from public.create_guardian_link('2026-01-01')$q$, '%비밀번호%');
select pg_temp.login('dad', 700);
select pg_temp.raises('DB-G02', '보호자 동의 링크', '비밀번호 확인이 10분보다 오래되면 다시 확인해야 해요',
  $q$select * from public.create_guardian_link('2026-01-01')$q$, '%비밀번호%');
select pg_temp.login('dad', 30);
insert into pg_temp.ids select 'tok_dad', token from public.create_guardian_link('2026-01-01');
select pg_temp.rec('DB-G03', '보호자 동의 링크', '(정상 기능) 방금 비밀번호를 확인했으면 링크가 만들어지고, 링크 번호는 추측할 수 없게 길어요(32자)',
  length(pg_temp.id('tok_dad')) >= 32, format('%s자', length(pg_temp.id('tok_dad'))));
select pg_temp.raises('DB-G04', '보호자 동의 링크', '보호자가 자기 링크로 자기 계정을 "아이"로 만들 수 없어요',
  $q$select public.attach_guardian_consent(pg_temp.id('tok_dad'))$q$, '%보호자 본인%');
select pg_temp.db();
select pg_temp.raises('DB-G05', '보호자 동의 링크', '이미 쓴 링크로 또 가입할 수 없어요 (한 번만)',
  $q$insert into auth.users (email, raw_user_meta_data) values ('reuse@sec.test', jsonb_build_object('nickname', '재사용', 'handle', 'sec_reuse', 'guardian_token', pg_temp.id('tok_kid')))$q$, '%이미 사용%');
update public.guardian_consents set expires_at = now() - interval '1 minute' where token = pg_temp.id('tok_dad');
select pg_temp.login('new');
select pg_temp.raises('DB-G06', '보호자 동의 링크', '기간(7일)이 지난 링크는 쓸 수 없어요',
  $q$select public.attach_guardian_consent(pg_temp.id('tok_dad'))$q$, '%만료%');
select pg_temp.expect('DB-G07', '보호자 동의 링크', '이미 쓴 링크를 열어 봐도 보호자 이름이 안 보여요',
  $q$select status || '|' || coalesce(guardian_nickname, '') from public.guardian_link_info(pg_temp.id('tok_kid'))$q$, 'used|');
select pg_temp.login('dad', 30);
select pg_temp.allowed('DB-G08', '보호자 동의 링크', '(정상 기능) 쓰지 않은 링크는 5개까지 만들 수 있어요',
  $q$select * from public.create_guardian_link('2026-01-01') l1, public.create_guardian_link('2026-01-01') l2,
            public.create_guardian_link('2026-01-01') l3, public.create_guardian_link('2026-01-01') l4, public.create_guardian_link('2026-01-01') l5$q$);
select pg_temp.raises('DB-G09', '보호자 동의 링크', '쓰지 않은 링크가 5개면 더 만들 수 없어요 (링크 남발 방지)',
  $q$select * from public.create_guardian_link('2026-01-01')$q$, '%5개%');
select pg_temp.db();


-- =====================================================================
-- J. 입력값 공격 (SQL 주입 · 이상한 글자 · 너무 긴 글 · 경로 조작)
-- =====================================================================
select pg_temp.login('mom');
select pg_temp.raises('DB-J01', '입력값 공격', '아이디 칸에 SQL 주입('' or 1=1 --)을 넣어도 "찾을 수 없어요"',
  $q$select public.invite_by_handle(pg_temp.id('g1')::uuid, $x$' or 1=1 --$x$)$q$, '%찾을 수 없어요%');
select pg_temp.expect('DB-J02', '입력값 공격', '아이디 확인 칸에 "표 지우기" 명령을 넣어도 그냥 글자로 취급돼요',
  $q$select public.is_handle_available($x$x'; drop table public.posts; --$x$)::text || '|' || (to_regclass('public.posts') is not null)::text$q$, 'false|true');
select pg_temp.expect('DB-J03', '입력값 공격', '자녀 링크 확인 칸에 SQL 주입을 넣어도 not_found',
  $q$select status from public.guardian_link_info($x$' or '1'='1$x$)$q$, 'not_found');
select pg_temp.raises('DB-J04', '입력값 공격', '쿠폰 칸에 SQL 주입을 넣어도 쿠폰이 안 켜져요',
  $q$select public.redeem_premium_code(pg_temp.id('g1')::uuid, $x$DORAN-' OR 1=1 --$x$)$q$, '%다시 확인%');
select pg_temp.db();
select pg_temp.raises('DB-J05', '입력값 공격', '닉네임에 글자 방향 뒤집기 문자(U+202E)를 쓸 수 없어요 (이름 속이기 방지)',
  $q$insert into auth.users (email, raw_user_meta_data) values ('rtl@sec.test', jsonb_build_object('nickname', '엄' || chr(8238) || '마', 'handle', 'sec_rtl'))$q$);
select pg_temp.raises('DB-J06', '입력값 공격', '아이디에 보이지 않는 글자(폭 없는 공백)를 쓸 수 없어요',
  $q$insert into auth.users (email, raw_user_meta_data) values ('zw@sec.test', jsonb_build_object('nickname', '공백', 'handle', 'sec' || chr(8203) || 'mom'))$q$);
select pg_temp.raises('DB-J07', '입력값 공격', '아이디에 따옴표 · 세미콜론 같은 특수문자를 쓸 수 없어요',
  $q$insert into auth.users (email, raw_user_meta_data) values ('q@sec.test', jsonb_build_object('nickname', '따옴표', 'handle', $x$a';--$x$))$q$);
select pg_temp.login('mom');
select pg_temp.raises('DB-J08', '입력값 공격', '그룹 이름은 30자를 넘을 수 없어요',
  $q$select public.create_group(repeat('가', 31))$q$);
select pg_temp.raises('DB-J09', '입력값 공격', '빈칸만 있는 그룹 이름은 안 돼요',
  $q$select public.create_group('     ')$q$);
select pg_temp.raises('DB-J10', '입력값 공격', '글은 5,000자를 넘을 수 없어요',
  $q$insert into public.posts (group_id, content) values (pg_temp.id('g1')::uuid, repeat('가', 5001))$q$);
select pg_temp.raises('DB-J11', '입력값 공격', '댓글은 1,000자를 넘을 수 없어요',
  $q$insert into public.comments (post_id, content) values (pg_temp.id('p1')::uuid, repeat('가', 1001))$q$);
select pg_temp.raises('DB-J12', '입력값 공격', '채팅은 2,000자를 넘을 수 없어요',
  $q$insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, repeat('가', 2001))$q$);
select pg_temp.raises('DB-J13', '입력값 공격', '일정 이름은 30자를 넘을 수 없어요',
  $q$insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g1')::uuid, repeat('가', 31), 1, 1)$q$);
select pg_temp.raises('DB-J14', '입력값 공격', '일정 메모는 100자를 넘을 수 없어요',
  $q$insert into public.family_events (group_id, title, month, day, memo) values (pg_temp.id('g1')::uuid, '메모', 1, 1, repeat('가', 101))$q$);
select pg_temp.raises('DB-J15', '입력값 공격', '사진 경로에 "../" 를 넣어 다른 그룹 폴더를 가리킬 수 없어요',
  $q$insert into public.posts (group_id, image_paths) values (pg_temp.id('g1')::uuid, array[pg_temp.id('g1') || '/posts/../../' || pg_temp.id('g2') || '/posts/x.jpg'])$q$);
select pg_temp.raises('DB-J16', '입력값 공격', '채팅 사진 경로로 남의 프로필 사진을 가리킬 수 없어요',
  $q$insert into public.messages (group_id, image_path) values (pg_temp.id('g1')::uuid, 'avatars/' || pg_temp.id('out') || '/a.jpg')$q$);
select pg_temp.raises('DB-J17', '입력값 공격', '알림 주소는 https 만 (http 주소 거절)',
  $q$select public.push_subscribe('http://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22))$q$);
select pg_temp.raises('DB-J18', '입력값 공격', '알림 주소에 javascript: 같은 이상한 주소를 넣을 수 없어요',
  $q$select public.push_subscribe('javascript:alert(1)', repeat('A', 87), repeat('B', 22))$q$);
select pg_temp.raises('DB-J19', '입력값 공격', '알림 암호 열쇠가 너무 짧으면 거절',
  $q$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/short', 'short', repeat('B', 22))$q$);
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/longdevice', repeat('A', 87), repeat('B', 22), repeat('기', 500));
select pg_temp.db();
select pg_temp.expect('DB-J20', '입력값 공격', '기기 이름이 아주 길어도 200자까지만 저장돼요',
  $q$select char_length(device)::text from public.push_subscriptions where endpoint like '%/longdevice'$q$, '200');
delete from public.push_subscriptions where endpoint like '%/longdevice';
select pg_temp.login('mom');
select pg_temp.raises('DB-J21', '입력값 공격', '안부 인사 번호는 정해진 범위(1~20)만',
  $q$insert into public.messages (group_id, content, greeting) values (pg_temp.id('g1')::uuid, '가짜 안부', 99)$q$);
select pg_temp.raises('DB-J22', '입력값 공격', '13월 같은 없는 달은 거절',
  $q$insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g1')::uuid, '13월', 13, 1)$q$);
select pg_temp.raises('DB-J23', '입력값 공격', '음력 31일 같은 없는 날은 거절',
  $q$insert into public.family_events (group_id, title, calendar, month, day) values (pg_temp.id('g1')::uuid, '음력31', 'lunar', 1, 31)$q$);
select pg_temp.raises('DB-J24', '입력값 공격', '양력 일정에 윤달 표시를 할 수 없어요',
  $q$insert into public.family_events (group_id, title, calendar, month, day, leap) values (pg_temp.id('g1')::uuid, '윤달', 'solar', 1, 1, true)$q$);
select pg_temp.raises('DB-J25', '입력값 공격', '알림 날짜를 40개 넘게 넣을 수 없어요',
  $q$insert into public.family_events (group_id, title, month, day, next_dates) values (pg_temp.id('g1')::uuid, '많은 날짜', 1, 1, (select array_agg(current_date + i) from generate_series(1, 41) i))$q$);
select pg_temp.raises('DB-J26', '입력값 공격', '정해진 종류(생신 · 기일 · 기념일 · 일정) 밖은 거절',
  $q$insert into public.family_events (group_id, title, kind, month, day) values (pg_temp.id('g1')::uuid, '파티', 'party', 1, 1)$q$);
select pg_temp.raises('DB-J27', '입력값 공격', '글 하나에 사진 · 동영상은 10개까지',
  $q$insert into public.posts (group_id, image_paths) values (pg_temp.id('g1')::uuid, (select array_agg(pg_temp.id('g1') || '/posts/' || i || '.jpg') from generate_series(1, 11) i))$q$);
select pg_temp.raises('DB-J28', '입력값 공격', '아이디에 이모지를 쓸 수 없어요',
  $q$update public.profiles set handle = 'mom😀' where id = pg_temp.id('mom')::uuid$q$);
select pg_temp.db();


-- =====================================================================
-- U. 알림 주소(휴대폰) 보호
-- =====================================================================
select pg_temp.login('dad');
select pg_temp.raises('DB-U01', '알림 주소 보호', '다른 사람의 알림 주소 표를 직접 읽을 수 없어요',
  $q$select endpoint from public.push_subscriptions$q$);
select pg_temp.expect('DB-U02', '알림 주소 보호', '내 채팅 알림은 같은 그룹 가족 기기로만 가요 (외부인 기기 없음)',
  $q$select string_agg(right(endpoint, 3), ',' order by endpoint) from public.push_targets('message', pg_temp.id('m2')::uuid)$q$, 'kid,mom');
select pg_temp.login('out');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/mom', repeat('Z', 87), repeat('Y', 22), '가로채기');
select pg_temp.db();
select pg_temp.expect('DB-U03', '알림 주소 보호', '남의 기기 알림 주소를 알아내도 다른 열쇠로는 내 것으로 가로챌 수 없어요',
  $q$select (user_id = pg_temp.id('mom')::uuid and p256dh = repeat('A', 87))::text from public.push_subscriptions where endpoint like '%/send/mom'$q$, 'true');
-- 같은 휴대폰을 다른 가족이 이어서 쓰는 경우(같은 열쇠) → 정상적으로 넘겨받아요
insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, device)
  values ('https://fcm.googleapis.com/fcm/send/shared', pg_temp.id('new')::uuid, repeat('S', 87), repeat('T', 22), '같이 쓰는 폰');
select pg_temp.login('inv');
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/shared', repeat('S', 87), repeat('T', 22), '같이 쓰는 폰');
select pg_temp.db();
select pg_temp.expect('DB-U04', '알림 주소 보호', '(정상 기능) 같은 휴대폰에서 다른 계정으로 로그인하면 그 계정이 알림을 이어받아요',
  $q$select (user_id = pg_temp.id('inv')::uuid)::text from public.push_subscriptions where endpoint like '%/send/shared'$q$, 'true');
select pg_temp.login('out');
select public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/dad');
select pg_temp.login('dad');
select public.push_forget(array['https://fcm.googleapis.com/fcm/send/out']);
select pg_temp.db();
select pg_temp.expect('DB-U05', '알림 주소 보호', '남의 기기 알림을 "끄기"로 지울 수 없어요',
  $q$select count(*)::text from public.push_subscriptions where endpoint like '%/send/dad'$q$, '1');
select pg_temp.expect('DB-U06', '알림 주소 보호', '같은 그룹이 아닌 사람의 기기 알림은 정리 기능으로도 못 지워요',
  $q$select count(*)::text from public.push_subscriptions where endpoint like '%/send/out'$q$, '1');
-- (선택 설정) 알림 서버 전용 열쇠: Vault 에 push_db_key 가 있으면, 그 열쇠를 가진 알림 서버만 받을 사람 목록을 받아요
insert into vault.decrypted_secrets values ('push_db_key', 'k-security-test');
select pg_temp.login('dad');
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '열쇠 시험') returning id)
insert into pg_temp.ids select 'm4', id::text from x;
select pg_temp.expect('DB-U07', '알림 주소 보호', '알림 서버 열쇠가 설정되면, 앱에서 직접 불러서는 가족 기기 주소를 못 받아요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m4')::uuid)$q$, '0');
select set_config('request.headers', '{"x-push-key":"wrong-key"}', false);
select pg_temp.expect('DB-U08', '알림 주소 보호', '틀린 열쇠로도 못 받아요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m4')::uuid)$q$, '0');
select set_config('request.headers', '{"x-push-key":"k-security-test"}', false);
select pg_temp.expect('DB-U09', '알림 주소 보호', '(정상 기능) 맞는 열쇠를 가진 알림 서버는 받아요 (앞의 시도가 알림을 막지 않아요)',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m4')::uuid)$q$, '2');
select set_config('request.headers', '{}', false);
select public.push_forget(array['https://fcm.googleapis.com/fcm/send/mom']);
select pg_temp.db();
select pg_temp.expect('DB-U10', '알림 주소 보호', '열쇠 없이 "정리" 기능으로 가족 기기 알림을 지울 수 없어요',
  $q$select count(*)::text from public.push_subscriptions where endpoint like '%/send/mom'$q$, '1');
delete from vault.decrypted_secrets where name = 'push_db_key';


-- =====================================================================
-- F. 안드로이드 앱(크롬 없이) 알림: Firebase 알림 주소 (버전 16)
-- =====================================================================
select pg_temp.login('dad');
select pg_temp.raises('DB-F01', '앱 알림 (Firebase)', 'Firebase 알림 주소는 정해진 모양만 받아요 (이상한 글자 · 너무 짧은 주소 거절)',
  $q$select public.push_subscribe_fcm('bad token!')$q$, '%올바르지%');
select pg_temp.allowed('DB-F02', '앱 알림 (Firebase)', '(정상 기능) 안드로이드 앱이 이 휴대폰의 Firebase 알림 주소를 등록해요',
  $q$select public.push_subscribe_fcm('dadTOKEN_' || repeat('a', 140), '안드로이드 앱')$q$);
select pg_temp.raises('DB-F03', '앱 알림 (Firebase)', '웹 알림 등록으로 fcm: 주소를 몰래 만들 수 없어요',
  $q$select public.push_subscribe('fcm:hack' || repeat('b', 40), repeat('A', 87), repeat('B', 22))$q$);
select pg_temp.db();
select pg_temp.expect('DB-F04', '앱 알림 (Firebase)', 'Firebase 주소는 fcm: 으로 저장되고, 웹 알림 열쇠 칸은 비어 있어요',
  $q$select (kind = 'fcm' and p256dh is null and auth is null and user_id = pg_temp.id('dad')::uuid)::text
     from public.push_subscriptions where endpoint = 'fcm:dadTOKEN_' || repeat('a', 140)$q$, 'true');
select pg_temp.raises('DB-F05', '앱 알림 (Firebase)', 'Firebase 주소 칸에 웹 알림 열쇠를 섞어 넣을 수 없어요',
  $q$insert into public.push_subscriptions (endpoint, user_id, kind, p256dh, auth) values ('fcm:mixed' || repeat('c', 30), pg_temp.id('dad')::uuid, 'fcm', repeat('A', 87), repeat('B', 22))$q$);
select pg_temp.login('mom');
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '앱 알림 시험') returning id)
insert into pg_temp.ids select 'mf', id::text from x;
select pg_temp.expect('DB-F06', '앱 알림 (Firebase)', '알림 서버 전용 열쇠가 없으면 Firebase 주소는 누구에게도 나가지 않아요 (웹 알림은 그대로)',
  $q$select 'fcm=' || count(*) filter (where kind = 'fcm') || '|web=' || count(*) filter (where kind = 'web') from public.push_targets('message', pg_temp.id('mf')::uuid)$q$, 'fcm=0|web=2');
select pg_temp.db();
insert into vault.decrypted_secrets values ('push_db_key', 'k-fcm-test');
select pg_temp.login('mom');
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '앱 알림 시험 2') returning id)
insert into pg_temp.ids select 'mf2', id::text from x;
select set_config('request.headers', '{"x-push-key":"k-wrong"}', false);
select pg_temp.expect('DB-F07', '앱 알림 (Firebase)', '틀린 열쇠로는 Firebase 주소도 웹 주소도 못 받아요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('mf2')::uuid)$q$, '0');
select set_config('request.headers', '{"x-push-key":"k-fcm-test"}', false);
select pg_temp.expect('DB-F08', '앱 알림 (Firebase)', '(정상 기능) 맞는 열쇠를 가진 알림 서버만 가족의 Firebase 주소까지 받아요',
  $q$select 'fcm=' || count(*) filter (where kind = 'fcm') || '|web=' || count(*) filter (where kind = 'web') from public.push_targets('message', pg_temp.id('mf2')::uuid)$q$, 'fcm=1|web=2');
select set_config('request.headers', '{}', false);
select pg_temp.db();
delete from vault.decrypted_secrets where name = 'push_db_key';
select pg_temp.login('out');
select pg_temp.allowed('DB-F09', '앱 알림 (Firebase)', '(설계 확인) 같은 휴대폰에서 다른 계정으로 로그인하면 그 계정이 Firebase 주소를 이어받아요',
  $q$select public.push_subscribe_fcm('dadTOKEN_' || repeat('a', 140), '같은 휴대폰')$q$);
select pg_temp.allowed('DB-F10', '앱 알림 (Firebase)', '(정상 기능) 로그아웃하면 이 휴대폰의 Firebase 주소를 지워요',
  $q$select public.push_unsubscribe('fcm:dadTOKEN_' || repeat('a', 140))$q$, 0);
select pg_temp.db();
select pg_temp.expect('DB-F11', '앱 알림 (Firebase)', '지운 Firebase 주소는 정말 없어졌어요',
  $q$select count(*)::text from public.push_subscriptions where endpoint like 'fcm:dadTOKEN_%'$q$, '0');


-- =====================================================================
-- R. 도배 · 과다 사용 막기 (하루 한도)
-- =====================================================================
-- 그룹 만들기: 하루 5개
insert into public.family_groups (name, created_by) select '도배' || i, pg_temp.id('new')::uuid from generate_series(1, 5) i;
select pg_temp.login('new');
select pg_temp.raises('DB-R01', '도배 · 과다 사용', '그룹은 하루 5개까지만 만들 수 있어요',
  $q$select public.create_group('여섯 번째')$q$, '%하루에 5개%');
select pg_temp.db();
-- 초대: 하루 30번
insert into public.group_invitations (group_id, inviter_id, invitee_id, status)
  select pg_temp.id('g2')::uuid, pg_temp.id('out')::uuid, pg_temp.id('new')::uuid, 'canceled' from generate_series(1, 30);
select pg_temp.login('out');
select pg_temp.raises('DB-R02', '도배 · 과다 사용', '초대는 하루 30번까지만 보낼 수 있어요 (모르는 사람에게 초대 폭탄 방지)',
  $q$select public.invite_by_handle(pg_temp.id('g2')::uuid, 'sec_inv')$q$, '%하루에 30번%');
-- 거절한 사람에게 바로 다시 초대
select pg_temp.login('mom');
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_new');
select pg_temp.login('new');
select public.respond_invitation((select id from public.get_my_invitations() where group_id = pg_temp.id('g1')::uuid), false);
select pg_temp.login('mom');
select pg_temp.raises('DB-R03', '도배 · 과다 사용', '거절한 사람에게 3일 안에 다시 초대할 수 없어요',
  $q$select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_new')$q$, '%거절%');
-- 초대 메일: 같은 사람에게 10분에 1통
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_gone');
select public.cancel_invitation((select id from public.group_invitations where invitee_id = pg_temp.id('gone')::uuid and status = 'pending'));
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_gone');
select pg_temp.db();
select pg_temp.expect('DB-R04', '도배 · 과다 사용', '초대 메일은 같은 사람에게 10분에 1통만 가요 (메일 폭탄 방지)',
  $q$select count(*)::text from net.sent where body -> 'to' ->> 0 = 'gone@sec.test'$q$, '1');
-- 자녀 가입 링크: 하루 10개
insert into public.guardian_consents (token, guardian_id, terms_version, expires_at)
  select md5(random()::text) || i, pg_temp.id('new')::uuid, '2026-01-01', now() - interval '1 minute' from generate_series(1, 10) i;
select pg_temp.login('new', 30);
select pg_temp.raises('DB-R05', '도배 · 과다 사용', '자녀 가입 링크는 하루 10개까지만',
  $q$select * from public.create_guardian_link('2026-01-01')$q$, '%하루에 10개%');
-- 동영상: 하루 10개
select pg_temp.login('mom');
insert into storage.objects (bucket_id, name) select 'family-photos', pg_temp.id('g1') || '/chat/v' || i || '.mp4' from generate_series(1, 10) i;
select pg_temp.raises('DB-R06', '도배 · 과다 사용', '동영상은 한 사람이 하루 10개까지만 올려요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/chat/v11.mp4')$q$);
select pg_temp.raises('DB-R07', '도배 · 과다 사용', '사진 칸에 사진 · 동영상이 아닌 파일(.html)은 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/page.html')$q$);
select pg_temp.raises('DB-R08', '도배 · 과다 사용', '정해진 폴더보다 더 깊은 곳(posts/a/b.jpg)에는 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/a/b.jpg')$q$);
select pg_temp.db();
-- 사진: 하루 300장
insert into storage.objects (bucket_id, name, owner_id)
  select 'family-photos', pg_temp.id('g1') || '/posts/bulk' || i || '.jpg', pg_temp.id('dad') from generate_series(1, 300) i;
select pg_temp.login('dad');
select pg_temp.raises('DB-R09', '도배 · 과다 사용', '사진은 한 사람이 하루 300장까지만 올려요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/301.jpg')$q$);
select pg_temp.db();
-- 프로필 사진 칸: 사진만, 하루 20번
select pg_temp.login('new');
select pg_temp.raises('DB-R10', '도배 · 과다 사용', '프로필 사진 칸에 동영상(50MB)을 올려 한도를 피할 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', 'avatars/' || pg_temp.id('new') || '/big.mp4')$q$);
select pg_temp.db();
insert into storage.objects (bucket_id, name, owner_id)
  select 'family-photos', 'avatars/' || pg_temp.id('new') || '/old' || i || '.jpg', pg_temp.id('new') from generate_series(1, 20) i;
select pg_temp.login('new');
select pg_temp.raises('DB-R11', '도배 · 과다 사용', '프로필 사진은 하루 20번까지만 올려요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', 'avatars/' || pg_temp.id('new') || '/21.jpg')$q$);
select pg_temp.db();
-- 하루 올리는 양: 500MB
insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('family-photos', pg_temp.id('g1') || '/chat/huge.mp4', pg_temp.id('left'), '{"size": 524288000, "mimetype": "video/mp4"}');
select pg_temp.login('left');
select pg_temp.raises('DB-R12', '도배 · 과다 사용', '한 사람이 하루에 올리는 양은 모두 합쳐 500MB 까지 (저장 공간 바닥내기 방지)',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/more.jpg')$q$);
select pg_temp.db();
-- 가족 달력: 한 사람이 하루 30개, 그룹에 300개
insert into public.family_events (group_id, title, month, day, created_by)
  select pg_temp.id('g1')::uuid, '많은 일정' || i, 1, 1, pg_temp.id('kid')::uuid from generate_series(1, 30) i;
select pg_temp.login('kid');
select pg_temp.raises('DB-R13', '도배 · 과다 사용', '일정은 한 사람이 하루 30개까지만 만들어요',
  $q$insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g1')::uuid, '31번째', 1, 1)$q$);
select pg_temp.db();
insert into public.family_events (group_id, title, month, day, created_by, created_at)
  select pg_temp.id('g2')::uuid, '옛 일정' || i, 1, 1, pg_temp.id('out')::uuid, now() - interval '3 days' from generate_series(1, 300) i;
select pg_temp.login('out');
select pg_temp.raises('DB-R14', '도배 · 과다 사용', '한 그룹 달력에는 일정 300개까지',
  $q$insert into public.family_events (group_id, title, month, day) values (pg_temp.id('g2')::uuid, '301번째', 1, 1)$q$);
select pg_temp.db();
-- 달력 알림: 그룹마다 하루 20번
insert into public.family_events (group_id, title, month, day, next_dates, created_by)
  select pg_temp.id('g1')::uuid, '오늘 일정' || i, 1, 1, array[pg_temp.id('today')::date], pg_temp.id('mom')::uuid from generate_series(1, 21) i;
select pg_temp.login('mom');
select pg_temp.expect('DB-R15', '도배 · 과다 사용', '달력 알림은 그룹마다 하루 20번까지만 (알림 폭탄 방지)',
  $q$select count(*)::text from (select e.id from public.family_events e where e.title like '오늘 일정%') e
     where exists (select 1 from public.push_targets('event', e.id))$q$, '20');
-- 시험 알림 · 같은 메시지 두 번 · 오래된 메시지 · 남의 메시지
select pg_temp.expect('DB-R16', '도배 · 과다 사용', '시험 알림은 30초에 한 번만',
  $q$select (select count(*) from public.push_targets('test')) || '|' || (select count(*) from public.push_targets('test'))$q$, '1|0');
with x as (insert into public.messages (group_id, content) values (pg_temp.id('g1')::uuid, '한 번만') returning id)
insert into pg_temp.ids select 'm5', id::text from x;
select pg_temp.expect('DB-R17', '도배 · 과다 사용', '같은 메시지로 알림을 두 번 보낼 수 없어요',
  $q$select ((select count(*) from public.push_targets('message', pg_temp.id('m5')::uuid)) > 0)::text || '|' || (select count(*) from public.push_targets('message', pg_temp.id('m5')::uuid))$q$, 'true|0');
select pg_temp.db();
with x as (insert into public.messages (group_id, sender_id, content, created_at)
           values (pg_temp.id('g1')::uuid, pg_temp.id('mom')::uuid, '오래된 메시지', now() - interval '11 minutes') returning id)
insert into pg_temp.ids select 'm_old', id::text from x;
select pg_temp.login('mom');
select pg_temp.expect('DB-R18', '도배 · 과다 사용', '10분 지난 메시지로는 알림을 다시 보낼 수 없어요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m_old')::uuid)$q$, '0');
select pg_temp.db();
with x as (insert into public.messages (group_id, sender_id, content) values (pg_temp.id('g1')::uuid, pg_temp.id('mom')::uuid, '엄마 새 메시지') returning id)
insert into pg_temp.ids select 'm6', id::text from x;
select pg_temp.login('dad');
select pg_temp.expect('DB-R19', '도배 · 과다 사용', '남이 보낸 메시지로 알림을 보낼 수 없어요',
  $q$select count(*)::text from public.push_targets('message', pg_temp.id('m6')::uuid)$q$, '0');
select pg_temp.db();
update public.group_invitations set status = 'canceled' where group_id = pg_temp.id('g1')::uuid and status = 'pending';
insert into public.group_invitations (group_id, inviter_id, invitee_id, created_at)
  values (pg_temp.id('g1')::uuid, pg_temp.id('mom')::uuid, pg_temp.id('out')::uuid, now() - interval '11 minutes');
select pg_temp.login('mom');
select pg_temp.expect('DB-R20', '도배 · 과다 사용', '10분 지난 초대로는 초대 알림을 보낼 수 없어요',
  $q$select count(*)::text from public.push_targets('invite', pg_temp.id('g1')::uuid)$q$, '0');
select pg_temp.db();


-- =====================================================================
-- M. 메일 안전 (초대 · 승인 요청 메일)
-- =====================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.id('mail1')::uuid, 'mail1@sec.test', '{"nickname":"메일하나","handle":"sec_mail1"}');
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (pg_temp.id('mail2')::uuid, 'mail2@sec.test', '{"nickname":"메일둘","handle":"sec_mail2"}', null);
select pg_temp.login('mom');
update public.family_groups set name = '<b>evil.com/로그인</b>' where id = pg_temp.id('g1')::uuid;
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_mail1');
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_mail2');
update public.family_groups set name = '우리 가족' where id = pg_temp.id('g1')::uuid;
select pg_temp.db();
select pg_temp.expect('DB-M01', '메일 안전', '그룹 이름에 넣은 HTML 태그는 메일에서 글자로만 보여요',
  $q$select (body ->> 'html' like '%&lt;b&gt;%' and body ->> 'html' not like '%<b>evil%')::text from net.sent where body -> 'to' ->> 0 = 'mail1@sec.test'$q$, 'true');
select pg_temp.expect('DB-M02', '메일 안전', '그룹 이름에 넣은 인터넷 주소가 메일 본문에서 링크처럼 보이지 않아요 (가짜 로그인 사이트 유도 방지)',
  $q$select (body ->> 'html' not like '%evil.com%')::text from net.sent where body -> 'to' ->> 0 = 'mail1@sec.test'$q$, 'true');
select pg_temp.expect('DB-M03', '메일 안전', '메일 제목에도 인터넷 주소가 그대로 들어가지 않아요',
  $q$select (body ->> 'subject' not like '%evil.com%')::text from net.sent where body -> 'to' ->> 0 = 'mail1@sec.test'$q$, 'true');
select pg_temp.expect('DB-M04', '메일 안전', '이메일 인증을 안 한 주소로는 메일을 보내지 않아요',
  $q$select count(*)::text from net.sent where body -> 'to' ->> 0 = 'mail2@sec.test'$q$, '0');
select pg_temp.expect('DB-M05', '메일 안전', '메일 속 버튼은 항상 도란톡 주소로만 가요',
  $q$select bool_and(body ->> 'html' ~ 'href="https://dorantalk\.com/#/[a-z/]+"')::text from net.sent$q$, 'true');
select pg_temp.login('kid');
select public.request_group('<img src=x onerror=alert(1)>');
select pg_temp.db();
select pg_temp.expect('DB-M06', '메일 안전', '아이가 보낸 그룹 이름 속 HTML도 보호자 메일에서 글자로만 보여요',
  $q$select (body ->> 'html' like '%&lt;img%' and body ->> 'html' not like '%<img%')::text from net.sent where body -> 'to' ->> 0 = 'mom@sec.test' order by id desc limit 1$q$, 'true');
select pg_temp.login('mom');
select pg_temp.raises('DB-M07', '메일 안전', '메일 보내기 함수는 사용자가 직접 부를 수 없어요 (스팸 발송 방지)',
  $q$select public.send_mail('victim@example.com', '스팸', '스팸')$q$);
select pg_temp.db();


-- =====================================================================
-- V. 개인정보
-- =====================================================================
select pg_temp.login('admin');
select pg_temp.expect('DB-V01', '개인정보', '운영자 통계에도 이메일 주소가 하나도 없어요', $q$select (public.admin_stats()::text not like '%@%')::text$q$, 'true');
select pg_temp.expect('DB-V02', '개인정보', '운영자 통계에 닉네임 · 아이디가 없어요 (숫자만)',
  $q$select (public.admin_stats()::text not like '%sec_mom%' and public.admin_stats()::text not like '%엄마%')::text$q$, 'true');
select pg_temp.expect('DB-V03', '개인정보', '운영자 쿠폰 목록에 누가 · 어느 가족이 썼는지 없어요',
  $q$select (public.admin_premium_summary()::text not like '%used_by%' and public.admin_premium_summary()::text not like '%used_group%')::text$q$, 'true');
select pg_temp.login('mom');
select pg_temp.expect('DB-V04', '개인정보', '보호자에게도 자녀 이메일 주소는 안 보여요 (인증 여부만)',
  $q$select (row_to_json(c)::text not like '%@%')::text from public.my_children() c limit 1$q$, 'true');
select pg_temp.login('mail1');
select pg_temp.expect('DB-V05', '개인정보', '받은 초대 목록에는 나에게 온 초대만 보여요',
  $q$select count(*)::text from public.get_my_invitations()$q$, '1');
select pg_temp.login('out');
select pg_temp.expect('DB-V06', '개인정보', '아이의 닉네임 · 아이디는 모르는 사람에게 안 보여요',
  $q$select count(*)::text from public.profiles where id = pg_temp.id('kid')::uuid$q$, '0');
-- 운영자 계정은 이메일 인증을 마쳐야만 운영자 (인증 안 된 같은 주소로는 운영자 기능 · 운영자 이름 불가)
select pg_temp.db();
update auth.users set email_confirmed_at = null where id = pg_temp.id('admin')::uuid;
select pg_temp.login('admin');
select pg_temp.raises('DB-V07', '개인정보', '이메일 인증을 안 마친 운영자 주소로는 가입 통계를 볼 수 없어요',
  $q$select public.admin_stats()$q$, '%운영자만%');
select pg_temp.raises('DB-V08', '개인정보', '이메일 인증을 안 마친 운영자 주소로는 "관리자" 이름을 쓸 수 없어요',
  $q$update public.profiles set nickname = '관리자' where id = pg_temp.id('admin')::uuid$q$, '%운영자만%');
select pg_temp.db();
update auth.users set email_confirmed_at = now() where id = pg_temp.id('admin')::uuid;
select pg_temp.login('admin');
select pg_temp.allowed('DB-V09', '개인정보', '(정상 기능) 인증을 마친 운영자는 운영자 이름을 쓸 수 있어요',
  $q$update public.profiles set nickname = '관리자' where id = pg_temp.id('admin')::uuid$q$);
select pg_temp.db();


-- =====================================================================
-- L. 그룹 나가기 · 탈퇴
-- =====================================================================
select pg_temp.login('left');
select pg_temp.allowed('DB-L01', '탈퇴 · 나가기', '(정상 기능) 그룹을 스스로 나갈 수 있어요',
  $q$delete from public.group_members where group_id = pg_temp.id('g1')::uuid and user_id = pg_temp.id('left')::uuid$q$);
select pg_temp.expect('DB-L02', '탈퇴 · 나가기', '나간 뒤에는 그 그룹 채팅이 안 보여요',
  $q$select count(*)::text from public.messages where group_id = pg_temp.id('g1')::uuid$q$, '0');
select pg_temp.blocked('DB-L03', '탈퇴 · 나가기', '나간 뒤에는 그 그룹에 글을 쓸 수 없어요',
  $q$insert into public.posts (group_id, content) values (pg_temp.id('g1')::uuid, '나갔지만')$q$);
select pg_temp.blocked('DB-L04', '탈퇴 · 나가기', '나간 뒤에는 그 그룹 달력을 건드릴 수 없어요 (내가 만든 일정도)',
  $q$delete from public.family_events where id = pg_temp.id('e2')::uuid$q$);
select pg_temp.raises('DB-L05', '탈퇴 · 나가기', '나간 뒤에는 그 그룹 폴더에 파일을 올릴 수 없어요',
  $q$insert into storage.objects (bucket_id, name) values ('family-photos', pg_temp.id('g1') || '/posts/after.jpg')$q$);
-- 방장이 나가면 방장이 넘어가고, 옛 방장은 이름을 못 바꿔요
select pg_temp.login('inv');
select pg_temp.put('g3', public.create_group('방장 넘기기')::text);
select public.invite_by_handle(pg_temp.id('g3')::uuid, 'sec_mail1');
select pg_temp.login('mail1');
select public.respond_invitation((select id from public.get_my_invitations() where group_id = pg_temp.id('g3')::uuid), true);
select pg_temp.login('inv');
delete from public.group_members where group_id = pg_temp.id('g3')::uuid and user_id = pg_temp.id('inv')::uuid;
select pg_temp.db();
select pg_temp.expect('DB-L06', '탈퇴 · 나가기', '방장이 나가면 남은 가족에게 방장이 자동으로 넘어가요',
  $q$select (g.created_by = pg_temp.id('mail1')::uuid and m.role = 'owner')::text from public.family_groups g
     join public.group_members m on m.group_id = g.id and m.user_id = pg_temp.id('mail1')::uuid where g.id = pg_temp.id('g3')::uuid$q$, 'true');
select pg_temp.login('inv');
select pg_temp.blocked('DB-L07', '탈퇴 · 나가기', '나간 옛 방장은 그룹 이름을 바꿀 수 없어요',
  $q$update public.family_groups set name = '옛 방장' where id = pg_temp.id('g3')::uuid$q$);
-- 탈퇴: 내 정보 · 멤버 기록이 지워져요
select pg_temp.login('mom');
select public.invite_by_handle(pg_temp.id('g1')::uuid, 'sec_gone');
select pg_temp.login('gone');
select public.respond_invitation((select id from public.get_my_invitations() where group_id = pg_temp.id('g1')::uuid), true);
select public.delete_my_account();
select pg_temp.db();
select pg_temp.expect('DB-L08', '탈퇴 · 나가기', '탈퇴하면 계정 · 닉네임 · 그룹 멤버 기록이 모두 지워져요',
  $q$select ((select count(*) from auth.users where id = pg_temp.id('gone')::uuid)
          + (select count(*) from public.profiles where id = pg_temp.id('gone')::uuid)
          + (select count(*) from public.group_members where user_id = pg_temp.id('gone')::uuid))::text$q$, '0');
select pg_temp.login('mom');
select pg_temp.allowed('DB-L09', '탈퇴 · 나가기', '(정상 기능) 보호자는 동의를 철회하고 아이 계정을 지울 수 있어요',
  $q$select public.delete_child_account(pg_temp.id('kid')::uuid)$q$);
select pg_temp.db();
select pg_temp.expect('DB-L10', '탈퇴 · 나가기', '아이 계정을 지우면 아이의 채팅 · 프로필도 함께 지워져요',
  $q$select ((select count(*) from public.messages where sender_id = pg_temp.id('kid')::uuid)
          + (select count(*) from public.profiles where id = pg_temp.id('kid')::uuid))::text$q$, '0');
select pg_temp.expect('DB-L11', '탈퇴 · 나가기', '외부인이 넣으려던 쿠폰은 여전히 쓰지 않은 상태예요 (침입 시도 흔적 없음)',
  $q$select (used_at is null)::text from public.premium_codes where code = pg_temp.id('code1')$q$, 'true');


-- =====================================================================
-- 결과
-- =====================================================================
select pg_temp.db();
select 'RESULT|' || id || '|' || cat || '|' || case when ok then 'PASS' else 'FAIL' end || '|' || title || '|' || coalesce(detail, '')
from pg_temp.results order by n;
select format('SUMMARY|%s|%s|%s', count(*), count(*) filter (where ok), count(*) filter (where not ok)) from pg_temp.results;
do $$
begin
  if exists (select 1 from pg_temp.results where not ok) then
    raise exception 'SECURITY TESTS FAILED: %', (select string_agg(id, ', ' order by n) from pg_temp.results where not ok);
  end if;
  raise notice 'ALL SECURITY TESTS PASSED';
end $$;
