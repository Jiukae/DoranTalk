-- =====================================================================
--  TalkFeed 데이터베이스 설계 (테이블 + 보안 규칙 RLS + 사진 저장소)
--  ★ 버전 8 (만 14세 미만: 보호자 동의로 가입) ★
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
declare
  tok text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'guardian_token', '')), '');
begin
  insert into public.profiles (id, nickname)
  values (new.id, btrim(new.raw_user_meta_data ->> 'nickname'));

  -- (버전 8) 만 14세 미만은 보호자가 동의하고 만든 "자녀 가입 링크"로만 가입할 수 있어요
  if tok is null and (new.raw_user_meta_data ->> 'under_14_with_guardian') = 'true' then
    raise exception '만 14세 미만은 보호자가 보내 준 가입 링크로 가입해 주세요.';
  end if;
  if tok is not null then
    update public.guardian_consents c
    set child_id = new.id, used_at = now()
    where c.token = tok and c.child_id is null and c.guardian_id is not null and c.expires_at > now();
    if not found then
      raise exception '보호자 동의 링크가 만료되었거나 이미 사용되었어요. 보호자께 새 링크를 부탁해 주세요.';
    end if;
  end if;
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
as $$ select 8 $$;

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
  -- (버전 8) 만 14세 미만 계정은 보호자가 만든 그룹에 초대받아 들어가요
  if public.is_child_account(uid) then
    raise exception '만 14세 미만은 가족 그룹을 직접 만들 수 없어요. 보호자께 그룹을 만들어 초대해 달라고 해 주세요.';
  end if;
  -- (버전 7) 함부로 많이 만들지 못하게: 하루 5개, 한 사람이 들어가 있는 그룹은 20개까지
  if (select count(*) from public.family_groups g
      where g.created_by = uid and g.created_at > now() - interval '1 day') >= 5 then
    raise exception '그룹은 하루에 5개까지 만들 수 있어요. 내일 다시 해 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.user_id = uid) >= 20 then
    raise exception '가족 그룹은 20개까지 들어갈 수 있어요.';
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

  -- (버전 8) 만 14세 미만 계정은 보호자가 들어 있는 그룹에서만 찾을 수 있어요
  --          (모르는 사람이 아이 계정인지 알 수 없도록 "찾을 수 없어요"와 같은 안내를 보여 줘요)
  if target is null or (public.is_child_account(target) and not exists (
       select 1 from public.guardian_consents c
       join public.group_members m on m.user_id = c.guardian_id and m.group_id = gid
       where c.child_id = target)) then
    raise exception '"%" 닉네임을 가진 사람을 찾을 수 없어요. (만 14세 미만 가족은 보호자가 이 그룹에 있어야 초대할 수 있어요)', btrim(coalesce(nick, ''));
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
  -- (버전 7) 모르는 사람에게 초대를 마구 보내지 못하게
  if (select count(*) from public.group_invitations i
      where i.inviter_id = uid and i.created_at > now() - interval '1 day') >= 30 then
    raise exception '초대는 하루에 30번까지 보낼 수 있어요. 내일 다시 해 주세요.';
  end if;
  if exists (select 1 from public.group_invitations i
             where i.group_id = gid and i.invitee_id = target and i.status = 'declined'
               and i.responded_at > now() - interval '3 days') then
    raise exception '상대방이 최근에 이 초대를 거절했어요. 며칠 뒤에 다시 초대해 주세요.';
  end if;
  if (select count(*) from public.group_invitations i
      where i.group_id = gid and i.status = 'pending') >= 20 then
    raise exception '수락을 기다리는 초대가 너무 많아요. 가족 탭에서 대기 중인 초대를 먼저 정리해 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.group_id = gid)
     + (select count(*) from public.group_invitations i where i.group_id = gid and i.status = 'pending') >= 50 then
    raise exception '한 그룹에는 50명까지 들어올 수 있어요.';
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
  -- (버전 7) 한 그룹 50명까지
  if accept and (select count(*) from public.group_members m where m.group_id = inv.group_id) >= 50 then
    raise exception '이 그룹은 가족이 꽉 찼어요. (50명)';
  end if;
  -- (버전 8) 만 14세 미만은 보호자가 있는 그룹에만
  if accept and public.is_child_account(uid) and not exists (
       select 1 from public.guardian_consents c
       join public.group_members m on m.user_id = c.guardian_id and m.group_id = inv.group_id
       where c.child_id = uid) then
    raise exception '보호자가 이 그룹에 없어서 들어갈 수 없어요. 보호자께 먼저 이 그룹에 들어와 달라고 해 주세요.';
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

  -- (버전 8) 내가 만든, 아직 안 쓴 자녀 가입 링크도 함께 지워요 (이미 가입한 자녀의 동의 기록은 남아요)
  delete from public.guardian_consents c where c.guardian_id = uid and c.child_id is null;

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


-- ---------------------------------------------------------------------
-- 10. (버전 6) 휴대폰 알림 (웹 푸시)
--   - 기기마다 "알림 받을 주소"를 등록해 두고, 가족이 채팅·글·댓글·초대를 보내면
--     알림 서버(Supabase Edge Function "push")가 그 주소로 알림을 보내요.
--   - 누가 받을지, 무슨 글자를 보여 줄지는 아래 push_targets 함수가 정해요.
--     보낸 사람 본인 확인은 로그인 정보로 하므로, 관리용 비밀 키(service role)가 필요 없어요.
-- ---------------------------------------------------------------------

-- 알림 받을 기기 목록 (기기·브라우저마다 하나)
create table if not exists public.push_subscriptions (
  endpoint    text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  p256dh      text not null check (char_length(p256dh) between 40 and 200),
  auth        text not null check (char_length(auth) between 10 and 100),
  device      text check (device is null or char_length(device) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 같은 일로 알림이 두 번 가지 않게 남기는 기록 (하루 지나면 지움)
create table if not exists public.push_sent (
  kind     text not null,
  ref_id   uuid not null,
  sent_at  timestamptz not null default now(),
  primary key (kind, ref_id)
);

-- 두 표 모두 앱에서 직접 읽거나 쓸 수 없고, 아래 함수로만 다뤄요
alter table public.push_subscriptions enable row level security;
alter table public.push_sent          enable row level security;
revoke all on public.push_subscriptions, public.push_sent from anon, authenticated;

-- 이 기기를 내 알림 주소로 등록 (같은 기기를 다른 계정이 쓰던 기록이 있으면 내 것으로 바꿈)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요.';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, device)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_device, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device, created_at = now();
end;
$$;

-- 이 기기에서 알림 끄기 (로그아웃할 때도 불러요)
create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- 어떤 사람의 안 읽은 채팅 수 (알림이 올 때 앱 아이콘에 숫자로)
create or replace function public.unread_total_for(target uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(msg.id)::int
  from public.group_members m
  left join public.chat_reads r
    on r.group_id = m.group_id and r.user_id = m.user_id
  join public.messages msg
    on msg.group_id = m.group_id
   and msg.sender_id <> m.user_id
   and msg.created_at > coalesce(r.last_read_at, m.joined_at)
  where m.user_id = target;
$$;

-- 알림 보낼 곳과 내용 정하기 (알림 서버가 "보낸 사람"의 로그인 정보로 불러요)
--   p_kind: 'message'(채팅) · 'post'(새 소식) · 'comment'(댓글) · 'invite'(초대, p_id = 그룹) · 'test'(내 기기로 시험)
--   - 내가 방금(10분 안에) 보낸 것만, 한 번만 보낼 수 있어요.
--   - 받는 사람은 지금 그 그룹의 멤버만 (나 자신은 빼고)
create or replace function public.push_targets(p_kind text, p_id uuid default null)
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text, badge integer)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  me text;
  gid uuid;
  gname text;
  ref uuid;
  t_title text;
  t_body text;
  t_url text;
  t_tag text;
  pid uuid;
  recipients uuid[];
begin
  if uid is null then
    return;
  end if;
  select p.nickname into me from public.profiles p where p.id = uid;

  if p_kind = 'message' then
    select m.group_id, coalesce(nullif(btrim(m.content), ''), '사진을 보냈어요 📷')
      into gid, t_body
    from public.messages m
    where m.id = p_id and m.sender_id = uid and m.created_at > now() - interval '10 minutes';
    if gid is null then return; end if;
    select g.name into gname from public.family_groups g where g.id = gid;
    ref := p_id;
    t_title := gname || ' · ' || me;
    t_url := '/#/group/' || gid || '/chat';
    t_tag := 'chat-' || gid;
    select array_agg(gm.user_id) into recipients
    from public.group_members gm where gm.group_id = gid and gm.user_id <> uid;

  elsif p_kind = 'post' then
    select po.group_id,
           me || ': ' || coalesce(nullif(btrim(po.content), ''), '사진 ' || cardinality(po.image_paths) || '장을 올렸어요 📷')
      into gid, t_body
    from public.posts po
    where po.id = p_id and po.author_id = uid and po.created_at > now() - interval '10 minutes';
    if gid is null then return; end if;
    select g.name into gname from public.family_groups g where g.id = gid;
    ref := p_id;
    t_title := gname || ' · 새 소식';
    t_url := '/#/group/' || gid || '/post/' || p_id;
    t_tag := 'post-' || p_id;
    select array_agg(gm.user_id) into recipients
    from public.group_members gm where gm.group_id = gid and gm.user_id <> uid;

  elsif p_kind = 'comment' then
    select po.group_id, po.id, me || ': ' || c.content
      into gid, pid, t_body
    from public.comments c
    join public.posts po on po.id = c.post_id
    where c.id = p_id and c.author_id = uid and c.created_at > now() - interval '10 minutes';
    if gid is null then return; end if;
    select g.name into gname from public.family_groups g where g.id = gid;
    ref := p_id;
    t_title := gname || ' · 새 댓글';
    t_url := '/#/group/' || gid || '/post/' || pid;
    t_tag := 'comment-' || pid;
    -- 글쓴이 + 그 글에 댓글을 단 가족 (나 빼고, 지금도 그룹 멤버인 사람만)
    select array_agg(distinct x.user_id) into recipients
    from (
      select po.author_id as user_id from public.posts po where po.id = pid
      union
      select c2.author_id from public.comments c2 where c2.post_id = pid
    ) x
    where x.user_id <> uid
      and exists (select 1 from public.group_members gm where gm.group_id = gid and gm.user_id = x.user_id);

  elsif p_kind = 'invite' then
    -- p_id = 그룹. 내가 방금 그 그룹에 보낸 초대 중 아직 알리지 않은 것
    select i.id, i.invitee_id, g.name
      into ref, pid, gname
    from public.group_invitations i
    join public.family_groups g on g.id = i.group_id
    where i.group_id = p_id and i.inviter_id = uid and i.status = 'pending'
      and i.created_at > now() - interval '10 minutes'
      and not exists (select 1 from public.push_sent s where s.kind = 'invite' and s.ref_id = i.id)
    order by i.created_at desc
    limit 1;
    if ref is null then return; end if;
    t_title := '도란톡 초대';
    t_body := me || '님이 ''' || gname || ''' 그룹에 초대했어요. 눌러서 수락해 주세요.';
    t_url := '/#/home';
    t_tag := 'invite-' || ref;
    recipients := array[pid];

  elsif p_kind = 'test' then
    -- 내 기기로 시험 알림 (30초에 한 번)
    if exists (select 1 from public.push_sent s
               where s.kind = 'test' and s.ref_id = uid and s.sent_at > now() - interval '30 seconds') then
      return;
    end if;
    delete from public.push_sent s where s.kind = 'test' and s.ref_id = uid;
    ref := uid;
    t_title := '도란톡 알림 시험';
    t_body := '알림이 잘 와요! 가족이 채팅을 보내면 이렇게 알려 드려요. 🔔';
    t_url := '/#/me';
    t_tag := 'test';
    recipients := array[uid];

  else
    return;
  end if;

  -- 같은 일로 두 번 보내지 않기 (하루 지난 기록은 정리)
  delete from public.push_sent s where s.sent_at < now() - interval '1 day';
  insert into public.push_sent (kind, ref_id) values (p_kind, ref) on conflict do nothing;
  if not found then
    return;
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, t_title, left(t_body, 140), t_url, t_tag,
           public.unread_total_for(s.user_id)
    from public.push_subscriptions s
    where s.user_id = any(coalesce(recipients, '{}'));
end;
$$;

-- 더 이상 쓰지 않는 알림 주소 지우기 (휴대폰에서 앱을 지웠거나 알림을 막은 경우, 알림 서버가 알려 줘요)
-- 나 또는 같은 그룹 가족의 주소만 지울 수 있어요
create or replace function public.push_forget(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions s
  where s.endpoint = any(p_endpoints)
    and (s.user_id = auth.uid() or exists (
      select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
      where a.user_id = auth.uid() and b.user_id = s.user_id));
$$;

revoke execute on function
  public.push_subscribe(text, text, text, text),
  public.push_unsubscribe(text),
  public.unread_total_for(uuid),
  public.push_targets(text, uuid),
  public.push_forget(text[])
  from public, anon, authenticated;
grant execute on function
  public.push_subscribe(text, text, text, text),
  public.push_unsubscribe(text),
  public.push_targets(text, uuid),
  public.push_forget(text[])
  to authenticated;

-- ---------------------------------------------------------------------
-- 11. (버전 8) 만 14세 미만 가입: 보호자(법정대리인) 동의
--   1) 보호자가 로그인 → 비밀번호를 다시 확인 → 동의 내용을 읽고 체크 → "자녀 가입 링크"를 받아요.
--      (보호자 동의를 먼저 받은 뒤에 아이의 정보를 받아요)
--   2) 아이는 그 링크로 가입해요. 링크는 7일 안에 한 번만 쓸 수 있어요.
--   3) 아이 계정은 보호자가 들어 있는 그룹에만 초대받을 수 있고, 그룹을 직접 만들 수 없어요.
--   4) 보호자는 언제든 동의를 철회하고 아이 계정을 지울 수 있어요.
-- ---------------------------------------------------------------------
create table if not exists public.guardian_consents (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique,
  guardian_id    uuid references public.profiles (id) on delete set null,
  terms_version  text not null,
  consented_at   timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  child_id       uuid unique references public.profiles (id) on delete cascade,
  used_at        timestamptz
);
create index if not exists guardian_consents_guardian_idx on public.guardian_consents (guardian_id);
-- 앱에서 직접 읽거나 쓸 수 없고, 아래 함수로만 다뤄요
alter table public.guardian_consents enable row level security;
revoke all on public.guardian_consents from anon, authenticated;

-- 보호자 동의로 가입한 아이 계정인지
create or replace function public.is_child_account(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.guardian_consents c where c.child_id = target);
$$;

-- 내가(보호자) 동의해 가입한 아이의 것인지 (사진 창고 보안 규칙에서 사용)
create or replace function public.is_guardian_of(child text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.guardian_consents c
    where c.guardian_id = auth.uid() and c.child_id::text = child
  );
$$;

-- 10분 안에 비밀번호로 다시 로그인했는지 (로그인 정보의 amr 기록으로 확인)
-- 보호자의 휴대폰을 아이가 대신 들고 동의하는 일을 막아요
create or replace function public.recently_signed_in_with_password()
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) a
    where a ->> 'method' = 'password'
      and (a ->> 'timestamp') ~ '^[0-9]+$'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 600
  );
$$;

-- 보호자: 동의하고 자녀 가입 링크 만들기
create or replace function public.create_guardian_link(p_terms_version text)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if public.is_child_account(uid) then
    raise exception '만 14세 미만 계정은 보호자가 될 수 없어요.';
  end if;
  if not public.recently_signed_in_with_password() then
    raise exception '보호자 확인을 위해 비밀번호를 다시 입력해 주세요.';
  end if;
  if coalesce(p_terms_version, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '약관 정보가 올바르지 않아요. 앱을 새로고침해 주세요.';
  end if;
  -- 만료되고 하루 지난, 쓰지 않은 링크 정리
  delete from public.guardian_consents c where c.child_id is null and c.expires_at < now() - interval '1 day';
  if (select count(*) from public.guardian_consents c
      where c.guardian_id = uid and c.child_id is null and c.expires_at > now()) >= 5 then
    raise exception '아직 쓰지 않은 가입 링크가 5개 있어요. 쓰지 않을 링크를 먼저 취소해 주세요.';
  end if;
  if (select count(*) from public.guardian_consents c
      where c.guardian_id = uid and c.consented_at > now() - interval '1 day') >= 10 then
    raise exception '가입 링크는 하루에 10개까지 만들 수 있어요. 내일 다시 해 주세요.';
  end if;

  return query
  insert into public.guardian_consents (token, guardian_id, terms_version)
  values (replace(gen_random_uuid()::text, '-', ''), uid, p_terms_version)
  returning guardian_consents.token, guardian_consents.expires_at;
end;
$$;

-- 아이(로그인 전): 링크가 쓸 수 있는지 + 보호자 닉네임
create or replace function public.guardian_link_info(p_token text)
returns table (status text, guardian_nickname text)
language sql stable security definer set search_path = ''
as $$
  select case
           when c.id is null then 'not_found'
           when c.child_id is not null then 'used'
           when c.guardian_id is null or c.expires_at <= now() then 'expired'
           else 'ok'
         end,
         case when c.child_id is null and c.expires_at > now() then p.nickname end
  from (select 1) one
  left join public.guardian_consents c on c.token = btrim(coalesce(p_token, ''))
  left join public.profiles p on p.id = c.guardian_id;
$$;

-- 보호자: 내가 동의해 가입한 자녀 계정
create or replace function public.my_children()
returns table (child_id uuid, nickname text, consented_at timestamptz, joined_at timestamptz, email_confirmed boolean)
language sql stable security definer set search_path = ''
as $$
  select c.child_id, p.nickname, c.consented_at, c.used_at, u.email_confirmed_at is not null
  from public.guardian_consents c
  join public.profiles p on p.id = c.child_id
  left join auth.users u on u.id = c.child_id
  where c.guardian_id = auth.uid()
  order by c.used_at;
$$;

-- 보호자: 아직 쓰지 않은 가입 링크
create or replace function public.my_guardian_links()
returns table (id uuid, token text, consented_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.token, c.consented_at, c.expires_at
  from public.guardian_consents c
  where c.guardian_id = auth.uid() and c.child_id is null and c.expires_at > now()
  order by c.consented_at desc;
$$;

-- 보호자: 쓰지 않은 가입 링크 취소
create or replace function public.cancel_guardian_link(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.guardian_consents c
  where c.id = p_id and c.guardian_id = auth.uid() and c.child_id is null;
  if not found then
    raise exception '이 링크를 찾을 수 없어요. 이미 쓰였거나 취소되었을 수 있어요.';
  end if;
end;
$$;

-- 아이: 나의 보호자
create or replace function public.my_guardian_info()
returns table (guardian_nickname text, consented_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.nickname, c.consented_at
  from public.guardian_consents c
  left join public.profiles p on p.id = c.guardian_id
  where c.child_id = auth.uid();
$$;

-- 보호자: 자녀 계정을 지우기 전에 자녀가 올린 사진 파일 목록
create or replace function public.child_photo_paths(p_child uuid)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'family-photos' and o.owner_id = p_child::text
    and exists (select 1 from public.guardian_consents c
                where c.child_id = p_child and c.guardian_id = auth.uid());
$$;

-- 보호자: 동의 철회 = 자녀 계정 삭제 (자녀의 글·댓글·하트·채팅·초대·멤버 기록도 함께 지워져요)
create or replace function public.delete_child_account(p_child uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not exists (select 1 from public.guardian_consents c
                 where c.child_id = p_child and c.guardian_id = auth.uid()) then
    raise exception '내가 동의해 가입한 자녀 계정만 지울 수 있어요.';
  end if;

  delete from public.family_groups g
  where exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = p_child)
    and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id <> p_child);

  delete from auth.users where id = p_child;
end;
$$;

-- 사진 창고: 보호자는 자녀가 올린 사진을 보고 지울 수 있어요 (자녀 계정 삭제 때 사진 정리용)
drop policy if exists "family_photos_select_guardian" on storage.objects;
create policy "family_photos_select_guardian" on storage.objects
  for select to authenticated
  using (bucket_id = 'family-photos' and public.is_guardian_of(owner_id));
drop policy if exists "family_photos_delete_guardian" on storage.objects;
create policy "family_photos_delete_guardian" on storage.objects
  for delete to authenticated
  using (bucket_id = 'family-photos' and public.is_guardian_of(owner_id));

revoke execute on function
  public.is_child_account(uuid),
  public.is_guardian_of(text),
  public.recently_signed_in_with_password(),
  public.create_guardian_link(text),
  public.guardian_link_info(text),
  public.my_children(),
  public.my_guardian_links(),
  public.cancel_guardian_link(uuid),
  public.my_guardian_info(),
  public.child_photo_paths(uuid),
  public.delete_child_account(uuid)
  from public, anon, authenticated;
grant execute on function public.guardian_link_info(text) to anon, authenticated;
grant execute on function
  public.is_guardian_of(text),
  public.create_guardian_link(text),
  public.my_children(),
  public.my_guardian_links(),
  public.cancel_guardian_link(uuid),
  public.my_guardian_info(),
  public.child_photo_paths(uuid),
  public.delete_child_account(uuid)
  to authenticated;


-- 끝! 아래 "Success. No rows returned" 가 보이면 성공입니다.
-- (마지막 줄: 앱이 새 기능(함수)을 바로 찾을 수 있도록 서버의 목록을 새로고침)
notify pgrst, 'reload schema';
