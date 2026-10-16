-- =====================================================================
--  도란톡 업데이트: 버전 7 → 버전 8 (만 14세 미만: 보호자 동의로 가입)
-- ---------------------------------------------------------------------
--  - 보호자(부모 등)가 먼저 동의하고 "자녀 가입 링크"를 만들면, 아이가 그 링크로 가입해요.
--    이미 가입한 아이는 그 링크로 자기 계정에 보호자 동의를 연결할 수 있어요.
--  - 아이 계정은 보호자가 있는 그룹에만 초대받을 수 있고, 그룹을 직접 만들 수 없어요.
--  - 보호자는 언제든 동의를 철회하고 아이 계정을 지울 수 있어요.
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 8" 이 보이면 성공.
-- =====================================================================
-- ---------------------------------------------------------------------
-- 11. (버전 8) 만 14세 미만 가입: 보호자(법정대리인) 동의
--   1) 보호자가 로그인 → 비밀번호를 다시 확인 → 동의 내용을 읽고 체크 → "자녀 가입 링크"를 받아요.
--      (보호자 동의를 먼저 받은 뒤에 아이의 정보를 받아요)
--   2) 아이는 그 링크로 가입해요. 링크는 7일 안에 한 번만 쓸 수 있어요.
--      이미 가입한 아이라면, 자기 계정으로 로그인한 채 링크를 열어 "이 계정에 연결"할 수 있어요.
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

-- 이미 가입한 계정에 보호자 동의 연결 (만 14세 미만인데 예전에 가입한 경우)
-- 자녀가 자기 계정으로 로그인한 채 보호자가 보낸 링크를 열고 "연결하기"를 눌러요.
create or replace function public.attach_guardian_consent(p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.guardian_consents%rowtype;
  gnick text;
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if public.is_child_account(uid) then
    raise exception '이미 보호자 동의가 연결된 계정이에요.';
  end if;
  select * into c from public.guardian_consents g
  where g.token = btrim(coalesce(p_token, '')) and g.child_id is null
    and g.guardian_id is not null and g.expires_at > now()
  for update;
  if not found then
    raise exception '보호자 동의 링크가 만료되었거나 이미 사용되었어요. 보호자께 새 링크를 부탁해 주세요.';
  end if;
  if c.guardian_id = uid then
    raise exception '보호자 본인 계정에는 연결할 수 없어요. 자녀의 휴대폰(자녀 계정)에서 링크를 열어 주세요.';
  end if;
  if exists (select 1 from public.guardian_consents g where g.guardian_id = uid and g.child_id is not null) then
    raise exception '자녀가 있는 보호자 계정에는 연결할 수 없어요.';
  end if;

  update public.guardian_consents g set child_id = uid, used_at = now() where g.id = c.id;
  -- 이제 자녀 계정이라 보호자가 될 수 없으니, 예전에 만들어 둔 안 쓴 링크는 지워요
  delete from public.guardian_consents g where g.guardian_id = uid and g.child_id is null;

  select p.nickname into gnick from public.profiles p where p.id = c.guardian_id;
  return gnick;
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
  public.attach_guardian_consent(text),
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
  public.attach_guardian_consent(text),
  public.my_children(),
  public.my_guardian_links(),
  public.cancel_guardian_link(uuid),
  public.my_guardian_info(),
  public.child_photo_paths(uuid),
  public.delete_child_account(uuid)
  to authenticated;
-- ---------------------------------------------------------------------
-- 바뀐 함수: 가입(링크 확인), 그룹 만들기 · 초대 · 수락(아이 보호), 회원 탈퇴(안 쓴 링크 정리)
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

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 8 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 8" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
