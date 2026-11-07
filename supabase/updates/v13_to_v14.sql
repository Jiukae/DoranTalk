-- =====================================================================
--  도란톡 업데이트: 버전 13 → 버전 14 (안부 인사 · 동영상 · 가족 달력)
-- ---------------------------------------------------------------------
--  - 안부 인사 10가지 (채팅으로 보내요)
--  - 동영상 올리기 (누구나, 한 개 50MB · 하루 10개까지)
--  - 가족 달력 + 생신 알림 (음력 지원, 하루 전 · 당일 알림)
--  ※ 알림 서버(Edge Function "push")도 새 코드로 한 번 다시 배포해야 달력 알림이 가요. (19단계 안내서)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 14" 가 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 17. (버전 14) 안부 인사 · 동영상 · 가족 달력
-- ---------------------------------------------------------------------
-- (1) 안부 인사: 채팅 메시지에 "몇 번째 안부 인사인지"(1~20) 표시. 글자는 그대로 content 에 들어가요.
alter table public.messages add column if not exists greeting smallint;
do $$ begin
  alter table public.messages add constraint messages_greeting_range check (greeting between 1 and 20);
exception when duplicate_object then null; end $$;
grant insert (group_id, content, image_path, greeting) on public.messages to authenticated;

-- (2) 동영상: 사진 창고에 동영상도 (한 개 50MB 까지, mp4 · mov · webm), 한 사람이 하루 10개까지
--     (사진 · 동영상은 같은 칸에 들어가요: posts.image_paths · messages.image_path, 확장자로 구분)
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'family-photos';

create or replace function public.is_video_path(p text)
returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p ~* '\.(mp4|mov|webm)$', false) $$;

-- "사진 2장 · 동영상 1개 올렸어요 🎬" 같은 알림 문장
create or replace function public.media_summary(paths text[], verb text)
returns text
language sql immutable set search_path = ''
as $$
  with c as (
    select count(*) filter (where not public.is_video_path(p)) as photos,
           count(*) filter (where public.is_video_path(p)) as videos
    from unnest(coalesce(paths, '{}')) p
  )
  select case
           when photos + videos = 1 then (case when videos = 1 then '동영상을 ' else '사진을 ' end) || verb
           else concat_ws(' · ',
                  case when photos > 0 then '사진 ' || photos || '장' end,
                  case when videos > 0 then '동영상 ' || videos || '개' end) || ' ' || verb
         end || case when videos > 0 then ' 🎬' else ' 📷' end
  from c;
$$;

-- 오늘(24시간) 내가 올린 동영상 수
create or replace function public.my_video_uploads_today()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = 'family-photos' and o.owner_id = auth.uid()::text
    and public.is_video_path(o.name) and o.created_at > now() - interval '1 day';
$$;
revoke execute on function public.my_video_uploads_today() from public, anon;
grant execute on function public.my_video_uploads_today() to authenticated;

-- 올리기 규칙(8번)에 "동영상은 하루 10개까지"를 더해요
drop policy if exists "family_photos_insert_member" on storage.objects;
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
    and (not public.is_video_path(name) or public.my_video_uploads_today() < 10)
  );

-- (3) 가족 달력: 생신 · 기일 · 기념일 · 일정 (양력 / 음력, 매년 / 한 번)
--   - next_dates: 앞으로 실제(양력) 날짜들. 음력 계산은 앱이 해서 넣어요 (한국천문연구원 음력 기준).
--   - 같은 그룹 가족만 보고 · 더하고 · 고칠 수 있어요. 지우기는 만든 사람이나 방장만.
create table if not exists public.family_events (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.family_groups (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 30),
  kind        text not null default 'event' check (kind in ('birthday', 'memorial', 'anniversary', 'event')),
  calendar    text not null default 'solar' check (calendar in ('solar', 'lunar')),
  month       smallint not null check (month between 1 and 12),
  day         smallint not null check (day between 1 and 31),
  leap        boolean not null default false,
  year        smallint check (year between 1900 and 2100),   -- 한 번만 있는 일정이면 그 해, 매년이면 비워요
  next_dates  date[] not null default '{}' check (cardinality(next_dates) <= 40),
  memo        text check (memo is null or char_length(memo) <= 100),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (calendar = 'lunar' or not leap),
  check (calendar = 'solar' or day <= 30)
);
create index if not exists family_events_group_idx on public.family_events (group_id);
alter table public.family_events enable row level security;

drop policy if exists "events_select_member" on public.family_events;
create policy "events_select_member" on public.family_events
  for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "events_insert_member" on public.family_events;
create policy "events_insert_member" on public.family_events
  for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
drop policy if exists "events_update_member" on public.family_events;
create policy "events_update_member" on public.family_events
  for update to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
drop policy if exists "events_delete_owner" on public.family_events;
create policy "events_delete_owner" on public.family_events
  for delete to authenticated
  using (created_by = (select auth.uid())
         or exists (select 1 from public.family_groups g where g.id = group_id and g.created_by = (select auth.uid())));

revoke all on public.family_events from anon, authenticated;
grant select, delete on public.family_events to authenticated;
grant insert (group_id, title, kind, calendar, month, day, leap, year, next_dates, memo) on public.family_events to authenticated;
grant update (title, kind, calendar, month, day, leap, year, next_dates, memo) on public.family_events to authenticated;

-- 알림 보낸 기록 (같은 일정 · 같은 날 · 하루 전/당일 알림은 한 번만)
create table if not exists public.family_event_notices (
  event_id  uuid not null references public.family_events (id) on delete cascade,
  on_date   date not null,
  stage     text not null check (stage in ('before', 'day')),
  sent_at   timestamptz not null default now(),
  primary key (event_id, on_date, stage)
);
alter table public.family_event_notices enable row level security;
revoke all on public.family_event_notices from anon, authenticated;

-- 내 그룹 일정 중 오늘(당일) · 내일(하루 전) 알림을 아직 안 보낸 것 → 앱이 알림 서버에 부탁해요 (push_targets 'event')
create or replace function public.due_event_reminders()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with d as (select (now() at time zone 'Asia/Seoul')::date as today)
  select e.id
  from public.family_events e, d
  where public.is_group_member(e.group_id)
    and ((d.today = any(e.next_dates) and not exists (
            select 1 from public.family_event_notices n where n.event_id = e.id and n.on_date = d.today and n.stage = 'day'))
      or (d.today + 1 = any(e.next_dates) and not exists (
            select 1 from public.family_event_notices n where n.event_id = e.id and n.on_date = d.today + 1 and n.stage = 'before')));
$$;
revoke execute on function public.due_event_reminders() from public, anon;
grant execute on function public.due_event_reminders() to authenticated;


-- 알림 문장 (동영상 · 가족 달력 알림 추가)
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
  ev_title text; ev_kind text; ev_cal text; ev_month smallint; ev_day smallint; ev_dates date[];
  ev_today date; ev_on date; ev_stage text;
begin
  if uid is null then
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

  return query
    select s.endpoint, s.p256dh, s.auth, t_title, left(t_body, 140), t_url, t_tag,
           public.unread_total_for(s.user_id)
    from public.push_subscriptions s
    where s.user_id = any(coalesce(recipients, '{}'));
end;
$$;

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 14 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 14" 가 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
