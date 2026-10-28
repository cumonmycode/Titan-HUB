#!/usr/bin/env bash
# Read-only snapshot of an Android TV / Google TV device over ADB.
# Changes nothing on the device. Usage: ./audit.sh <ip[:port]>
# Output: audits/<model>_<timestamp>/*.txt next to this script.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/lib.sh"

connect_tv "${1:?Укажите IP телевизора: ./audit.sh 192.168.1.50}"

out="$here/audits/$(model_slug)_$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

capture() {
  local name="$1"; shift
  tv "$@" > "$out/$name.txt" 2>&1 || echo "  ! $name: команда вернула ошибку (см. $name.txt)" >&2
}

echo "Снимаю данные с $target → $out"

# Device and resources
capture props getprop
capture meminfo cat /proc/meminfo
capture storage df -h
capture thermal dumpsys thermalservice

# Packages; packages_all_incl_uninstalled is the rollback baseline
capture packages_system pm list packages -s
capture packages_third_party pm list packages -3
capture packages_disabled pm list packages -d
capture packages_all_incl_uninstalled pm list packages -u
capture packages_paths pm list packages -f -i -U
capture app_sizes dumpsys diskstats

# What runs and what eats memory/CPU
capture memory_by_process dumpsys meminfo
capture top top -b -n 1 -m 40
capture boot_receivers cmd package query-receivers --brief -a android.intent.action.BOOT_COMPLETED
capture home_activity cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME

# Settings snapshot (animation scales, screensaver, etc.)
capture settings_global settings list global
capture settings_secure settings list secure
capture settings_system settings list system

prop() { sed -n "s/^\[$1\]: \[\(.*\)\]$/\1/p" "$out/props.txt"; }
mem_mb() { awk -v key="$1:" '$1 == key { printf "%d MB", $2 / 1024 }' "$out/meminfo.txt"; }
count() { wc -l < "$out/$1.txt" | tr -d ' '; }

echo
echo "Модель:    $(prop ro.product.model) ($(prop ro.product.device))"
echo "Android:   $(prop ro.build.version.release), SDK $(prop ro.build.version.sdk), патч $(prop ro.build.version.security_patch)"
echo "RAM:       всего $(mem_mb MemTotal), доступно $(mem_mb MemAvailable)"
echo "Накопитель: $(awk '$NF == "/data" { print $3 " занято из " $2 " (" $5 ")" }' "$out/storage.txt")"
echo "Пакеты:    системных $(count packages_system), установленных $(count packages_third_party), отключённых $(count packages_disabled)"
