-- =====================================================================
--  도란톡 업데이트: 버전 9 → 버전 10 (운영자 이름 보호)
-- ---------------------------------------------------------------------
--  "도란톡" · "관리자" · "운영자" · "admin" 같은 이름은 운영자 계정(admin@dorantalk.com)만 쓸 수 있어요.
--  (이미 그런 이름을 쓰는 다른 회원이 있는지는 맨 아래 결과 표에서 확인해요)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 10" 이 보이면 성공.
-- =====================================================================

create or replace function public.is_reserved_name(t text)
returns boolean
language sql immutable set search_path = ''
as $$
  select lower(coalesce(t, '')) ~ '(도란톡|dorantalk)'
      or lower(coalesce(t, '')) in ('admin', 'administrator', '관리자', '운영자', '운영진');
$$;

create or replace function public.is_handle_available(p_handle text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select btrim(coalesce(p_handle, '')) ~ '^[가-힣a-zA-Z0-9_]{2,20}$'
     and not public.is_reserved_name(btrim(p_handle))   -- (버전 10) 운영자 이름은 쓸 수 없어요
     and not exists (
       select 1 from public.profiles p
       where lower(p.handle) = lower(btrim(p_handle))
     );
$$;

-- ---------------------------------------------------------------------
-- 13. (버전 10) 운영자 이름 보호
--   "도란톡" · "dorantalk" 이 들어간 이름, "관리자" · "운영자" · "admin" 같은 이름은
--   운영자 계정(admin@dorantalk.com)만 아이디 · 닉네임으로 쓸 수 있어요. (운영자인 척 초대하는 것 방지)
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
                     where u.id = new.id and lower(u.email) = 'admin@dorantalk.com') then
    raise exception '"도란톡" · "관리자" 같은 이름은 운영자만 쓸 수 있어요. 다른 이름을 골라 주세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_reserved_names on public.profiles;
create trigger guard_reserved_names
  before insert or update of nickname, handle on public.profiles
  for each row execute function public.guard_reserved_names();

revoke execute on function public.is_reserved_name(text), public.guard_reserved_names()
  from public, anon, authenticated;

-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 10 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 결과 1: 운영자가 아닌데 운영자 이름을 쓰고 있는 회원 (없으면 "0 rows" — 정상)
select p.handle as 아이디, p.nickname as 닉네임, u.email as 이메일
from public.profiles p join auth.users u on u.id = p.id
where (public.is_reserved_name(p.handle) or public.is_reserved_name(p.nickname))
  and lower(u.email) <> 'admin@dorantalk.com';

-- 결과 2: 아래 표에 "업데이트 완료! 버전 10" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
