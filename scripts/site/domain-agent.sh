#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Агент домена сайта клуба. Запуск: cron раз в 5 минут и после deploy.sh.
#
# Домен задаёт владелец в HUB («Сайт → Домен» → app_settings.site_domain и
# site_domain_primary в БД основного клуба). Агент:
#   1) проверяет, что домен и www.<домен> указывают на этот сервер (DNS);
#   2) выпускает сертификат Let's Encrypt (certbot webroot nginx/acme) или берёт
#      продлённый certbot.timer'ом и кладёт его в nginx/ssl/site-*.pem;
#   3) пишет nginx/sites/club-site.conf (основной адрес + перенаправления),
#      проверяет конфиг и перезагружает nginx — только если что-то изменилось;
#   4) пишет статус в app_settings.site_domain_status — его видит владелец в HUB.
# Без домена в настройках убирает конфиг сайта.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="${TITAN_ROOT:-/opt/titan-hub}"
cd "$ROOT" || exit 1
DB_NAME="${SITE_DB:-titan_hub}"
PG_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
PG_USER="${PG_USER:-titan}"
CONF_DIR="$ROOT/nginx/sites"
CONF="$CONF_DIR/club-site.conf"
SSL_DIR="$ROOT/nginx/ssl"
WEBROOT="$ROOT/nginx/acme"
# Сайт клуба ходит в API клуба с этим Host (по нему API выбирает БД клуба).
CLUB_HOST="${SITE_CLUB_HOST:-kbr.titanpos.ru}"
DNS_SERVER="77.88.8.8"

exec 9>/tmp/site-domain-agent.lock
flock -n 9 || exit 0

log() { echo "[$(date -u +%FT%TZ)] $*"; }
psql_q() { docker compose exec -T postgres psql -U "$PG_USER" -d "$DB_NAME" -Atq -c "$1"; }
setting() { psql_q "SELECT value FROM app_settings WHERE key = '$1'" | tr -d '[:space:]'; }

write_status() { # $1 cert: active|pending|error  $2 expiresAt|''  $3 error|''
  local json
  json="$(DOMAIN="$DOMAIN" CERT="$1" EXP="$2" ERR="$3" python3 -c '
import json, os, datetime
print(json.dumps({
  "domain": os.environ["DOMAIN"], "cert": os.environ["CERT"],
  "expiresAt": os.environ["EXP"] or None, "error": os.environ["ERR"] or None,
  "checkedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, ensure_ascii=False))')"
  psql_q "INSERT INTO app_settings (key, value) VALUES ('site_domain_status', \$st\$${json}\$st\$)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" >/dev/null
}

reload_nginx() {
  if docker compose exec -T nginx nginx -t >/dev/null 2>&1; then
    docker compose exec -T nginx nginx -s reload >/dev/null 2>&1 && return 0
  fi
  return 1
}

# Новый конфиг → nginx. При ошибке проверки возвращаем прежний конфиг.
apply_conf() { # $1 — путь к новому конфигу
  mkdir -p "$CONF_DIR"
  if [ -f "$CONF" ] && cmp -s "$1" "$CONF"; then rm -f "$1"; return 0; fi
  local backup=""
  if [ -f "$CONF" ]; then backup="$(mktemp)"; cp "$CONF" "$backup"; fi
  mv "$1" "$CONF"
  chmod 644 "$CONF"
  if reload_nginx; then
    log "nginx: конфиг сайта обновлён"
    rm -f "$backup"
    return 0
  fi
  log "nginx отверг конфиг сайта — возвращаю прежний"
  if [ -n "$backup" ]; then mv "$backup" "$CONF"; else rm -f "$CONF"; fi
  reload_nginx || true
  return 1
}

proxy_block() {
  cat <<NGINX
    resolver 127.0.0.11 valid=10s ipv6=off;
    set \$site_upstream site:3000;
    client_max_body_size 1m;

    # Витрина и заявки сайта — API клуба (Host выбирает БД клуба).
    location /api/site/ {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://api:3001;
      proxy_set_header Host ${CLUB_HOST};
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
    # Остальной API клуба с домена сайта не открываем.
    location /api/ { return 404; }

    location ^~ /_next/static/ {
      proxy_pass http://\$site_upstream;
      proxy_set_header Host \$host;
      expires 365d;
      add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location ^~ /media/ {
      proxy_pass http://\$site_upstream;
      proxy_set_header Host \$host;
      expires 30d;
      add_header Cache-Control "public, max-age=2592000";
    }
    location / {
      proxy_pass http://\$site_upstream;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
NGINX
}

# Пока сертификата нет: сайт по http и ответ на проверку Let's Encrypt.
conf_http() {
  cat <<NGINX
# Сгенерировано scripts/site/domain-agent.sh — не править руками.
server {
    listen 80;
    server_name ${DOMAIN} ${WWW};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
$(proxy_block)
}
NGINX
}

conf_https() {
  cat <<NGINX
# Сгенерировано scripts/site/domain-agent.sh — не править руками.
server {
    listen 80;
    server_name ${DOMAIN} ${WWW};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://${MAIN}\$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name ${ALT};
    ssl_certificate /etc/nginx/ssl/site-fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/site-privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    return 301 https://${MAIN}\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${MAIN};
    ssl_certificate /etc/nginx/ssl/site-fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/site-privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
$(proxy_block)
}
NGINX
}

DOMAIN="$(setting site_domain)"
if [ -z "$DOMAIN" ]; then
  if [ -f "$CONF" ]; then
    rm -f "$CONF"
    reload_nginx && log "домен снят — конфиг сайта убран"
  fi
  exit 0
fi
if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  write_status error "" "Домен указан неверно"
  exit 0
fi
WWW="www.${DOMAIN}"
if [ "$(setting site_domain_primary)" = "apex" ]; then MAIN="$DOMAIN"; ALT="$WWW"; else MAIN="$WWW"; ALT="$DOMAIN"; fi
SERVER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}')"
LIVE="/etc/letsencrypt/live/${DOMAIN}"

dns_ok() { # все A-записи имени указывают на этот сервер
  local ips
  ips="$(dig +short +time=3 +tries=1 @"$DNS_SERVER" "$1" A | grep -E '^[0-9.]+$' || true)"
  [ -n "$ips" ] && ! grep -qv "^${SERVER_IP}\$" <<<"$ips"
}
cert_ok() { # сертификат действует и покрывает оба имени
  [ -f "$LIVE/fullchain.pem" ] || return 1
  openssl x509 -in "$LIVE/fullchain.pem" -noout -checkend 0 >/dev/null 2>&1 || return 1
  local san
  san="$(openssl x509 -in "$LIVE/fullchain.pem" -noout -ext subjectAltName 2>/dev/null)"
  grep -q "DNS:${DOMAIN}\b" <<<"$san" && grep -q "DNS:${WWW}\b" <<<"$san"
}

if ! cert_ok; then
  NEW="$(mktemp)"; conf_http >"$NEW"; apply_conf "$NEW" || true
  if ! dns_ok "$DOMAIN" || ! dns_ok "$WWW"; then
    write_status pending "" "DNS ещё не указывает на сервер ${SERVER_IP}: нужны A-записи @ и www"
    exit 0
  fi
  log "выпускаю сертификат для ${DOMAIN} и ${WWW}"
  if ! certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" -d "$WWW" --cert-name "$DOMAIN" \
      --non-interactive --agree-tos --keep-until-expiring --expand >/tmp/site-domain-certbot.log 2>&1; then
    log "certbot: $(tail -3 /tmp/site-domain-certbot.log | tr '\n' ' ')"
    write_status error "" "Let's Encrypt не выдал сертификат — проверьте DNS и повторите через несколько минут"
    exit 0
  fi
fi

# Свежий (в т.ч. продлённый certbot.timer) сертификат → nginx/ssl.
CERT_CHANGED=0
for f in fullchain privkey; do
  if ! cmp -s "$LIVE/${f}.pem" "$SSL_DIR/site-${f}.pem"; then
    cp -L "$LIVE/${f}.pem" "$SSL_DIR/site-${f}.pem"
    CERT_CHANGED=1
  fi
done
chmod 600 "$SSL_DIR/site-privkey.pem"

NEW="$(mktemp)"; conf_https >"$NEW"
if [ -f "$CONF" ] && cmp -s "$NEW" "$CONF"; then
  rm -f "$NEW"
  if [ "$CERT_CHANGED" = 1 ]; then reload_nginx && log "nginx: подхвачен обновлённый сертификат"; fi
elif ! apply_conf "$NEW"; then
  write_status error "" "nginx не принял конфиг сайта"
  exit 0
fi

EXPIRES="$(date -u -d "$(openssl x509 -in "$LIVE/fullchain.pem" -noout -enddate | cut -d= -f2)" +%Y-%m-%dT%H:%M:%SZ)"
write_status active "$EXPIRES" ""
