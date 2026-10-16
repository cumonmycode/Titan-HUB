#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Titan HUB — бэкап Postgres (pg_dump → gzip), ротация 14 дней.
# Запускается: (1) cron ежедневно, (2) deploy.sh ПЕРЕД миграциями.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/opt/titan-hub"
BACKUP_DIR="/opt/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

cd "$REPO_DIR"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/titan_${TS}.sql.gz"

# pg_dump из работающего контейнера postgres (без публикации порта на хост).
# --clean --if-exists: дамп можно восстановить ПОВЕРХ существующей БД (DROP+CREATE),
# что нужно для кнопки «Восстановить» в «О системе».
docker compose exec -T postgres pg_dump -U titan -d titan_hub --clean --if-exists --no-owner --no-privileges | gzip > "$FILE"

# Проверка, что файл не пустой (gzip с данными > ~1KB).
SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 1024 ]; then
  echo "❌ Бэкап подозрительно мал ($SIZE байт) — возможно, БД недоступна: $FILE"
  exit 1
fi

echo "✅ Бэкап: $FILE ($(du -h "$FILE" | cut -f1))"

# Локальная ротация: удаляем бэкапы старше KEEP_DAYS дней.
find "$BACKUP_DIR" -name 'titan_*.sql.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

# ── Офсайт-копия в Google Drive через rclone (опционально) ────────────────────
# Активируется автоматически, КОГДА на сервере настроен rclone-remote (по умолчанию
# имя "gdrive"): `rclone config` → тип "drive" → одноразовый вход в Google.
# Пока remote не настроен — шаг тихо пропускается (бэкап локально уже сделан).
REMOTE="${BACKUP_RCLONE_REMOTE:-gdrive}"
REMOTE_DIR="${BACKUP_RCLONE_DIR:-titan-backups}"
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
  if rclone copy "$FILE" "${REMOTE}:${REMOTE_DIR}/" --no-traverse 2>/dev/null; then
    echo "☁️  Выгружено в ${REMOTE}:${REMOTE_DIR}/$(basename "$FILE")"
    # Ротация на Drive: удаляем удалённые копии старше KEEP_DAYS дней.
    rclone delete "${REMOTE}:${REMOTE_DIR}/" --min-age "${KEEP_DAYS}d" 2>/dev/null || true
  else
    echo "⚠️  Не удалось выгрузить бэкап в Google Drive (remote=${REMOTE}) — локальная копия сохранена"
  fi
fi

# ── Мультиклуб: control-реестр + пер-клубные БД (database-per-club) ───────────
# Основной titan_hub забэкаплен выше (критичный путь + UI-restore). Здесь — ОТДЕЛЬНЫЕ
# файлы для titan_control и каждой club_<slug>-БД, чтобы данные арендаторов не
# терялись. BEST-EFFORT: сбой по любой из них логируется и НЕ роняет скрипт
# (set -e не срабатывает — все шаги защищены). Имена файлов: <db>_<ts>.sql.gz,
# своя ротация и выгрузка в Drive по маске на каждую БД.
EXTRA_DBS=$(docker compose exec -T postgres psql -U titan -d titan_hub -tAc \
  "SELECT datname FROM pg_database WHERE datname IN ('titan_control', 'mafboard') OR datname LIKE 'club_%' ORDER BY datname" 2>/dev/null | tr -d '\r' || true)
for DBN in $EXTRA_DBS; do
  [ -z "$DBN" ] && continue
  EF="$BACKUP_DIR/${DBN}_${TS}.sql.gz"
  if docker compose exec -T postgres pg_dump -U titan -d "$DBN" --clean --if-exists --no-owner --no-privileges 2>/dev/null | gzip > "$EF"; then
    ESIZE=$(stat -f%z "$EF" 2>/dev/null || stat -c%s "$EF" 2>/dev/null || echo 0)
    if [ "$ESIZE" -lt 512 ]; then
      echo "⚠️  Бэкап $DBN подозрительно мал ($ESIZE б) — пропуск"; rm -f "$EF"; continue
    fi
    echo "✅ Бэкап $DBN: $EF ($(du -h "$EF" | cut -f1))"
    find "$BACKUP_DIR" -name "${DBN}_*.sql.gz" -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
    if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:"; then
      rclone copy "$EF" "${REMOTE}:${REMOTE_DIR}/" --no-traverse 2>/dev/null || \
        echo "⚠️  Не удалось выгрузить $DBN в Drive — локальная копия сохранена"
      rclone delete "${REMOTE}:${REMOTE_DIR}/" --include "${DBN}_*.sql.gz" --min-age "${KEEP_DAYS}d" 2>/dev/null || true
    fi
  else
    echo "⚠️  Не удалось забэкапить $DBN — пропуск"; rm -f "$EF" 2>/dev/null || true
  fi
done
