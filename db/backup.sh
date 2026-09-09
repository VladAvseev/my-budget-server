#!/usr/bin/env bash
# Дневной дамп БД my-budget с ротацией.
# Установка на сервере (crontab -u root -e):
#   15 3 * * * /opt/mybudget/server/db/backup.sh >> /var/log/mybudget-backup.log 2>&1
#
# Раз в неделю стоит копировать свежий дамп во вне-серверное хранилище,
# например в Yandex Object Storage (rclone configured remote 'yobucket'):
#   30 4 * * 0  rclone copy /var/backups/mybudget yobucket:mybudget-backups >> /var/log/mybudget-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mybudget}"
KEEP="${KEEP:-14}" # сколько дневных копий хранить
COMPOSE_DIR="${COMPOSE_DIR:-/opt/mybudget/server}"

cd "$COMPOSE_DIR"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/mybudget-$(date +%F-%H%M%S).sql.gz"

# Пишем во временный файл: оборванный дамп не попадёт в ротацию как «успешный».
docker compose exec -T db pg_dump -U mybudget mybudget | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"

# Ротация: оставляем KEEP последних файлов, сортировка по времени mtime.
ls -1t "$BACKUP_DIR"/mybudget-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "$(date -Is) backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
