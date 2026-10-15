-- =====================================================================
--  도란톡 업데이트: 버전 5 → 버전 6 (휴대폰 알림)
-- ---------------------------------------------------------------------
--  8단계까지 실행해 둔 DB에, 바뀐 부분만 더합니다. (처음 설치라면 schema.sql 전체를 실행)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 6" 이 보이면 성공.
-- =====================================================================

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

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 6 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 6" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
