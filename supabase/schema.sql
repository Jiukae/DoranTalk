-- =====================================================================
--  TalkFeed 데이터베이스 설계 (테이블 + 보안 규칙 RLS + 사진 저장소)
--  ★ 버전 4 (4단계: 소식·사진·댓글·하트) ★
--    앱 주소 뒤에 #/check 를 붙여 열면 DB 버전이 최신인지 확인할 수 있어요.
-- ---------------------------------------------------------------------
--  사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용을 전부 붙여넣고 Run
--  여러 번 실행해도 안전하도록(이미 있으면 건너뛰도록) 작성했습니다.
--
--  보안 원칙
--   1) 모든 테이블에 RLS(행 단위 보안)를 켭니다.
--   2) 그룹의 글·댓글·좋아요·채팅·사진은 "그 그룹 멤버"만 볼 수 있습니다.
--   3) 그룹 생성·초대·초대 응답은 아래 함수(RPC)로만 할 수 있어서
--      누군가 몰래 자기 자신을 남의 그룹에 넣는 일이 불가능합니다.
--   4) 로그인하지 않은 사용자(anon)는 "닉네임 중복 확인" 외에는 아무것도 못 합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 회원 정보 (닉네임). auth.users(Supabase 로그인 계정)와 1:1
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null
              check (nickname ~ '^[가-힣a-zA-Z0-9_]{2,12}$'),
  created_at  timestamptz not null default now()
);
-- 닉네임은 대소문자 구분 없이 전체에서 하나만
create unique index if not exists profiles_nickname_unique
  on public.profiles (lower(nickname));

-- 가족 그룹
create table if not exists public.family_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 그룹 멤버 (초대를 "수락"해야만 여기에 들어옵니다)
create table if not exists public.group_members (
  group_id    uuid not null references public.family_groups (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  joined_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- 초대
create table if not exists public.group_invitations (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.family_groups (id) on delete cascade,
  inviter_id    uuid references public.profiles (id) on delete set null,
  invitee_id    uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
-- 같은 사람에게 같은 그룹 초대가 동시에 두 개 대기하지 않도록
create unique index if not exists group_invitations_one_pending
  on public.group_invitations (group_id, invitee_id) where status = 'pending';
create index if not exists group_invitations_invitee_idx
  on public.group_invitations (invitee_id, status);
-- (3단계에서 추가) 초대 취소 상태 허용 — 예전에 만든 표에도 적용되도록 규칙을 다시 만듦
alter table public.group_invitations drop constraint if exists group_invitations_status_check;
alter table public.group_invitations add constraint group_invitations_status_check
  check (status in ('pending', 'accepted', 'declined', 'canceled'));

-- 피드 글 (사진은 저장소 경로 목록으로 보관)
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.family_groups (id) on delete cascade,
  author_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content      text not null default '' check (char_length(content) <= 5000),
  image_paths  text[] not null default '{}' check (cardinality(image_paths) <= 10),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (char_length(btrim(content)) > 0 or cardinality(image_paths) > 0)
);
create index if not exists posts_group_created_idx on public.posts (group_id, created_at desc);

-- 댓글
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists comments_post_created_idx on public.comments (post_id, created_at);

-- 좋아요(하트)
create table if not exists public.post_likes (
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 채팅 메시지 (글 또는 사진 중 하나는 꼭 있어야 함)
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.family_groups (id) on delete cascade,
  sender_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content     text check (content is null or char_length(content) <= 2000),
  image_path  text,
  created_at  timestamptz not null default now(),
  check (char_length(btrim(coalesce(content, ''))) > 0 or image_path is not null)
);
create index if not exists messages_group_created_idx on public.messages (group_id, created_at desc);

-- 채팅방별로 "어디까지 읽었는지" (안 읽은 메시지 표시에 사용)
create table if not exists public.chat_reads (
  group_id      uuid not null references public.family_groups (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);


-- (4단계에서 추가) 사진 경로 규칙: 글/채팅의 사진은 반드시 "자기 그룹 폴더" 안에 있어야 함
-- (not valid: 이미 있는 글은 건드리지 않고, 새로 쓰거나 고치는 글부터 검사)
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


-- ---------------------------------------------------------------------
-- 2. 보조 함수 (보안 규칙 안에서 사용)
--    security definer = 보안 규칙을 거치지 않고 "멤버인지"만 확인.
--    (규칙이 자기 자신을 다시 검사하며 무한 반복되는 문제를 막아 줍니다)
-- ---------------------------------------------------------------------

-- 내가 이 그룹의 멤버인가?
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;

-- 내가 이 글(이 글이 속한 그룹)의 멤버인가?
create or replace function public.can_access_post(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    join public.group_members m on m.group_id = p.group_id
    where p.id = pid and m.user_id = auth.uid()
  );
$$;

-- 이 사람의 닉네임을 내가 볼 수 있는가?
-- (나 자신 / 같은 그룹 멤버 / 나와 초대를 주고받은 사람 / 내 그룹에 초대되어 대기 중인 사람 /
--  그룹을 떠났지만 내 그룹에 글·댓글·채팅을 남긴 사람)
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

-- 수정 시각 자동 갱신
create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

drop trigger if exists comments_touch_updated_at on public.comments;
create trigger comments_touch_updated_at
  before update on public.comments
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 3. 회원가입 시 닉네임 자동 저장
--    앱이 가입할 때 넘긴 닉네임(user metadata)을 profiles에 넣습니다.
--    닉네임이 이미 있으면 가입 자체가 실패하므로 중복이 생길 수 없습니다.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, btrim(new.raw_user_meta_data ->> 'nickname'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 4. 앱에서 부르는 기능 함수 (RPC)
-- ---------------------------------------------------------------------

-- 이 SQL 파일의 버전 (앱의 "연결 점검" 화면이 최신인지 확인할 때 사용)
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 4 $$;

-- 닉네임 사용 가능 여부 (가입 화면에서 로그인 전에 확인)
create or replace function public.is_nickname_available(nick text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select btrim(coalesce(nick, '')) ~ '^[가-힣a-zA-Z0-9_]{2,12}$'
     and not exists (
       select 1 from public.profiles p
       where lower(p.nickname) = lower(btrim(nick))
     );
$$;

-- 가족 그룹 만들기 (만든 사람은 자동으로 방장이 됨)
create or replace function public.create_group(group_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if char_length(btrim(coalesce(group_name, ''))) not between 1 and 30 then
    raise exception '그룹 이름은 1~30자로 정해 주세요.';
  end if;

  insert into public.family_groups (name, created_by)
  values (btrim(group_name), uid)
  returning id into new_id;

  insert into public.group_members (group_id, user_id, role)
  values (new_id, uid, 'owner');

  insert into public.chat_reads (group_id, user_id) values (new_id, uid);

  return new_id;
end;
$$;

-- 닉네임으로 초대하기 (그룹 멤버만 가능)
create or replace function public.invite_by_nickname(gid uuid, nick text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.is_group_member(gid) then
    raise exception '이 그룹의 멤버만 초대할 수 있어요.';
  end if;

  select p.id into target
  from public.profiles p
  where lower(p.nickname) = lower(btrim(coalesce(nick, '')));

  if target is null then
    raise exception '"%" 닉네임을 가진 사람을 찾을 수 없어요.', btrim(coalesce(nick, ''));
  end if;
  if target = uid then
    raise exception '나 자신은 초대할 수 없어요.';
  end if;
  if exists (select 1 from public.group_members m
             where m.group_id = gid and m.user_id = target) then
    raise exception '이미 이 그룹의 멤버예요.';
  end if;
  if exists (select 1 from public.group_invitations i
             where i.group_id = gid and i.invitee_id = target and i.status = 'pending') then
    raise exception '이미 초대를 보냈어요. 상대방이 수락하기를 기다려 주세요.';
  end if;

  insert into public.group_invitations (group_id, inviter_id, invitee_id)
  values (gid, uid, target);
end;
$$;

-- 내가 받은 초대 목록 (아직 멤버가 아니므로 그룹 이름과 초대한 사람 닉네임만 보여 줌)
create or replace function public.get_my_invitations()
returns table (
  id uuid,
  group_id uuid,
  group_name text,
  inviter_nickname text,
  created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.group_id, g.name, p.nickname, i.created_at
  from public.group_invitations i
  join public.family_groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.inviter_id
  where i.invitee_id = auth.uid() and i.status = 'pending'
  order by i.created_at desc;
$$;

-- 초대 수락/거절
create or replace function public.respond_invitation(inv_id uuid, accept boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.group_invitations%rowtype;
begin
  select * into inv
  from public.group_invitations
  where id = inv_id and invitee_id = uid and status = 'pending'
  for update;

  if not found then
    raise exception '이 초대를 찾을 수 없어요. 이미 처리되었을 수 있어요.';
  end if;

  update public.group_invitations
  set status = case when accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = inv_id;

  if accept then
    insert into public.group_members (group_id, user_id, role)
    values (inv.group_id, uid, 'member')
    on conflict do nothing;

    insert into public.chat_reads (group_id, user_id)
    values (inv.group_id, uid)
    on conflict (group_id, user_id) do update set last_read_at = now();
  end if;

  return inv.group_id;
end;
$$;

-- 보낸 초대 취소 (그 그룹 멤버라면 누구나, 아직 대기 중인 초대만)
create or replace function public.cancel_invitation(inv_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.group_invitations i
  set status = 'canceled', responded_at = now()
  where i.id = inv_id
    and i.status = 'pending'
    and public.is_group_member(i.group_id);
  if not found then
    raise exception '이 초대를 취소할 수 없어요. 이미 수락·거절되었을 수 있어요.';
  end if;
end;
$$;

-- 채팅방을 열었을 때 "여기까지 읽음" 표시 (서버 시간 기준)
create or replace function public.mark_chat_read(gid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_group_member(gid) then
    raise exception '이 그룹의 멤버가 아니에요.';
  end if;
  insert into public.chat_reads (group_id, user_id, last_read_at)
  values (gid, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- 내 그룹별 안 읽은 메시지 수 (보안 규칙이 그대로 적용되도록 invoker로 실행)
create or replace function public.get_unread_counts()
returns table (group_id uuid, unread bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.group_id, count(msg.id)
  from public.group_members m
  left join public.chat_reads r
    on r.group_id = m.group_id and r.user_id = m.user_id
  left join public.messages msg
    on msg.group_id = m.group_id
   and msg.sender_id <> m.user_id
   and msg.created_at > coalesce(r.last_read_at, m.joined_at)
  where m.user_id = auth.uid()
  group by m.group_id;
$$;


-- ---------------------------------------------------------------------
-- 5. RLS(행 단위 보안) 켜기 + 규칙
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.family_groups     enable row level security;
alter table public.group_members     enable row level security;
alter table public.group_invitations enable row level security;
alter table public.posts             enable row level security;
alter table public.comments          enable row level security;
alter table public.post_likes        enable row level security;
alter table public.messages          enable row level security;
alter table public.chat_reads        enable row level security;

-- 다시 실행해도 되도록 기존 규칙을 지우고 새로 만듭니다
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','family_groups','group_members','group_invitations',
                        'posts','comments','post_likes','messages','chat_reads')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- profiles: 나/가족/초대 관계인 사람의 닉네임만 보임, 내 것만 수정
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (public.can_see_profile(id));
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- family_groups: 멤버만 보임, 이름 변경은 방장만
create policy "groups_select_member" on public.family_groups
  for select to authenticated
  using (public.is_group_member(id));
create policy "groups_update_owner" on public.family_groups
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
-- (그룹 생성은 create_group 함수로만)

-- group_members: 같은 그룹 멤버 목록만 보임, 본인은 스스로 나갈 수 있음
create policy "members_select" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "members_leave_self" on public.group_members
  for delete to authenticated
  using (user_id = (select auth.uid()));
-- (멤버 추가는 respond_invitation 함수로만)

-- group_invitations: 받은 사람 본인 또는 그 그룹 멤버만 보임
create policy "invitations_select" on public.group_invitations
  for select to authenticated
  using (invitee_id = (select auth.uid()) or public.is_group_member(group_id));
-- (초대 생성/응답은 함수로만)

-- posts: 그룹 멤버만 보고 쓸 수 있음, 수정·삭제는 작성자만
create policy "posts_select_member" on public.posts
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "posts_insert_member" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy "posts_update_author" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy "posts_delete_author" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- comments: 글이 속한 그룹 멤버만, 수정·삭제는 작성자만
create policy "comments_select_member" on public.comments
  for select to authenticated
  using (public.can_access_post(post_id));
create policy "comments_insert_member" on public.comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_access_post(post_id));
create policy "comments_update_author" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy "comments_delete_author" on public.comments
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- post_likes: 그룹 멤버만, 내 하트만 누르고 취소
create policy "likes_select_member" on public.post_likes
  for select to authenticated
  using (public.can_access_post(post_id));
create policy "likes_insert_self" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_access_post(post_id));
create policy "likes_delete_self" on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- messages: 그룹 멤버만 보고 보낼 수 있음
create policy "messages_select_member" on public.messages
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.is_group_member(group_id));

-- chat_reads: 같은 그룹 멤버의 읽음 위치만 보임 (카톡의 "1" 표시용)
create policy "reads_select_member" on public.chat_reads
  for select to authenticated
  using (public.is_group_member(group_id));
-- (읽음 표시는 mark_chat_read 함수로만)


-- ---------------------------------------------------------------------
-- 6. 권한(GRANT) 정리
--    로그인 안 한 사용자(anon)는 테이블에 아예 접근 불가.
--    로그인 사용자도 꼭 필요한 동작만 허용 (나머지는 RLS가 한 번 더 막음).
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on public.profiles, public.family_groups, public.group_members,
              public.group_invitations, public.posts, public.comments,
              public.post_likes, public.messages, public.chat_reads
  from anon, authenticated;

grant select                 on public.profiles          to authenticated;
grant update (nickname)      on public.profiles          to authenticated;
grant select                 on public.family_groups     to authenticated;
grant update (name)          on public.family_groups     to authenticated;
grant select, delete         on public.group_members     to authenticated;
grant select                 on public.group_invitations to authenticated;
-- 작성자·작성 시각 등은 서버가 자동으로 채우므로, 앱은 내용 칸만 넣을 수 있음
grant select, delete         on public.posts             to authenticated;
grant insert (group_id, content, image_paths) on public.posts to authenticated;
grant update (content, image_paths)           on public.posts to authenticated;
grant select, delete         on public.comments          to authenticated;
grant insert (post_id, content) on public.comments       to authenticated;
grant update (content)          on public.comments       to authenticated;
grant select, delete         on public.post_likes        to authenticated;
grant insert (post_id)       on public.post_likes        to authenticated;
grant select                 on public.messages          to authenticated;
grant insert (group_id, content, image_path) on public.messages to authenticated;
grant select                 on public.chat_reads        to authenticated;

-- 함수 실행 권한: 기본(누구나)을 없애고 필요한 사람에게만
revoke execute on function
  public.is_group_member(uuid),
  public.can_access_post(uuid),
  public.can_see_profile(uuid),
  public.touch_updated_at(),
  public.handle_new_user(),
  public.is_nickname_available(text),
  public.talkfeed_schema_version(),
  public.paths_in_group_folder(text[], uuid, text),
  public.create_group(text),
  public.invite_by_nickname(uuid, text),
  public.get_my_invitations(),
  public.respond_invitation(uuid, boolean),
  public.cancel_invitation(uuid),
  public.mark_chat_read(uuid),
  public.get_unread_counts()
  from public, anon, authenticated;

grant execute on function public.is_nickname_available(text) to anon, authenticated;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;
grant execute on function
  public.paths_in_group_folder(text[], uuid, text),
  public.is_group_member(uuid),
  public.can_access_post(uuid),
  public.can_see_profile(uuid),
  public.create_group(text),
  public.invite_by_nickname(uuid, text),
  public.get_my_invitations(),
  public.respond_invitation(uuid, boolean),
  public.cancel_invitation(uuid),
  public.mark_chat_read(uuid),
  public.get_unread_counts()
  to authenticated;


-- ---------------------------------------------------------------------
-- 7. 실시간(Realtime): 채팅·읽음·피드 변경을 새로고침 없이 받기
--    (Realtime도 위의 RLS를 그대로 지켜서, 멤버에게만 전달됩니다)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['messages', 'chat_reads', 'posts', 'comments', 'post_likes',
                           'group_invitations', 'group_members']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. 사진 저장소 (Storage)
--    비공개 버킷 'family-photos'. 파일 경로 규칙:
--      {그룹ID}/posts/{파일명}   ← 피드 사진
--      {그룹ID}/chat/{파일명}    ← 채팅 사진
--    경로 맨 앞의 그룹ID로 "그 그룹 멤버인지" 검사합니다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-photos', 'family-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "family_photos_select_member" on storage.objects;
drop policy if exists "family_photos_insert_member" on storage.objects;
drop policy if exists "family_photos_delete_owner"  on storage.objects;

-- 보기: 그 그룹 멤버만
create policy "family_photos_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'family-photos'
    and exists (
      select 1 from public.group_members m
      where m.group_id::text = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
    )
  );

-- 올리기: 그 그룹 멤버만, posts/chat 폴더에만
create policy "family_photos_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-photos'
    and (storage.foldername(name))[2] in ('posts', 'chat')
    and exists (
      select 1 from public.group_members m
      where m.group_id::text = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
    )
  );

-- 지우기: 내가 올린 사진만
create policy "family_photos_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'family-photos'
    and owner_id = (select auth.uid())::text
  );

-- 앱이 새 기능(함수)을 바로 찾을 수 있도록 서버의 목록을 새로고침
notify pgrst, 'reload schema';

-- 끝! 아래 "Success. No rows returned" 가 보이면 성공입니다.
