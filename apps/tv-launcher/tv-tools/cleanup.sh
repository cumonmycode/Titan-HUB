#!/usr/bin/env bash
# Removes the packages listed in a profile from an Android TV device over ADB.
# Play Store apps are deleted completely. System apps lose their installed
# updates and are uninstalled for user 0; restore.sh brings them back.
# Usage: ./cleanup.sh <ip[:port]> <profile>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/lib.sh"

connect_tv "${1:?Укажите IP телевизора}"
profile="${2:?Укажите профиль, например profiles/chromecast-gtv.txt}"
[[ -r "$profile" ]] || { echo "Профиль не найден: $profile" >&2; exit 1; }

run="$here/runs/$(model_slug)_$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run"
tv pm list packages > "$run/before.txt"
tv pm list packages -3 > "$run/third_party.txt"

is_installed() { grep -qx "package:$1" "$run/before.txt"; }
is_third_party() { grep -qx "package:$1" "$run/third_party.txt"; }
log() { printf '  %-55s %s\n' "$1" "$2" | tee -a "$run/log.txt"; }

remove_package() {
  local pkg="$1" result
  if is_third_party "$pkg"; then
    result="$(tv pm uninstall "$pkg" 2>&1 || true)"
    [[ "$result" == Success ]] && echo "$pkg" >> "$run/removed_user.txt"
  else
    tv pm uninstall-system-updates "$pkg" >/dev/null 2>&1 || true
    result="$(tv pm uninstall --user 0 "$pkg" 2>&1 || true)"
    [[ "$result" == Success ]] && echo "$pkg" >> "$run/removed_system.txt"
  fi
  log "$pkg" "$result"
}

echo "Удаляю пакеты из $profile (журнал: $run)"
while read -r pkg; do
  if is_installed "$pkg"; then
    remove_package "$pkg"
  else
    log "$pkg" "пропуск: не установлен"
  fi
done < <(sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$profile" | grep -v '^$')

tv pm list packages > "$run/after.txt"
echo
echo "Удалено системных: $(count_lines "$run/removed_system.txt"), приложений: $(count_lines "$run/removed_user.txt")"
printf 'Откат системных: %q %q %q\n' "$here/restore.sh" "$target" "$run/removed_system.txt"
