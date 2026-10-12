#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Сертификат Let's Encrypt для titanmafia.ru + www (HTTP-01, webroot).
# Запускать на сервере из /opt/titan-hub ПОСЛЕ того, как A-записи домена
# указывают на этот сервер. До этого nginx работает на временном
# самоподписанном сертификате (nginx/ssl/titanmafia-*.pem).
# Продление — тем же certbot.timer; deploy-hook копирует файлы и
# перезапускает nginx.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd /opt/titan-hub

DOMAINS=(-d titanmafia.ru -d www.titanmafia.ru)
WEBROOT=/opt/titan-hub/nginx/acme
HOOK=/etc/letsencrypt/renewal-hooks/deploy/titanmafia.sh

mkdir -p "$WEBROOT" /etc/letsencrypt/renewal-hooks/deploy
cat > "$HOOK" <<'HOOK'
#!/bin/sh
# Только для сертификата titanmafia.ru (у certbot общий каталог хуков).
case "$RENEWED_LINEAGE" in *titanmafia.ru*) ;; *) exit 0 ;; esac
cp "$RENEWED_LINEAGE/fullchain.pem" /opt/titan-hub/nginx/ssl/titanmafia-fullchain.pem
cp "$RENEWED_LINEAGE/privkey.pem" /opt/titan-hub/nginx/ssl/titanmafia-privkey.pem
docker compose -f /opt/titan-hub/docker-compose.yml restart nginx
HOOK
chmod +x "$HOOK"

certbot certonly --webroot -w "$WEBROOT" "${DOMAINS[@]}" --cert-name titanmafia.ru \
  --non-interactive --agree-tos --keep-until-expiring --register-unsafely-without-email

RENEWED_LINEAGE=/etc/letsencrypt/live/titanmafia.ru "$HOOK"
echo "✅ Сертификат titanmafia.ru установлен, nginx перезапущен"
