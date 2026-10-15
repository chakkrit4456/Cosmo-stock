#!/usr/bin/env bash
# สำรองฐานข้อมูล PostgreSQL ของ CosmoStock เป็นไฟล์ .sql.gz (เก็บ 14 วัน)
#   วิธีใช้: bash deploy/backup.sh      กู้คืน: gunzip -c ไฟล์.sql.gz | psql "$DATABASE_URL"
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUT="${BACKUP_DIR:-/var/backups/cosmostock}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# shellcheck disable=SC1091
[ -f "$APP_DIR/.env" ] && { set -a; . "$APP_DIR/.env"; set +a; }
: "${DATABASE_URL:?ไม่พบ DATABASE_URL (ตั้งใน .env)}"
mkdir -p "$OUT"
FILE="$OUT/cosmostock-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner --clean --if-exists "$DATABASE_URL" | gzip > "$FILE"
chmod 600 "$FILE"
find "$OUT" -name 'cosmostock-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "สำรองข้อมูลแล้ว: $FILE ($(du -h "$FILE" | cut -f1))"
