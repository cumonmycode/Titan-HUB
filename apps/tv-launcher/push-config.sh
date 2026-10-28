#!/usr/bin/env bash
# Sends config.json to the TV. The launcher validates it, stores it encrypted
# and deletes the plain copy the next time it opens.
# Usage: ./push-config.sh <ip[:port]> [path/to/config.json]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/tv-tools/lib.sh"

connect_tv "${1:?Укажите IP телевизора}"
config="${2:-$here/config.json}"
[[ -r "$config" ]] || { echo "Нет файла $config — скопируйте config.example.json в config.json и заполните" >&2; exit 1; }

"$ADB" -s "$target" push "$config" /sdcard/Android/data/ru.titan.tv/files/config.json >/dev/null
tv am start -n ru.titan.tv/.MainActivity >/dev/null
echo "Конфиг отправлен — Titan TV применит его при открытии"
