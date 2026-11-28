#!/usr/bin/env bash
# Выложить анимированные рекламные сцены экранов на сервер:
#   https://titanpos.ru/apps/ads/<id>.html  (+ ads.css, motion.js, gsap, fonts/, media/, posters/)
#
# Сборка: cd apps/screen-ads && npm ci && npm run fetch && npm run build && npm run render -- posters
# (постеры — PNG, перед выкладкой их стоит сжать в JPG: см. README).
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_KEY="${TITAN_SSH_KEY:-$HOME/.ssh/titan_vps}"
SSH_HOST="${TITAN_SSH_HOST:-root@95.170.111.169}"
REMOTE_DIR="/opt/titan-hub/nginx/apps/ads"
DIST="apps/screen-ads/dist"
[ -f "$DIST/scenes.json" ] || { echo "Нет $DIST — сначала соберите сцены"; exit 1; }

echo "› Заливаю сцены ($(du -sh "$DIST" | cut -f1))"
ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes" "$DIST/" "$SSH_HOST:$REMOTE_DIR/"

URL="https://titanpos.ru/apps/ads"
for f in scenes.json play-table.html ads.css motion.js; do
  printf '  %-16s %s\n' "$f" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$URL/$f")"
done
echo "✓ Сцены: $URL/<id>.html"
