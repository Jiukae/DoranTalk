-- 로컬 PostgreSQL에서 schema.sql을 검증하기 위한 Supabase 흉내(stub).
-- 실제 Supabase에는 실행하지 마세요. (개발 검증 전용)
create role anon nologin;
create role authenticated nologin;
create extension if not exists pgcrypto;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  email_confirmed_at timestamptz default now(),
  created_at timestamptz not null default now()
);
-- 실제 Supabase와 같은 방식: PostgREST가 넣어 주는 JWT 정보에서 사용자 ID를 꺼냄
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
-- 실제 Supabase와 같은 auth.jwt(): 로그인 정보(JWT) 전체
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
grant usage on schema auth to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner_id text default auth.uid()::text
);
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;

create publication supabase_realtime;
