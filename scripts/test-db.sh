#!/usr/bin/env bash
# Cria um banco limpo, aplica shim do Supabase + migrações + seed e roda os testes SQL.
# Uso: DATABASE_URL=postgres://... scripts/test-db.sh   (padrão: banco local via usuário postgres)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB_NAME:-rotisseria_test}"
PSQL_ADMIN="${PSQL_ADMIN:-psql -v ON_ERROR_STOP=1 -q -U postgres -h ${PGHOST:-localhost}}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
$PSQL_ADMIN -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { $PSQL_ADMIN -d "$DB" -f "$1" >/dev/null; echo "  ✓ $(basename "$1")"; }
echo "→ shim"; run "$ROOT/supabase/tests/00_supabase_shim.sql"
echo "→ migrações"; for f in "$ROOT"/supabase/migrations/*.sql; do run "$f"; done
echo "→ seed"; run "$ROOT/supabase/seed.sql"; run "$ROOT/supabase/seed_catalog_demo.sql"
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "→ testes"
  for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
    $PSQL_ADMIN -d "$DB" -f "$f" 2>&1 | grep -E "NOTICE|ERROR|FAIL" | sed 's/^psql:[^ ]* //' || true
    $PSQL_ADMIN -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "  ✗ $(basename "$f") FALHOU"; exit 1; }
  done
fi
echo "OK"
