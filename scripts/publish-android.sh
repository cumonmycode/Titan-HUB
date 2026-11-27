#!/usr/bin/env bash
# Выложить Android-версию HUB или My Titan на сервер для самообновления.
#
#   bash scripts/publish-android.sh mobile ["Что нового"]   — Titan HUB  → titanpos.ru/apps/hub/
#   bash scripts/publish-android.sh client ["Что нового"]   — My Titan   → titanpos.ru/apps/my-titan/
#
# APK берётся из apps/<app>/android/app/build/outputs/apk/release/ (собрать: npm run android:device).
# Сначала заливается APK, потом атомарно меняется latest.json — с этого момента все
# более старые версии при запуске просят обновиться и не пускают дальше (components/update-gate.tsx).
# Хранятся три последних APK. Подпись должна совпадать с установленной (debug-ключ шаблона Expo),
# иначе Android откажется ставить поверх.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-}"
NOTES="${2:-}"
case "$APP" in
  mobile) SLUG=hub; NAME=titan-hub ;;
  client) SLUG=my-titan; NAME=my-titan ;;
  *) echo "Укажите приложение: mobile (HUB) или client (My Titan)"; exit 1 ;;
esac

SSH_KEY="${TITAN_SSH_KEY:-$HOME/.ssh/titan_vps}"
SSH_HOST="${TITAN_SSH_HOST:-root@95.170.111.169}"
REMOTE_DIR="/opt/titan-hub/nginx/apps/$SLUG"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SSH_HOST")

APK="apps/$APP/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "Нет APK: $APK — сначала соберите (npm run android:device)"; exit 1; }
VERSION_NAME=$(node -p "require('./apps/$APP/app.json').expo.version")
VERSION_CODE=$(node -p "require('./apps/$APP/app.json').expo.android.versionCode")
# APK должен быть собран из текущего app.json: сверяем versionCode внутри файла.
AAPT=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt 2>/dev/null | tail -1 || true)
if [ -n "$AAPT" ]; then
  APK_CODE=$("$AAPT" dump badging "$APK" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")
  [ "$APK_CODE" = "$VERSION_CODE" ] || { echo "В APK versionCode $APK_CODE, в app.json $VERSION_CODE — пересоберите"; exit 1; }
fi
FILE="$NAME-$VERSION_NAME-$VERSION_CODE.apk"

echo "› Заливаю $FILE ($(du -h "$APK" | cut -f1))"
"${SSH[@]}" "mkdir -p '$REMOTE_DIR'"
scp -q -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$APK" "$SSH_HOST:$REMOTE_DIR/$FILE.part"
"${SSH[@]}" "mv '$REMOTE_DIR/$FILE.part' '$REMOTE_DIR/$FILE'"

MANIFEST=$(node -e '
const [code, name, apk, notes] = process.argv.slice(1)
process.stdout.write(JSON.stringify({ versionCode: Number(code), versionName: name, apk, minVersionCode: Number(code), notes: notes || undefined, publishedAt: new Date().toISOString() }, null, 2))
' "$VERSION_CODE" "$VERSION_NAME" "$FILE" "$NOTES")
printf '%s\n' "$MANIFEST" | "${SSH[@]}" "cat > '$REMOTE_DIR/latest.json.part' && mv '$REMOTE_DIR/latest.json.part' '$REMOTE_DIR/latest.json' && cd '$REMOTE_DIR' && ls -t $NAME-*.apk | tail -n +4 | xargs -r rm -f"

URL="https://titanpos.ru/apps/$SLUG"
echo "› Проверяю $URL/latest.json"
curl -fsS "$URL/latest.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("  versionCode",j.versionCode,"·",j.apk)})'
curl -fsSI "$URL/$FILE" | grep -i "^content-type\|^content-length" | sed 's/^/  /'
echo "✓ $NAME $VERSION_NAME ($VERSION_CODE) опубликован: старые версии попросят обновиться"
