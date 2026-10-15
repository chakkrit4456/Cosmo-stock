#!/usr/bin/env bash
# ติดตั้ง CosmoStock + PostgreSQL บนเซิร์ฟเวอร์ Debian/Ubuntu โดยตรง (ไม่ใช้ Docker)
#   รันในโฟลเดอร์โปรเจกต์:   sudo bash deploy/install.sh
# รันซ้ำได้อย่างปลอดภัย: ไม่ลบข้อมูล ไม่สร้างฐานข้อมูล/รหัสผ่านใหม่ถ้ามีอยู่แล้ว
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${APP_USER:-cosmostock}"
DB_NAME="${DB_NAME:-cosmostock}"
DB_USER="${DB_USER:-cosmostock}"
PORT="${PORT:-3000}"

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย sudo (root)"; exit 1; }
command -v apt-get >/dev/null || { echo "สคริปต์นี้รองรับ Debian/Ubuntu (apt)"; exit 1; }

echo "▶ 1/6 ตรวจ Node.js (ต้อง 22.13+)"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "  ไม่พบ Node.js 22.13+ — ติดตั้งจาก NodeSource"
  apt-get update -y && apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "▶ 2/6 ติดตั้ง PostgreSQL"
if ! command -v psql >/dev/null || ! systemctl list-unit-files | grep -q '^postgresql'; then
  apt-get update -y
  apt-get install -y postgresql postgresql-client
fi
systemctl enable --now postgresql
for i in $(seq 1 30); do pg_isready -q && break; sleep 1; done
pg_isready || { echo "PostgreSQL ยังไม่พร้อม"; exit 1; }

echo "▶ 3/6 สร้างผู้ใช้และฐานข้อมูล"
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  echo "  พบ .env เดิม ใช้ค่าเดิม (ไม่สร้างรหัสผ่านใหม่)"
else
  DB_PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  if su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
    su postgres -c "psql -qc \"ALTER ROLE $DB_USER PASSWORD '$DB_PASS'\""
  else
    su postgres -c "psql -qc \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'\""
  fi
  umask 077
  cat > "$ENV_FILE" <<EOT
PORT=$PORT
HOST=0.0.0.0
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
EOT
  echo "  สร้าง $ENV_FILE แล้ว"
fi
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 \
  || su postgres -c "createdb -O $DB_USER -E UTF8 $DB_NAME"

echo "▶ 4/6 ติดตั้งไลบรารี (npm)"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$ENV_FILE"
su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund"

echo "▶ 5/6 นำเข้าข้อมูลเดิมจาก SQLite (ถ้ามีไฟล์ data/cosmostock.db และ PostgreSQL ยังว่าง)"
if [ -f "$APP_DIR/data/cosmostock.db" ]; then
  su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && node --disable-warning=ExperimentalWarning scripts/import-sqlite.mjs" || echo "  (ข้ามการนำเข้า — ดูข้อความด้านบน)"
else
  echo "  ไม่มีไฟล์ SQLite เดิม ข้ามขั้นตอนนี้"
fi

echo "▶ 6/6 ตั้งให้ระบบเปิดเองทุกครั้งที่เซิร์ฟเวอร์บูต (systemd)"
cat > /etc/systemd/system/cosmostock.service <<EOT
[Unit]
Description=CosmoStock (ระบบจัดการคลังสินค้าเครื่องสำอาง)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOT
systemctl daemon-reload
systemctl enable cosmostock
systemctl restart cosmostock

# สำรองข้อมูลอัตโนมัติทุกคืน 02:30 (เก็บ 14 วัน)
cat > /etc/cron.d/cosmostock-backup <<EOT
30 2 * * * root APP_DIR=$APP_DIR bash $APP_DIR/deploy/backup.sh >> /var/log/cosmostock-backup.log 2>&1
EOT
chmod 644 /etc/cron.d/cosmostock-backup

sleep 3
echo
systemctl --no-pager --lines=12 status cosmostock || true
echo
echo "เสร็จแล้ว ✔  เปิดใช้งานที่ http://<ip-เซิร์ฟเวอร์>:$PORT"
echo "  • ดูรหัสผ่านแอดมินที่สร้างครั้งแรก:  journalctl -u cosmostock | grep -A3 'รหัสผ่าน'"
echo "  • ดู log:       journalctl -u cosmostock -f"
echo "  • สำรองข้อมูล:  bash $APP_DIR/deploy/backup.sh   (ไฟล์อยู่ที่ /var/backups/cosmostock)"
echo "  • อัปเดตโค้ด:   git pull && sudo bash deploy/install.sh"
echo "  • ถ้าไม่ต้องการข้อมูลตัวอย่างกับข้อมูลจริง ให้เพิ่ม SEED_DEMO=0 ใน $ENV_FILE ก่อนติดตั้งครั้งแรก"
