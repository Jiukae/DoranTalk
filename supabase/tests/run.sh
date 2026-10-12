#!/usr/bin/env bash
# 로컬 PostgreSQL에서 schema.sql + 보안 테스트 실행 (개발 검증용)
# 사용: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=talkfeed_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
for r in anon authenticated; do
  psql -q -d postgres -c "do \$\$ begin create role $r nologin; exception when duplicate_object then null; end \$\$;"
done
sed -e '/^create role/d' tests/supabase_stub.sql | psql -q -v ON_ERROR_STOP=1 -d $DB
psql -q -v ON_ERROR_STOP=1 -d $DB -f schema.sql
# 두 번 실행해도 안전한지 확인
psql -q -v ON_ERROR_STOP=1 -d $DB -f schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/rls_test.sql
