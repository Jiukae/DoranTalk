-- =====================================================================
--  도란톡 업데이트: 버전 6 → 버전 7 (공개 준비: 초대 · 그룹 만들기 제한)
-- ---------------------------------------------------------------------
--  다른 가족들이 들어오기 전에, 모르는 사람이 초대를 마구 보내거나 그룹을 마구 만들지 못하게 막아요.
--   - 그룹 만들기: 하루 5개, 한 사람이 들어가 있는 그룹 20개까지
--   - 초대: 하루 30번, 거절당하면 3일 뒤에 다시, 대기 중 초대 20개, 한 그룹 50명까지
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 7" 이 보이면 성공.
-- =====================================================================

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

-- 초대 수락 / 거절
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

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 7 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 7" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
