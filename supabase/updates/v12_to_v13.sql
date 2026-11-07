-- =====================================================================
--  도란톡 업데이트: 버전 12 → 버전 13 (가족 프리미엄 · 쿠폰)
-- ---------------------------------------------------------------------
--  가족 그룹마다 프리미엄 기간을 두고, 운영자가 만든 쿠폰으로 켤 수 있게 해요.
--  (프리미엄: 사진 원본 화질로 올리기 · 한 달 사진 한 번에 내려받기)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 13" 이 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 16. (버전 13) 가족 프리미엄 (베타: 쿠폰으로 켜기)
--   - 가족 그룹마다 프리미엄 기간(premium_until)이 있어요. 지나면 저절로 꺼져요.
--   - 아직 결제가 없어서, 운영자가 만든 쿠폰 번호를 그룹 멤버가 넣으면 켜져요.
--     (나중에 결제를 붙이면 결제가 끝날 때 쿠폰을 자동으로 쓰는 식으로 이어 가요)
--   - 쿠폰은 만 14세 미만 계정은 쓸 수 없어요. (돈과 관련된 일은 어른이)
--   - "프리미엄이 나오면 쓰고 싶어요" 관심 신청은 숫자만 운영자 화면에 보여요.
--   - 멤버는 프리미엄 기간을 볼 수만 있고 바꿀 수 없어요. (그룹 이름만 바꿀 수 있는 그대로)
-- ---------------------------------------------------------------------
alter table public.family_groups add column if not exists premium_until timestamptz;

create table if not exists public.premium_codes (
  code        text primary key check (code ~ '^DORAN-[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  months      integer not null check (months between 1 and 24),
  note        text not null default '' check (char_length(note) <= 40),
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid references public.profiles (id) on delete set null,
  used_group  uuid references public.family_groups (id) on delete set null
);
alter table public.premium_codes enable row level security;  -- 규칙(policy)이 없으니 아래 함수로만 써요

create table if not exists public.premium_interest (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  group_id    uuid references public.family_groups (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.premium_interest enable row level security;

revoke all on public.premium_codes, public.premium_interest from public, anon, authenticated;

-- 이 그룹이 지금 프리미엄인지
create or replace function public.is_premium_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select g.premium_until > now() from public.family_groups g where g.id = p_group), false);
$$;

-- 쿠폰 쓰기: 그룹 멤버(만 14세 이상)가 쿠폰 번호를 넣으면 그 그룹의 프리미엄 기간이 늘어나요
create or replace function public.redeem_premium_code(p_group uuid, p_code text)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.premium_codes%rowtype;
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  until timestamptz;
begin
  if uid is null then raise exception '로그인이 필요해요.'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = uid) then
    raise exception '이 그룹의 멤버만 쿠폰을 쓸 수 있어요.';
  end if;
  if public.is_child_account(uid) then
    raise exception '쿠폰은 보호자 같은 어른 가족이 넣어 주세요.';
  end if;
  -- 'DORAN' + 8글자 → DORAN-XXXX-XXXX
  if norm !~ '^DORAN[A-Z2-9]{8}$' then
    raise exception '쿠폰 번호를 다시 확인해 주세요.';
  end if;
  norm := 'DORAN-' || substr(norm, 6, 4) || '-' || substr(norm, 10, 4);
  select * into c from public.premium_codes where code = norm for update;
  if not found then raise exception '쿠폰 번호를 다시 확인해 주세요.'; end if;
  if c.used_at is not null then raise exception '이미 사용한 쿠폰이에요.'; end if;
  update public.family_groups g
     set premium_until = greatest(coalesce(g.premium_until, now()), now()) + make_interval(months => c.months)
   where g.id = p_group
  returning g.premium_until into until;
  update public.premium_codes set used_at = now(), used_by = uid, used_group = p_group where code = norm;
  return until;
end;
$$;

-- 관심 신청: "프리미엄이 나오면 쓰고 싶어요" (한 사람당 한 번, 다시 누르면 그대로)
create or replace function public.register_premium_interest(p_group uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  insert into public.premium_interest (user_id, group_id)
  values (auth.uid(), case when exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid()) then p_group end)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.has_premium_interest()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.premium_interest i where i.user_id = auth.uid());
$$;

-- 운영자: 쿠폰 만들기 (한 번에 1~50개, 1~24개월)
create or replace function public.admin_create_premium_codes(p_count integer, p_months integer, p_note text default '')
returns setof text
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 헷갈리는 0 · O · 1 · I 는 빼요
  hex text; code text; made integer := 0; i integer;
begin
  if not public.is_admin() then raise exception '운영자만 쿠폰을 만들 수 있어요.' using errcode = '42501'; end if;
  if p_count not between 1 and 50 then raise exception '쿠폰은 한 번에 1~50개까지 만들 수 있어요.'; end if;
  if p_months not between 1 and 24 then raise exception '기간은 1~24개월로 정해 주세요.'; end if;
  while made < p_count loop
    hex := replace(gen_random_uuid()::text, '-', '');
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int % 32) + 1, 1);
    end loop;
    code := 'DORAN-' || substr(code, 1, 4) || '-' || substr(code, 5, 4);
    insert into public.premium_codes (code, months, note)
    values (code, p_months, left(btrim(coalesce(p_note, '')), 40))
    on conflict do nothing;
    if found then made := made + 1; return next code; end if;
  end loop;
end;
$$;

-- 운영자: 프리미엄 현황 (숫자 + 최근 쿠폰 100개, 누가 썼는지는 보여 주지 않아요)
create or replace function public.admin_premium_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception '운영자만 볼 수 있어요.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'interest_users', (select count(*) from public.premium_interest),
    'interest_7d', (select count(*) from public.premium_interest where created_at > now() - interval '7 days'),
    'premium_groups', (select count(*) from public.family_groups where premium_until > now()),
    'codes_unused', (select count(*) from public.premium_codes where used_at is null),
    'codes_used', (select count(*) from public.premium_codes where used_at is not null),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'months', c.months, 'note', c.note,
                                          'created_at', c.created_at, 'used_at', c.used_at)
             order by c.created_at desc, c.code)
      from (select * from public.premium_codes order by created_at desc, code limit 100) c
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function
  public.is_premium_group(uuid),
  public.redeem_premium_code(uuid, text),
  public.register_premium_interest(uuid),
  public.has_premium_interest(),
  public.admin_create_premium_codes(integer, integer, text),
  public.admin_premium_summary()
  from public, anon, authenticated;
grant execute on function
  public.is_premium_group(uuid),
  public.redeem_premium_code(uuid, text),
  public.register_premium_interest(uuid),
  public.has_premium_interest(),
  public.admin_create_premium_codes(integer, integer, text),
  public.admin_premium_summary()
  to authenticated;


-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 13 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 13" 이 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
