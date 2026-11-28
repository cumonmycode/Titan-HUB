#!/usr/bin/env bash
# Выложить установщик Titan Screen (Windows) на сервер:
#   https://titanpos.ru/apps/screen/TitanScreen-Setup.exe        — всегда последняя версия (ссылка в HUB)
#   https://titanpos.ru/apps/screen/TitanScreen-Setup-<версия>.exe
#
# Сборка: cd apps/screen-pc && npm ci && npm run dist:win  (на Mac тоже — Wine не нужен).
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_KEY="${TITAN_SSH_KEY:-$HOME/.ssh/titan_vps}"
SSH_HOST="${TITAN_SSH_HOST:-root@95.170.111.169}"
REMOTE_DIR="/opt/titan-hub/nginx/apps/screen"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SSH_HOST")

VERSION=$(node -p "require('./apps/screen-pc/package.json').version")
EXE="apps/screen-pc/dist/TitanScreen-Setup-$VERSION.exe"
[ -f "$EXE" ] || { echo "Нет $EXE — сначала соберите (npm run dist:win в apps/screen-pc)"; exit 1; }
FILE="TitanScreen-Setup-$VERSION.exe"

echo "› Заливаю $FILE ($(du -h "$EXE" | cut -f1))"
"${SSH[@]}" "mkdir -p '$REMOTE_DIR'"
scp -q -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$EXE" "$SSH_HOST:$REMOTE_DIR/$FILE.part"
# Сначала файл версии, потом атомарно — «последняя»; храним три последние версии.
"${SSH[@]}" "cd '$REMOTE_DIR' && mv '$FILE.part' '$FILE' && cp '$FILE' TitanScreen-Setup.exe.part && mv TitanScreen-Setup.exe.part TitanScreen-Setup.exe && ls -t TitanScreen-Setup-*.exe | tail -n +4 | xargs -r rm -f"

URL="https://titanpos.ru/apps/screen/TitanScreen-Setup.exe"
curl -fsSI "$URL" | grep -i "^content-length" | sed 's/^/  /'
echo "✓ Titan Screen $VERSION: $URL"
