#!/usr/bin/env bash
# Сборка MafBoard и установка на подключённый iPhone.
#
#   scripts/install-device.sh            — первое доступное устройство
#   scripts/install-device.sh <UDID>     — конкретное (UDID: xcrun devicectl list devices)
#
# Подпись — команда G99YH9UK8C. Профиль Xcode создаёт сам: через аккаунт в Xcode или,
# если его нет, через ключ App Store Connect API (тот же, что у ios:testflight в apps/mobile):
#   ASC_KEY_ID, ASC_ISSUER_ID — в окружении или в scripts/.asc-env (файл не хранится в git;
#   по умолчанию берётся apps/mobile/scripts/.asc-env), ключ — ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
set -euo pipefail
cd "$(dirname "$0")/.."

# В рабочей копии (git worktree) файла нет — тогда берём его из основной копии репозитория.
MAIN_CHECKOUT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd || true)"
for env in scripts/.asc-env ../../mobile/scripts/.asc-env "$MAIN_CHECKOUT/apps/mobile/scripts/.asc-env"; do
  if [ -f "$env" ]; then
    # shellcheck disable=SC1090
    . "$env"
    break
  fi
done

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '
    /physical/ && /(available|connected)/ && /iPhone/ {
      for (i = 1; i <= NF; i++)
        if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit }
    }')
fi
if [ -z "$DEVICE" ]; then
  echo "Не вижу iPhone. Подключите его, разблокируйте или передайте UDID аргументом."
  exit 1
fi

echo "› Генерирую Xcode-проект"
xcodegen generate --quiet

AUTH=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  AUTH=(-authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
        -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

mkdir -p build
LOG=build/device.log
echo "› Собираю для $DEVICE (лог: $LOG)"
if ! xcodebuild \
  -project MafBoard.xcodeproj \
  -scheme MafBoard \
  -configuration Debug \
  -destination "id=$DEVICE" \
  -derivedDataPath build/DerivedData \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  ${AUTH[@]+"${AUTH[@]}"} \
  build >"$LOG" 2>&1; then
  grep -E "error:" "$LOG" | sort -u | head -20 || true
  echo "Сборка не удалась, подробности в $LOG"
  exit 1
fi

echo "› Устанавливаю и запускаю"
xcrun devicectl device install app --device "$DEVICE" build/DerivedData/Build/Products/Debug-iphoneos/MafBoard.app >/dev/null
xcrun devicectl device process launch --device "$DEVICE" ru.titan.mafboard >/dev/null 2>&1 \
  || echo "Установлено. Откройте MafBoard на телефоне (если он заблокирован — разблокируйте)."
echo "✓ Готово"
