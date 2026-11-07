-- =====================================================================
--  도란톡 업데이트: 버전 14 → 버전 15 (정식 보안 시험 뒤 보안 보강)
-- ---------------------------------------------------------------------
--  - 사진 창고 하루 한도 (한 사람): 사진 300장 · 동영상 10개 · 프로필 사진 20장 · 모두 합쳐 500MB
--    프로필 사진 칸에는 사진만, 사진 칸에는 사진 · 동영상만, 정해진 폴더에만
--  - 가족 달력: 그룹마다 일정 300개 · 한 사람이 하루 30개 · 달력 알림은 그룹마다 하루 20번
--  - 운영자 기능 · 운영자 이름은 이메일 인증을 마친 운영자 계정만
--  - 남의 기기 알림 주소 가로채기 방지 + (선택) 알림 서버 전용 열쇠
--  - 초대 메일의 그룹 이름 속 인터넷 주소가 링크처럼 보이지 않게
--  ※ 앱 화면 기능은 그대로예요. 알림 서버(Edge Function "push")는 19단계처럼 새 코드로 다시 배포해 주세요.
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 15" 가 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 10. 알림: 알림 서버 전용 열쇠(선택) · 기기 주소 가로채기 방지 · 달력 알림 하루 20번
-- ---------------------------------------------------------------------
-- (버전 15) 알림 서버가 부른 것인지 확인 (선택 설정)
--   Vault 에 'push_db_key' 가 있으면, 같은 열쇠를 x-push-key 머리말로 보낸 알림 서버만 통과해요.
--   (앱에서 직접 불러 가족 기기 알림 주소를 받아 가지 못하게) 열쇠를 아직 안 넣었으면 예전처럼 통과해요.
create or replace function public.push_caller_ok()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  expected text;
  given text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return true;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into expected using 'push_db_key';
  if coalesce(expected, '') = '' then
    return true;
  end if;
  given := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-push-key', '');
  return given = expected;
exception when others then
  return false;
end;
$$;

-- 이 기기를 내 알림 주소로 등록 (같은 기기를 다른 계정이 쓰던 기록이 있으면 내 것으로 바꿈)
-- (버전 15) 다른 사람의 기기 주소는 "같은 암호 열쇠"를 가진 그 기기에서만 넘겨받을 수 있어요 (주소만 알아낸 사람이 가로채지 못하게)
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
        device = excluded.device, created_at = now()
    where public.push_subscriptions.user_id = excluded.user_id
       or (public.push_subscriptions.p256dh = excluded.p256dh and public.push_subscriptions.auth = excluded.auth);
end;
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
    and public.push_caller_ok()   -- (버전 15) 알림 서버 전용 열쇠를 설정했다면 알림 서버만
    and (s.user_id = auth.uid() or exists (
      select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
      where a.user_id = auth.uid() and b.user_id = s.user_id));
$$;

revoke execute on function
  public.push_caller_ok(),
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
-- 12. 메일: 그룹 이름 속 인터넷 주소를 링크처럼 보이지 않게
-- ---------------------------------------------------------------------
-- (버전 15) 메일에 넣는 그룹 이름 속 인터넷 주소 글자(. : / @ 등)를 띄어 써서,
-- 메일 프로그램이 "evil.com" 같은 글자를 링크로 바꾸지 못하게 (가짜 로그인 사이트로 꾀어내기 방지)
create or replace function public.mail_plain(t text)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(coalesce(t, ''), '[.:/\\@。．｡＠：／]', ' ', 'g');
$$;
revoke execute on function public.mail_plain(text) from public, anon, authenticated;

-- 초대하면 초대받은 사람 이메일로 알려 주기 (같은 사람에게는 10분에 1통, 하루 5통까지)
create or replace function public.mail_on_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  to_email text;
  inviter_nick text;
  inviter_handle text;
  gname text;
begin
  if exists (select 1 from public.mail_log l
             where l.to_user = new.invitee_id and l.kind = 'invite' and l.sent_at > now() - interval '10 minutes')
     or (select count(*) from public.mail_log l
         where l.to_user = new.invitee_id and l.kind = 'invite' and l.sent_at > now() - interval '1 day') >= 5 then
    return null;
  end if;
  select u.email into to_email from auth.users u
  where u.id = new.invitee_id and u.email_confirmed_at is not null;
  select p.nickname, p.handle into inviter_nick, inviter_handle from public.profiles p where p.id = new.inviter_id;
  select g.name into gname from public.family_groups g where g.id = new.group_id;

  if public.send_mail(
       to_email,
       '[도란톡] ' || coalesce(inviter_nick, '누군가') || '님이 "' || public.mail_plain(gname) || '" 그룹에 초대했어요',
       public.mail_layout(
         '그룹 초대가 왔어요',
         '<p style="margin:0 0 8px"><strong>' || public.html_escape(inviter_nick) || '</strong> (아이디 '
           || public.html_escape(inviter_handle) || ')님이 <strong>“' || public.html_escape(public.mail_plain(gname))
           || '”</strong> 그룹에 초대했어요.</p>'
           || '<p style="margin:0;color:#6b5b4f">도란톡에 로그인하면 홈 화면의 <strong>받은 초대</strong>에서 수락하거나 거절할 수 있어요. '
           || '모르는 사람이 보낸 초대라면 거절해 주세요.</p>',
         '도란톡에서 초대 확인하기',
         'https://dorantalk.com/#/home')) then
    insert into public.mail_log (kind, to_user, ref_id) values ('invite', new.invitee_id, new.id);
  end if;
  return null;
end;
$$;

-- 아이가 요청하면 보호자 이메일로 알려 주기
create or replace function public.mail_on_group_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  to_email text;
  guardian uuid;
  child_nick text;
  child_handle text;
begin
  select c.guardian_id into guardian from public.guardian_consents c where c.child_id = new.child_id;
  select u.email into to_email from auth.users u where u.id = guardian and u.email_confirmed_at is not null;
  select p.nickname, p.handle into child_nick, child_handle from public.profiles p where p.id = new.child_id;
  if public.send_mail(
       to_email,
       '[도란톡] ' || coalesce(child_nick, '자녀') || '님이 그룹을 만들고 싶어해요',
       public.mail_layout(
         '자녀의 그룹 만들기 승인 요청',
         '<p style="margin:0 0 8px"><strong>' || public.html_escape(child_nick) || '</strong> (아이디 '
           || public.html_escape(child_handle) || ')님이 <strong>“' || public.html_escape(public.mail_plain(new.name))
           || '”</strong> 그룹을 만들고 싶어해요.</p>'
           || '<p style="margin:0;color:#6b5b4f">승인하면 그룹이 만들어지고 보호자님도 그 그룹의 멤버가 돼요. '
           || '도란톡 → <strong>내 정보 → 자녀 계정</strong>에서 승인하거나 거절할 수 있어요.</p>',
         '승인하러 가기',
         'https://dorantalk.com/#/me/children')) then
    insert into public.mail_log (kind, to_user, ref_id) values ('group_request', guardian, new.id);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 13 · 15. 운영자 이름 · 운영자 기능은 이메일 인증을 마친 운영자 계정만
-- ---------------------------------------------------------------------
create or replace function public.guard_reserved_names()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT'
      or new.nickname is distinct from old.nickname
      or new.handle is distinct from old.handle)
     and (public.is_reserved_name(new.nickname) or public.is_reserved_name(new.handle))
     and not exists (select 1 from auth.users u
                     where u.id = new.id and lower(u.email) = 'admin@dorantalk.com'
                       and u.email_confirmed_at is not null) then  -- (버전 15) 이메일 인증을 마친 운영자만
    raise exception '"도란톡" · "관리자" 같은 이름은 운영자만 쓸 수 있어요. 다른 이름을 골라 주세요.';
  end if;
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = 'admin@dorantalk.com'
      and u.email_confirmed_at is not null  -- (버전 15) 이메일 인증을 마친 운영자 계정만
  );
$$;

-- ---------------------------------------------------------------------
-- 18. (버전 15) 정식 보안 시험 뒤 보강
--   1) 사진 창고 하루 한도 (한 사람): 사진 300장 · 동영상 10개 · 프로필 사진 20장 · 모두 합쳐 500MB
--      - 프로필 사진 칸에는 사진(jpg · png · webp)만, 사진 칸에는 사진 · 동영상만, 정해진 폴더에만
--      - 누군가 가입만 하고 큰 파일을 잔뜩 올려 무료 저장 공간(1GB)을 바닥내는 일을 어렵게 해요
--   2) 가족 달력: 그룹마다 일정 300개, 한 사람이 하루 30개까지 (달력 알림은 그룹마다 하루 20번 — 10번 절)
--   3) 그 밖에 (각 절에서 고침): 운영자는 이메일 인증을 마친 계정만(13 · 15번), 남의 기기 알림 주소 가로채기 방지와
--      알림 서버 전용 열쇠(10번), 메일 속 그룹 이름의 인터넷 주소 막기(12번)
-- ---------------------------------------------------------------------

-- 계산용 함수는 로그인한 사람만 (사진 창고 보안 규칙에서 is_video_path 를 써요)
revoke execute on function public.is_video_path(text), public.media_summary(text[], text) from public, anon, authenticated;
grant execute on function public.is_video_path(text) to authenticated;

-- (1) 이 파일을 올려도 되는지: 오늘(24시간) 내가 올린 개수 · 크기로 확인
create or replace function public.can_upload_file(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select o.name,
           case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint else 0 end as size
    from storage.objects o
    where o.bucket_id = 'family-photos' and o.owner_id = auth.uid()::text
      and o.created_at > now() - interval '1 day'
  ), s as (
    select count(*) filter (where name like 'avatars/%') as avatars,
           count(*) filter (where name not like 'avatars/%' and public.is_video_path(name)) as videos,
           count(*) filter (where name not like 'avatars/%' and not public.is_video_path(name)) as photos,
           coalesce(sum(size), 0) as bytes
    from mine
  )
  select auth.uid() is not null
     and s.bytes < 524288000
     and case
           when p_name like 'avatars/%' then s.avatars < 20 and p_name ~* '\.(jpe?g|png|webp)$'
           when public.is_video_path(p_name) then s.videos < 10
           else s.photos < 300 and p_name ~* '\.(jpe?g|png|webp|gif)$'
         end
  from s;
$$;
revoke execute on function public.can_upload_file(text) from public, anon, authenticated;
grant execute on function public.can_upload_file(text) to authenticated;

-- 사진 · 동영상 올리기 (8 · 17번 규칙을 바꿔요): 그룹 멤버만, {그룹}/posts|chat/{파일} 에만, 하루 한도 안에서
drop policy if exists "family_photos_insert_member" on storage.objects;
create policy "family_photos_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-photos'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] in ('posts', 'chat')
    and exists (
      select 1 from public.group_members m
      where m.group_id::text = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
    )
    and public.can_upload_file(name)
  );

-- 프로필 사진 올리기 (14번 규칙을 바꿔요): avatars/{내 id}/{파일} 에만, 사진만, 하루 20번까지
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-photos'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and public.can_upload_file(name)
  );

-- (2) 가족 달력: 그룹마다 300개, 한 사람이 하루 30개까지
create or replace function public.can_add_event(p_group uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_group_member(p_group)
     and (select count(*) from public.family_events e where e.group_id = p_group) < 300
     and (select count(*) from public.family_events e
          where e.created_by = auth.uid() and e.created_at > now() - interval '1 day') < 30;
$$;
revoke execute on function public.can_add_event(uuid) from public, anon, authenticated;
grant execute on function public.can_add_event(uuid) to authenticated;

drop policy if exists "events_insert_member" on public.family_events;
create policy "events_insert_member" on public.family_events
  for insert to authenticated
  with check (created_by = (select auth.uid()) and public.can_add_event(group_id));


-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 15 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 15" 가 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
