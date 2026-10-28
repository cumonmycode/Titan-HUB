# Shared helpers for tv-tools scripts. Source it, do not run it.

readonly DEFAULT_ADB_PORT=5555
readonly SDK_ADB="$HOME/Library/Android/sdk/platform-tools/adb"

ADB="$(command -v adb || true)"
[[ -z "$ADB" && -x "$SDK_ADB" ]] && ADB="$SDK_ADB"
[[ -n "$ADB" ]] || { echo "adb не найден" >&2; exit 1; }

# connect_tv <ip[:port]>: sets $target, exits if the device is not reachable or not authorized
connect_tv() {
  target="$1"
  # ip, ip:port, or the mDNS name adb discovered after wireless pairing
  [[ "$target" == *:* || "$target" == *._tcp ]] || target="$target:$DEFAULT_ADB_PORT"
  "$ADB" connect "$target" >/dev/null 2>&1 || true
  local state
  state="$("$ADB" -s "$target" get-state 2>&1 || true)"
  if [[ "$state" != "device" ]]; then
    echo "Нет доступа к $target: $state" >&2
    echo "Проверьте отладку на ТВ (для беспроводной нужно сопряжение по коду) и повторите." >&2
    exit 1
  fi
}

# stdin is closed so adb cannot swallow the input of a surrounding `while read` loop
tv() { "$ADB" -s "$target" shell "$@" < /dev/null | tr -d '\r'; }

model_slug() { tv getprop ro.product.model | tr ' ' '_'; }

count_lines() { if [[ -f "$1" ]]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
