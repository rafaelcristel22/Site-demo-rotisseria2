#!/usr/bin/env bash
# Backup lógico do banco (complementar ao backup/PITR do Supabase).
# Uso: DATABASE_URL="postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres" scripts/backup.sh [pasta]
# Agende no cron do servidor de backup, ex.: 0 3 * * * /opt/erp/scripts/backup.sh /backups
set -euo pipefail
DEST="${1:-./backups}"; mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/rotisseria-$STAMP.dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage --file="$FILE"
sha256sum "$FILE" > "$FILE.sha256"
# mantém os últimos 30 backups
ls -1t "$DEST"/rotisseria-*.dump | tail -n +31 | while read -r f; do rm -f -- "$f" "$f.sha256"; done
echo "Backup gerado: $FILE"
# Restauração (em banco vazio): pg_restore --no-owner -d "$DATABASE_URL_DESTINO" "$FILE"
