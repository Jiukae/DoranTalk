-- =====================================================================
--  도란톡 업데이트: 버전 15 → 버전 16 (안드로이드 앱 버전 2 · Firebase 알림)
-- ---------------------------------------------------------------------
--  - 크롬 없이 도는 새 안드로이드 앱이 Firebase 알림 주소를 등록할 수 있게 (push_subscribe_fcm)
--  - 가족 기기의 Firebase 주소는 "알림 서버 전용 열쇠"(Vault 'push_db_key')를 가진 알림 서버만 받아요
--  ※ 순서: v14_to_v15.sql 을 아직 안 했다면 그것부터. 알림 서버(push)도 새 코드로 다시 배포해 주세요. (21단계 안내서)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 16" 이 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 19. Firebase 알림 주소 칸 (push_subscriptions.kind)
-- ---------------------------------------------------------------------
alter table public.push_subscriptions add column if not exists kind text not null default 'web';
alter table public.push_subscriptions drop constraint if exists push_subscriptions_kind_check;
alter table public.push_subscriptions add constraint push_subscriptions_kind_check check (kind in ('web', 'fcm'));
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_check;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check check (
  char_length(endpoint) <= 1000
  and ((kind = 'web' and endpoint ~ '^https://') or (kind = 'fcm' and endpoint ~ '^fcm:[A-Za-z0-9_:-]{20,}$')));
alter table public.push_subscriptions drop constraint if exists push_subscriptions_p256dh_check;
alter table public.push_subscriptions add constraint push_subscriptions_p256dh_check check (
  (kind = 'web' and char_length(p256dh) between 40 and 200) or (kind = 'fcm' and p256dh is null));
alter table public.push_subscriptions drop constraint if exists push_subscriptions_auth_check;
alter table public.push_subscriptions add constraint push_subscriptions_auth_check check (
  (kind = 'web' and char_length(auth) between 10 and 100) or (kind = 'fcm' and auth is null));

-- 안드로이드 앱: 이 휴대폰의 Firebase 알림 주소를 내 것으로 등록
-- (Firebase 주소는 그 휴대폰과 알림 서버만 알아요. 같은 휴대폰에서 다른 계정으로 로그인하면 그 계정이 이어받아요)
create or replace function public.push_subscribe_fcm(p_token text, p_device text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요.';
  end if;
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_:-]{20,}$' or char_length(p_token) > 900 then
    raise exception '알림 주소가 올바르지 않아요. 앱을 다시 열어 주세요.';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, kind, device)
  values ('fcm:' || p_token, auth.uid(), 'fcm', left(p_device, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, device = excluded.device, created_at = now();
end;
$$;
revoke execute on function public.push_subscribe_fcm(text, text) from public, anon, authenticated;
grant execute on function public.push_subscribe_fcm(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. 알림 보낼 곳: Firebase 주소는 알림 서버 전용 열쇠가 맞을 때만
-- ---------------------------------------------------------------------
-- (버전 16) 알림 서버 전용 열쇠가 "설정돼 있고" 맞을 때만 참 (안드로이드 앱의 Firebase 주소는 이때만 내보내요)
create or replace function public.push_caller_verified()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  expected text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into expected using 'push_db_key';
  if coalesce(expected, '') = '' then
    return false;
  end if;
  return coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-push-key', '') = expected;
exception when others then
  return false;
end;
$$;

-- 알림 보낼 곳과 내용 정하기 (알림 서버가 "보낸 사람"의 로그인 정보로 불러요)
--   p_kind: 'message'(채팅) · 'post'(새 소식) · 'comment'(댓글) · 'invite'(초대, p_id = 그룹) · 'test'(내 기기로 시험)
--   - 내가 방금(10분 안에) 보낸 것만, 한 번만 보낼 수 있어요.
--   - 받는 사람은 지금 그 그룹의 멤버만 (나 자신은 빼고)
drop function if exists public.push_targets(text, uuid);  -- (버전 16) 돌려주는 칸(kind)이 늘어서 새로 만들어요
create or replace function public.push_targets(p_kind text, p_id uuid default null)
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text, badge integer, kind text)
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
  ev_title text; ev_kind text; ev_cal text; ev_month smallint; ev_day smallint; ev_dates date[];
  ev_today date; ev_on date; ev_stage text;
begin
  -- (버전 15) 알림 서버 전용 열쇠를 설정했다면 알림 서버만 (push_caller_ok)
  if uid is null or not public.push_caller_ok() then
    return;
  end if;
  select p.nickname into me from public.profiles p where p.id = uid;

  if p_kind = 'message' then
    select m.group_id, coalesce(nullif(btrim(m.content), ''), public.media_summary(array[m.image_path], '보냈어요'))
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
           me || ': ' || coalesce(nullif(btrim(po.content), ''), public.media_summary(po.image_paths, '올렸어요'))
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

  elsif p_kind = 'event' then
    -- (버전 14) p_id = 가족 달력 일정. 오늘(당일) · 내일(하루 전)인 일정을 그룹 가족에게 한 번씩만 알려요.
    -- 가족 누구든 앱을 열면 앱이 부탁해요 (due_event_reminders). 같은 날 · 같은 알림은 한 번만.
    select e.group_id, g.name, e.title, e.kind, e.calendar, e.month, e.day, e.next_dates
      into gid, gname, ev_title, ev_kind, ev_cal, ev_month, ev_day, ev_dates
    from public.family_events e
    join public.family_groups g on g.id = e.group_id
    where e.id = p_id and public.is_group_member(e.group_id);
    if gid is null then return; end if;
    ev_today := (now() at time zone 'Asia/Seoul')::date;
    if ev_today = any(ev_dates) then ev_stage := 'day'; ev_on := ev_today;
    elsif ev_today + 1 = any(ev_dates) then ev_stage := 'before'; ev_on := ev_today + 1;
    else return;
    end if;
    -- (버전 15) 달력 알림은 그룹마다 하루 20번까지 (일정을 잔뜩 만들어 알림을 쏟아내지 못하게)
    if (select count(*) from public.family_event_notices n
        join public.family_events e2 on e2.id = n.event_id
        where e2.group_id = gid and n.sent_at > now() - interval '1 day') >= 20 then
      return;
    end if;
    insert into public.family_event_notices (event_id, on_date, stage) values (p_id, ev_on, ev_stage)
    on conflict do nothing;
    if not found then return; end if;
    ref := md5(p_id::text || ev_on::text || ev_stage)::uuid;
    t_title := gname || ' · 가족 달력';
    t_body := (case ev_stage when 'day' then '오늘 · ' else '내일 · ' end) || ev_title
      || case ev_kind when 'birthday' then ' 🎂' when 'memorial' then ' 🕯️' when 'anniversary' then ' 💐' else ' 📌' end
      || case when ev_cal = 'lunar' then ' (음력 ' || ev_month || '월 ' || ev_day || '일)' else '' end;
    t_url := '/#/group/' || gid || '/calendar';
    t_tag := 'event-' || p_id;
    select array_agg(gm.user_id) into recipients
    from public.group_members gm where gm.group_id = gid and gm.user_id <> uid;

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

  -- (버전 16) 안드로이드 앱의 Firebase 주소(kind = 'fcm')는 알림 서버 전용 열쇠가 맞을 때만 내보내요
  return query
    select s.endpoint, s.p256dh, s.auth, t_title, left(t_body, 140), t_url, t_tag,
           public.unread_total_for(s.user_id), s.kind
    from public.push_subscriptions s
    where s.user_id = any(coalesce(recipients, '{}'))
      and (s.kind = 'web' or public.push_caller_verified());
end;
$$;

revoke execute on function
  public.push_caller_ok(),
  public.push_caller_verified(),
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
as $$ select 16 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 16" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
