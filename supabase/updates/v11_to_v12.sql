-- =====================================================================
--  도란톡 업데이트: 버전 11 → 버전 12 (운영자 화면: 광고 · 가입 성과)
-- ---------------------------------------------------------------------
--  운영자 계정(admin@dorantalk.com)의 내 정보 → "광고 성과 (운영자)" 화면에
--  가입 경로별 가입자 수 · 날짜별 가입 · 주마다 활동한 가족 수를 보여 줘요. (숫자만, 내용은 안 봐요)
--  여러 번 실행해도 안전해요. 마지막에 "업데이트 완료! 버전 12" 가 보이면 성공.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 15. (버전 12) 운영자 화면: 광고 · 가입 성과 (숫자만)
--   - 운영자 계정(admin@dorantalk.com)만 부를 수 있어요.
--   - 가입 경로별 가입자 수 · 날짜별 가입 · 주마다 활동한 가족 수 같은 "숫자"만 돌려줘요.
--     이름 · 이메일 · 글 · 사진 · 채팅 내용은 돌려주지 않아요.
--   - 날짜는 한국 시간 기준이에요.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = 'admin@dorantalk.com'
  );
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  today timestamp := date_trunc('day', now() at time zone 'Asia/Seoul');  -- 오늘 0시 (한국 시간)
  today_start timestamptz := today at time zone 'Asia/Seoul';
  this_week timestamp := date_trunc('week', now() at time zone 'Asia/Seoul'); -- 이번 주 월요일 0시
begin
  if not public.is_admin() then
    raise exception '운영자만 볼 수 있어요.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'totals', (
      select jsonb_build_object(
        'users', count(*),
        'users_today', count(*) filter (where u.created_at >= today_start),
        'users_7d', count(*) filter (where u.created_at > now() - interval '7 days'))
      from auth.users u
    ) || jsonb_build_object(
      'groups', (select count(*) from public.family_groups),
      'posts', (select count(*) from public.posts),
      'messages', (select count(*) from public.messages)
    ),
    -- 가입 경로별: 전체 · 최근 7일 · 오늘 · 가족과 연결됨(다른 사람이 있는 그룹에 들어가 있음)
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'source', s.source, 'total', s.total, 'last7', s.last7, 'today', s.today, 'with_family', s.with_family)
             order by s.total desc, s.source)
      from (
        select left(coalesce(btrim(u.raw_user_meta_data->>'signup_from'), ''), 30) as source,
               count(*) as total,
               count(*) filter (where u.created_at > now() - interval '7 days') as last7,
               count(*) filter (where u.created_at >= today_start) as today,
               count(*) filter (where exists (
                 select 1 from public.group_members m
                 join public.group_members o on o.group_id = m.group_id and o.user_id <> m.user_id
                 where m.user_id = u.id)) as with_family
        from auth.users u
        group by 1
      ) s
    ), '[]'::jsonb),
    -- 날짜별 가입 (최근 14일, 오늘부터)
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d::date,
               'signups', (select count(*) from auth.users u
                           where u.created_at >= d at time zone 'Asia/Seoul'
                             and u.created_at < (d + interval '1 day') at time zone 'Asia/Seoul'))
             order by d desc)
      from generate_series(today - interval '13 days', today, interval '1 day') d
    ),
    -- 주마다: 글이나 채팅이 있었던 가족 수 · 새로 만든 가족 수 (최근 8주, 이번 주부터)
    'weekly', (
      select jsonb_agg(jsonb_build_object(
               'week', w::date,
               'active_groups', (
                 select count(distinct a.group_id) from (
                   select p.group_id, p.created_at from public.posts p
                   union all
                   select m.group_id, m.created_at from public.messages m
                 ) a
                 where a.created_at >= w at time zone 'Asia/Seoul'
                   and a.created_at < (w + interval '7 days') at time zone 'Asia/Seoul'),
               'new_groups', (
                 select count(*) from public.family_groups g
                 where g.created_at >= w at time zone 'Asia/Seoul'
                   and g.created_at < (w + interval '7 days') at time zone 'Asia/Seoul'))
             order by w desc)
      from generate_series(this_week - interval '7 weeks', this_week, interval '1 week') w
    )
  );
end;
$$;

revoke execute on function public.is_admin(), public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to authenticated;


-- 버전 표시
create or replace function public.talkfeed_schema_version()
returns integer
language sql immutable set search_path = ''
as $$ select 12 $$;
grant execute on function public.talkfeed_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

-- 아래 표에 "업데이트 완료! 버전 12" 가 보이면 성공
select '업데이트 완료! 버전 ' || public.talkfeed_schema_version() as 결과;
