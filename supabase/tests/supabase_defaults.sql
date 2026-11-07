-- 보안 시험용: 실제 Supabase의 "기본 권한"을 흉내 내요. (실제 Supabase에서 실행하지 마세요)
-- 실제 Supabase는 public 에 새로 만든 표 · 함수 · 순번에 anon / authenticated 가 "모든 권한"을 기본으로 받아요.
-- 그래서 schema.sql 이 빼앗아야 할 권한을 하나라도 놓치면, 이 상태에서 돌린 security_test.sql 이 찾아내요.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- 사진 창고 표도 실제처럼 권한은 모두 주고, 보안 규칙(RLS)으로만 막아요
grant all on storage.objects to anon, authenticated;
grant all on storage.buckets to anon, authenticated;
alter table storage.buckets enable row level security;
