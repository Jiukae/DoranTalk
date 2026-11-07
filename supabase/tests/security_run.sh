#!/usr/bin/env bash
# 정식 보안 시험 — 데이터베이스 (로컬 PostgreSQL 전용, 개발 검증용)
#   실제 Supabase처럼 기본 권한을 준 상태(supabase_defaults.sql)에서 schema.sql 을 실행하고 security_test.sql 로 공격해 봐요.
# 사용: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/security_run.sh
#       (예전 버전과 비교: SCHEMA=/경로/옛schema.sql ./supabase/tests/security_run.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-talkfeed_security}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
for r in anon authenticated; do
  psql -q -d postgres -c "do \$\$ begin create role $r nologin; exception when duplicate_object then null; end \$\$;"
done
sed -e '/^create role/d' tests/supabase_stub.sql | psql -q -v ON_ERROR_STOP=1 -d $DB
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/supabase_defaults.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f "${SCHEMA:-schema.sql}" 2>&1 | grep -v NOTICE || true
psql -v ON_ERROR_STOP=1 -d $DB -f tests/security_test.sql
