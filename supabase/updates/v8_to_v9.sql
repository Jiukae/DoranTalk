-- =====================================================================
--  도란톡 업데이트: 버전 8 → 버전 9 (아이디 · 초대 메일 · 자녀 그룹 승인)
-- ---------------------------------------------------------------------
--  - 아이디: 전체에서 하나뿐인 이름(한글 가능). 지금 닉네임이 그대로 첫 아이디가 돼요. 닉네임은 이제 겹쳐도 돼요.
--  - 초대는 아이디로 하고, 초대받은 사람 이메일로도 알려 줘요. (메일은 pg_net + Vault 설정 후)
--  - 만 14세 미만도 보호자 승인을 받아 그룹을 만들 수 있어요. (보호자도 그 그룹 멤버가 돼요)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 9" 이 보이면 성공.
-- =====================================================================

-- (버전 9) 아이디(handle): 전체에서 하나뿐인 이름 (한글 가능, 대소문자 구분 없이 하나만)
--   초대는 아이디로 해요. 닉네임은 화면에 보이는 이름이라 이제 겹쳐도 돼요.
--   예전 회원은 지금 닉네임이 그대로 첫 아이디가 돼요. (닉네임은 그동안 겹칠 수 없었으니 안전)
alter table public.profiles add column if not exists handle text;
update public.profiles set handle = nickname where handle is null;
alter table public.profiles alter column handle set not null;
alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format
  check (handle ~ '^[가-힣a-zA-Z0-9_]{2,20}$');
create unique index if not exists profiles_handle_unique on public.profiles (lower(handle));
drop index if exists public.profiles_nickname_unique;

-- ---------------------------------------------------------------------
-- 바뀐 함수
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tok text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'guardian_token', '')), '');
  nick text := btrim(new.raw_user_meta_data ->> 'nickname');
  h text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')), '');
begin
  -- (버전 9) 아이디: 가입 화면에서 정한 것. 예전 앱처럼 아이디 없이 가입하면 닉네임(겹치면 뒤에 숫자)으로 정해요
  if h is null then
    h := nick;
    while h is null or h !~ '^[가-힣a-zA-Z0-9_]{2,20}$'
          or exists (select 1 from public.profiles p where lower(p.handle) = lower(h)) loop
      h := left(coalesce(nick, 'user'), 12) || '_' || (1000 + floor(random() * 9000))::int;
    end loop;
  elsif h !~ '^[가-힣a-zA-Z0-9_]{2,20}$' then
    raise exception '아이디는 2~20자, 한글·영어·숫자·밑줄(_)로 지어 주세요.';
  end if;

  insert into public.profiles (id, nickname, handle)
  values (new.id, nick, h);

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

create or replace function public.is_nickname_available(nick text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select btrim(coalesce(nick, '')) ~ '^[가-힣a-zA-Z0-9_]{2,12}$';
$$;

create or replace function public.is_handle_available(p_handle text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select btrim(coalesce(p_handle, '')) ~ '^[가-힣a-zA-Z0-9_]{2,20}$'
     and not exists (
       select 1 from public.profiles p
       where lower(p.handle) = lower(btrim(p_handle))
     );
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
  -- (버전 8 · 9) 만 14세 미만은 보호자 승인을 받아 그룹을 만들어요 (request_group → 보호자가 승인)
  if public.is_child_account(uid) then
    raise exception '만 14세 미만은 보호자 승인을 받아 그룹을 만들어요. "보호자에게 승인 요청"을 눌러 주세요.';
  end if;
  -- (버전 7) 함부로 많이 만들지 못하게: 하루 5개, 한 사람이 들어가 있는 그룹은 20개까지
  if (select count(*) from public.family_groups g
      where g.created_by = uid and g.created_at > now() - interval '1 day') >= 5 then
    raise exception '그룹은 하루에 5개까지 만들 수 있어요. 내일 다시 해 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.user_id = uid) >= 20 then
    raise exception '그룹은 20개까지 들어갈 수 있어요.';
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

create or replace function public.invite_by_handle(gid uuid, p_handle text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  nick text := btrim(coalesce(p_handle, ''));
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.is_group_member(gid) then
    raise exception '이 그룹의 멤버만 초대할 수 있어요.';
  end if;

  select p.id into target
  from public.profiles p
  where lower(p.handle) = lower(nick);

  -- (버전 8) 만 14세 미만 계정은 보호자가 들어 있는 그룹에서만 찾을 수 있어요
  --          (모르는 사람이 아이 계정인지 알 수 없도록 "찾을 수 없어요"와 같은 안내를 보여 줘요)
  if target is null or (public.is_child_account(target) and not exists (
       select 1 from public.guardian_consents c
       join public.group_members m on m.user_id = c.guardian_id and m.group_id = gid
       where c.child_id = target)) then
    raise exception '"%" 아이디를 가진 사람을 찾을 수 없어요. (만 14세 미만은 보호자가 이 그룹에 있어야 초대할 수 있어요)', nick;
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
    raise exception '수락을 기다리는 초대가 너무 많아요. 멤버 탭에서 대기 중인 초대를 먼저 정리해 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.group_id = gid)
     + (select count(*) from public.group_invitations i where i.group_id = gid and i.status = 'pending') >= 50 then
    raise exception '한 그룹에는 50명까지 들어올 수 있어요.';
  end if;

  insert into public.group_invitations (group_id, inviter_id, invitee_id)
  values (gid, uid, target);
end;
$$;

create or replace function public.invite_by_nickname(gid uuid, nick text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.invite_by_handle(gid, nick);
end;
$$;

drop function if exists public.get_my_invitations();
create or replace function public.get_my_invitations()
returns table (
  id uuid,
  group_id uuid,
  group_name text,
  inviter_nickname text,
  created_at timestamptz,
  inviter_handle text
)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.group_id, g.name, p.nickname, i.created_at, p.handle
  from public.group_invitations i
  join public.family_groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.inviter_id
  where i.invitee_id = auth.uid() and i.status = 'pending'
  order by i.created_at desc;
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
    raise exception '이 그룹은 멤버가 꽉 찼어요. (50명)';
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

drop function if exists public.guardian_link_info(text);
create or replace function public.guardian_link_info(p_token text)
returns table (status text, guardian_nickname text, guardian_handle text)
language sql stable security definer set search_path = ''
as $$
  select case
           when c.id is null then 'not_found'
           when c.child_id is not null then 'used'
           when c.guardian_id is null or c.expires_at <= now() then 'expired'
           else 'ok'
         end,
         case when c.child_id is null and c.expires_at > now() then p.nickname end,
         case when c.child_id is null and c.expires_at > now() then p.handle end
  from (select 1) one
  left join public.guardian_consents c on c.token = btrim(coalesce(p_token, ''))
  left join public.profiles p on p.id = c.guardian_id;
$$;

drop function if exists public.my_children();
create or replace function public.my_children()
returns table (child_id uuid, nickname text, consented_at timestamptz, joined_at timestamptz, email_confirmed boolean, handle text)
language sql stable security definer set search_path = ''
as $$
  select c.child_id, p.nickname, c.consented_at, c.used_at, u.email_confirmed_at is not null, p.handle
  from public.guardian_consents c
  join public.profiles p on p.id = c.child_id
  left join auth.users u on u.id = c.child_id
  where c.guardian_id = auth.uid()
  order by c.used_at;
$$;

-- 권한 (새로 만든 · 다시 만든 함수)
revoke execute on function
  public.is_handle_available(text),
  public.invite_by_handle(uuid, text),
  public.get_my_invitations(),
  public.guardian_link_info(text),
  public.my_children()
  from public, anon, authenticated;
grant execute on function public.is_handle_available(text), public.guardian_link_info(text) to anon, authenticated;
grant execute on function public.invite_by_handle(uuid, text), public.get_my_invitations(), public.my_children() to authenticated;
grant update (nickname, handle) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 12. (버전 9) 메일 보내기 · 자녀의 그룹 만들기 승인
--   - 초대하면 초대받은 사람의 이메일로도 알려 줘요. (앱 안에서 수락하는 것도 그대로)
--   - 만 14세 미만이 그룹을 만들고 싶으면 보호자에게 요청 → 보호자가 승인하면 그룹이 생기고 보호자도 멤버가 돼요.
--   메일은 데이터베이스가 직접 Resend로 보내요(pg_net). 받는 사람 이메일은 앱(초대한 사람)에게 절대 보이지 않아요.
--   켜는 방법: Supabase → Database → Extensions 에서 pg_net 켜기 + Vault 에 'resend_api_key' 이름으로 Resend 열쇠 저장
--   (둘 중 하나라도 없으면 메일만 안 가고, 나머지 기능은 그대로 잘 돼요)
-- ---------------------------------------------------------------------

-- 메일에 넣는 사용자 글자(그룹 이름, 닉네임)를 안전하게 (HTML 태그 · 링크 끼워 넣기 방지)
create or replace function public.html_escape(t text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- 메일 모양 (도란톡 공통)
create or replace function public.mail_layout(p_title text, p_body_html text, p_button text, p_url text)
returns text
language sql immutable set search_path = ''
as $$
  select '<div style="font-family:-apple-system,BlinkMacSystemFont,''Apple SD Gothic Neo'',''Malgun Gothic'',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#2a1f17;line-height:1.6">'
      || '<p style="margin:0 0 16px;font-size:20px;font-weight:800;color:#c9581f">도란톡</p>'
      || '<h2 style="margin:0 0 12px;font-size:20px">' || p_title || '</h2>'
      || p_body_html
      || '<p style="margin:24px 0"><a href="' || p_url || '" style="display:inline-block;padding:14px 24px;background:#c9581f;color:#ffffff;border-radius:12px;text-decoration:none;font-weight:bold;font-size:18px">' || p_button || '</a></p>'
      || '<p style="margin:24px 0 0;color:#8a7a6d;font-size:12px">이 메일은 도란톡(dorantalk.com)에서 자동으로 보냈어요. 문의: admin@dorantalk.com</p>'
      || '</div>';
$$;

-- 보낸 메일 기록 (같은 사람에게 너무 자주 보내지 않으려고)
create table if not exists public.mail_log (
  id       bigserial primary key,
  kind     text not null,
  to_user  uuid references public.profiles (id) on delete cascade,
  ref_id   uuid,
  sent_at  timestamptz not null default now()
);
create index if not exists mail_log_to_user_idx on public.mail_log (to_user, kind, sent_at desc);
alter table public.mail_log enable row level security;
revoke all on public.mail_log from anon, authenticated;

-- 메일 보내기 (Resend). 설정이 없거나 실패해도 오류를 내지 않아요 (메일은 덤이니까)
create or replace function public.send_mail(p_to text, p_subject text, p_html text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  api_key text;
begin
  if p_to is null or p_to = '' then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into api_key using 'resend_api_key';
  if coalesce(api_key, '') = '' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using 'https://api.resend.com/emails',
          jsonb_build_object('from', '도란톡 <admin@dorantalk.com>', 'to', jsonb_build_array(p_to),
                             'subject', p_subject, 'html', p_html),
          jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json');
  return true;
exception when others then
  raise warning 'send_mail failed: %', sqlerrm;
  return false;
end;
$$;

-- 연결 점검 화면용: 메일 보낼 준비가 됐는지 (열쇠 내용은 알려 주지 않아요)
create or replace function public.mail_ready()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  ok boolean;
begin
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return false;
  end if;
  execute 'select exists (select 1 from vault.decrypted_secrets where name = $1 and coalesce(decrypted_secret, '''') <> '''')'
    into ok using 'resend_api_key';
  return ok;
exception when others then
  return false;
end;
$$;

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
       '[도란톡] ' || coalesce(inviter_nick, '누군가') || '님이 "' || coalesce(gname, '') || '" 그룹에 초대했어요',
       public.mail_layout(
         '그룹 초대가 왔어요',
         '<p style="margin:0 0 8px"><strong>' || public.html_escape(inviter_nick) || '</strong> (아이디 '
           || public.html_escape(inviter_handle) || ')님이 <strong>“' || public.html_escape(gname)
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

drop trigger if exists on_invitation_mail on public.group_invitations;
create trigger on_invitation_mail
  after insert on public.group_invitations
  for each row execute function public.mail_on_invitation();

-- 자녀의 그룹 만들기 요청 (보호자가 승인하면 그룹이 생겨요)
create table if not exists public.group_requests (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'declined', 'canceled')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles (id) on delete set null,
  group_id    uuid references public.family_groups (id) on delete set null
);
create index if not exists group_requests_child_idx on public.group_requests (child_id, created_at desc);
alter table public.group_requests enable row level security;
revoke all on public.group_requests from anon, authenticated;

-- 아이: 보호자에게 그룹 만들기 승인 요청
create or replace function public.request_group(p_name text)
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
  if not public.is_child_account(uid) then
    raise exception '보호자 승인 요청은 만 14세 미만 계정만 해요. 바로 그룹을 만들 수 있어요.';
  end if;
  if not exists (select 1 from public.guardian_consents c where c.child_id = uid and c.guardian_id is not null) then
    raise exception '보호자 계정이 없어서 요청할 수 없어요. 문의: admin@dorantalk.com';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 30 then
    raise exception '그룹 이름은 1~30자로 정해 주세요.';
  end if;
  if (select count(*) from public.group_requests r where r.child_id = uid and r.status = 'pending') >= 3 then
    raise exception '승인을 기다리는 요청이 3개 있어요. 보호자가 확인할 때까지 기다려 주세요.';
  end if;
  if (select count(*) from public.group_requests r
      where r.child_id = uid and r.created_at > now() - interval '1 day') >= 5 then
    raise exception '그룹 만들기 요청은 하루에 5번까지 할 수 있어요. 내일 다시 해 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.user_id = uid) >= 20 then
    raise exception '그룹은 20개까지 들어갈 수 있어요.';
  end if;

  insert into public.group_requests (child_id, name) values (uid, btrim(p_name))
  returning id into new_id;
  return new_id;
end;
$$;

-- 아이: 내 요청 (기다리는 것 + 최근 7일 안에 결정된 것)
create or replace function public.my_group_requests()
returns table (id uuid, name text, status text, created_at timestamptz, decided_at timestamptz, group_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.name, r.status, r.created_at, r.decided_at, r.group_id
  from public.group_requests r
  where r.child_id = auth.uid()
    and (r.status = 'pending' or r.decided_at > now() - interval '7 days')
  order by r.created_at desc;
$$;

-- 아이: 기다리는 요청 취소
create or replace function public.cancel_group_request(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.group_requests r
  set status = 'canceled', decided_at = now()
  where r.id = p_id and r.child_id = auth.uid() and r.status = 'pending';
  if not found then
    raise exception '이 요청을 찾을 수 없어요. 이미 처리되었을 수 있어요.';
  end if;
end;
$$;

-- 보호자: 내 자녀들이 보낸, 기다리는 요청
create or replace function public.children_group_requests()
returns table (id uuid, child_nickname text, child_handle text, name text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, p.nickname, p.handle, r.name, r.created_at
  from public.group_requests r
  join public.guardian_consents c on c.child_id = r.child_id
  join public.profiles p on p.id = r.child_id
  where c.guardian_id = auth.uid() and r.status = 'pending'
  order by r.created_at;
$$;

-- 보호자: 승인(그룹 만들기 — 아이가 방장, 보호자도 멤버) 또는 거절
create or replace function public.decide_group_request(p_id uuid, p_approve boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  req public.group_requests%rowtype;
  new_id uuid;
begin
  if uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  select r.* into req from public.group_requests r
  join public.guardian_consents c on c.child_id = r.child_id and c.guardian_id = uid
  where r.id = p_id and r.status = 'pending'
  for update of r;
  if not found then
    raise exception '이 요청을 찾을 수 없어요. 이미 처리되었거나 내 자녀의 요청이 아니에요.';
  end if;

  if not coalesce(p_approve, false) then
    update public.group_requests set status = 'declined', decided_at = now(), decided_by = uid where id = p_id;
    return null;
  end if;

  if (select count(*) from public.group_members m where m.user_id = req.child_id) >= 20 then
    raise exception '자녀가 이미 그룹 20개에 들어가 있어요.';
  end if;
  if (select count(*) from public.group_members m where m.user_id = uid) >= 20 then
    raise exception '보호자가 이미 그룹 20개에 들어가 있어서, 이 그룹에 함께 들어갈 수 없어요.';
  end if;

  insert into public.family_groups (name, created_by) values (req.name, req.child_id)
  returning id into new_id;
  insert into public.group_members (group_id, user_id, role) values (new_id, req.child_id, 'owner');
  insert into public.group_members (group_id, user_id, role) values (new_id, uid, 'member');
  insert into public.chat_reads (group_id, user_id) values (new_id, req.child_id), (new_id, uid);

  update public.group_requests
  set status = 'approved', decided_at = now(), decided_by = uid, group_id = new_id
  where id = p_id;
  return new_id;
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
           || public.html_escape(child_handle) || ')님이 <strong>“' || public.html_escape(new.name)
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

drop trigger if exists on_group_request_mail on public.group_requests;
create trigger on_group_request_mail
  after insert on public.group_requests
  for each row execute function public.mail_on_group_request();

revoke execute on function
  public.html_escape(text),
  public.mail_layout(text, text, text, text),
  public.send_mail(text, text, text),
  public.mail_ready(),
  public.mail_on_invitation(),
  public.request_group(text),
  public.my_group_requests(),
  public.cancel_group_request(uuid),
  public.children_group_requests(),
  public.decide_group_request(uuid, boolean),
  public.mail_on_group_request()
  from public, anon, authenticated;
grant execute on function public.mail_ready() to anon, authenticated;
grant execute on function
  public.request_group(text),
  public.my_group_requests(),
  public.cancel_group_request(uuid),
  public.children_group_requests(),
  public.decide_group_request(uuid, boolean)
  to authenticated;

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 9 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

-- 앱이 바뀐 기능을 바로 알아차리도록 새로고침
notify pgrst, 'reload schema';

-- 결과 확인: 아래 표에 "업데이트 완료! 버전 9" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
