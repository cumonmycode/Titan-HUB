#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Titan HUB — деплой / обновление на VPS
# Запускать из /opt/titan-hub
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/opt/titan-hub"
cd "$REPO_DIR"

echo "🔄 Получение последних изменений..."
git fetch origin main
git reset --hard origin/main

# Зависимости ставятся внутри Docker-сборки (.dockerignore исключает хостовые
# node_modules), поэтому Node/pnpm на самом хосте не нужны.

echo "🔐 Проверка .env..."
if [ ! -f .env ]; then
  echo "❌ Файл .env не найден! Скопируй .env.example и заполни."
  exit 1
fi

echo "🏗️  Сборка образов (с кешем слоёв)..."
# Без --no-cache: изменённый исходник всё равно инвалидирует COPY-слои и
# пересобирается, а неизменные сервисы переиспользуют кеш. Полный --no-cache
# на маленьком VPS перегружает машину (3 параллельные сборки Next.js).
docker compose build

# Бэкап БД ПЕРЕД миграциями (они применяются при старте api в up -d).
# Не валим деплой, если бэкап не удался (напр. первый запуск), но громко предупреждаем.
echo "💾 Бэкап БД перед миграциями..."
bash scripts/backup-db.sh || echo "⚠️  Бэкап не удался — продолжаю деплой (проверь postgres!)"

echo "🚀 Перезапуск сервисов..."
# up -d пересоздаёт только изменившиеся контейнеры (минимум простоя),
# дожидается healthy-зависимостей по условиям из compose.
docker compose up -d --remove-orphans

# Миграции БД применяются автоматически при старте API-контейнера
# (apps/api/src/migrations/runner.ts — идемпотентно, в транзакции,
# до начала обслуживания запросов). Отдельный шаг не нужен.

echo "⏳ Ожидание готовности сервисов..."
sleep 10

# Пересозданные контейнеры (api/web/wallet) получают новые IP в docker-сети —
# nginx нужно подхватить их. И ГЛАВНОЕ: nginx.conf бинд-маунтится как ОДИН ФАЙЛ,
# а `git reset --hard` подменяет файл новым inode. Docker single-file mount держит
# СТАРЫЙ inode, поэтому `nginx -s reload` перечитывал бы УСТАРЕВШИЙ конфиг и правки
# маршрутов (напр. /residents) не применялись бы. Пересоздание контейнера заново
# привязывает mount к актуальному файлу И обновляет upstream-IP. Простой ~1-2с.
echo "🔁 Пересоздание nginx (свежий конфиг + upstream-IP)..."
docker compose up -d --force-recreate nginx || docker compose restart nginx

# Домен сайта клуба (HUB → «Сайт → Домен»): агент выпускает сертификат и пишет
# конфиг nginx. Запускаем сразу и ставим в cron раз в 5 минут (идемпотентно).
echo "🌍 Домен сайта клуба..."
mkdir -p nginx/sites
SITE_AGENT_CRON="*/5 * * * * cd $REPO_DIR && bash scripts/site/domain-agent.sh >> /var/log/site-domain-agent.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'scripts/site/domain-agent.sh'; echo "$SITE_AGENT_CRON" ) | crontab -
bash scripts/site/domain-agent.sh >> /var/log/site-domain-agent.log 2>&1 || echo "⚠️  Агент домена сайта завершился с ошибкой — см. /var/log/site-domain-agent.log"

echo "🏥 Проверка health (через nginx)..."
# Порт api не публикуется на хост — проверяем публичный endpoint через nginx.
curl -sf https://titanpos.ru/api/health && echo "✅ API OK" || echo "❌ API не отвечает"

echo ""
echo "✅ Деплой завершён!"
echo "🌐 https://titanpos.ru"
