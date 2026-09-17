#!/usr/bin/env bash
# Дневной дамп БД с ротацией (crontab: 15 3 * * * .../backup.sh >> /var/log/mybudget-backup.log 2>&1).
# Еженедельную копию — во внешнее хранилище (например, rclone в Yandex Object Storage).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mybudget}"
KEEP="${KEEP:-14}" # дневных копий хранить
COMPOSE_DIR="${COMPOSE_DIR:-/opt/mybudget/server}"

cd "$COMPOSE_DIR"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/mybudget-$(date +%F-%H%M%S).sql.gz"

# Через временный файл: оборванный дамп не попадёт в ротацию.
docker compose exec -T db pg_dump -U mybudget mybudget | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"

# Ротация: последние KEEP файлов по mtime.
ls -1t "$BACKUP_DIR"/mybudget-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "$(date -Is) backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
