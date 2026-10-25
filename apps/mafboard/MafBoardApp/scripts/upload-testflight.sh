#!/usr/bin/env bash
# Сборка архива MafBoard и загрузка билда в TestFlight.
#
#   scripts/upload-testflight.sh          — поднять номер сборки в project.yml, собрать, загрузить
#   scripts/upload-testflight.sh --keep   — не трогать номер сборки (первая загрузка или повтор)
#
# Ключ App Store Connect API — тот же, что у install-device.sh: ASC_KEY_ID, ASC_ISSUER_ID
# в окружении или в scripts/.asc-env (по умолчанию apps/mobile/scripts/.asc-env основной копии),
# файл ключа — ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8.
set -euo pipefail
cd "$(dirname "$0")/.."

MAIN_CHECKOUT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd || true)"
for env in scripts/.asc-env ../../mobile/scripts/.asc-env "$MAIN_CHECKOUT/apps/mobile/scripts/.asc-env"; do
  if [ -f "$env" ]; then
    # shellcheck disable=SC1090
    . "$env"
    break
  fi
done

KEY_ID="${ASC_KEY_ID:-}"
ISSUER_ID="${ASC_ISSUER_ID:-}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
if [ -z "$KEY_ID" ] || [ -z "$ISSUER_ID" ] || [ ! -f "$KEY_PATH" ]; then
  echo "Нужны ASC_KEY_ID, ASC_ISSUER_ID и файл $KEY_PATH (App Store Connect → Users and Access → Integrations)."
  exit 1
fi
AUTH=(-authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

# App Store Connect отклоняет повторный CFBundleVersion в той же версии.
if [ "${1:-}" != "--keep" ]; then
  current=$(sed -n 's/^    CURRENT_PROJECT_VERSION: "\([0-9]*\)"/\1/p' project.yml)
  sed -i '' "s/^    CURRENT_PROJECT_VERSION: \"$current\"/    CURRENT_PROJECT_VERSION: \"$((current + 1))\"/" project.yml
  echo "› Номер сборки: $((current + 1)) (закоммитьте project.yml)"
fi
VERSION=$(sed -n 's/^    MARKETING_VERSION: "\(.*\)"/\1/p' project.yml)
BUILD=$(sed -n 's/^    CURRENT_PROJECT_VERSION: "\(.*\)"/\1/p' project.yml)

echo "› Генерирую Xcode-проект"
xcodegen generate --quiet

OUT=build/testflight
rm -rf "$OUT"
mkdir -p "$OUT"
echo "› Собираю архив $VERSION ($BUILD), лог: $OUT/archive.log"
if ! xcodebuild \
  -project MafBoard.xcodeproj \
  -scheme MafBoard \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$OUT/MafBoard.xcarchive" \
  -derivedDataPath build/DerivedData \
  -allowProvisioningUpdates \
  "${AUTH[@]}" \
  archive >"$OUT/archive.log" 2>&1; then
  grep -E "error:" "$OUT/archive.log" | sort -u | head -20 || true
  echo "Архив не собрался, подробности в $OUT/archive.log"
  exit 1
fi

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>G99YH9UK8C</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

echo "› Экспортирую IPA"
if ! xcodebuild -exportArchive \
  -archivePath "$OUT/MafBoard.xcarchive" \
  -exportPath "$OUT/ipa" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -allowProvisioningUpdates \
  "${AUTH[@]}" >"$OUT/export.log" 2>&1; then
  grep -E "error:" "$OUT/export.log" | sort -u | head -20 || true
  echo "Экспорт не удался, подробности в $OUT/export.log"
  exit 1
fi

IPA=$(find "$OUT/ipa" -name "*.ipa" | head -1)
[ -n "$IPA" ] || { echo "IPA не найден в $OUT/ipa"; exit 1; }
echo "✓ IPA: $IPA ($(du -h "$IPA" | cut -f1))"

echo "› Проверяю и загружаю в App Store Connect"
xcrun altool --validate-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID" 2>&1 | tail -5
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID" 2>&1 | tail -5
echo "✓ Билд $VERSION ($BUILD) появится в TestFlight после обработки (обычно 5–15 минут)."
