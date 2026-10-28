#!/usr/bin/env bash
# Brings back system packages removed by cleanup.sh.
# Usage: ./restore.sh <ip[:port]> <removed_system.txt | package name>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/lib.sh"

connect_tv "${1:?Укажите IP телевизора}"
source_arg="${2:?Укажите файл removed_system.txt или имя пакета}"

if [[ -f "$source_arg" ]]; then
  packages="$(cat "$source_arg")"
else
  packages="$source_arg"
fi

for pkg in $packages; do
  printf '  %-55s %s\n' "$pkg" "$(tv cmd package install-existing "$pkg" 2>&1 || true)"
done
