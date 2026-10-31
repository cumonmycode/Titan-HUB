// ─────────────────────────────────────────────────────────────────────────────
// Классические кривые TLS для всех исходящих соединений процесса (fetch, Redis…).
// Node 22 с OpenSSL 3.5 по умолчанию предлагает постквантовый ключ X25519MLKEM768:
// ClientHello раздувается до ~1,8 КБ, и с сервера в РФ рукопожатие с Cloudflare
// глохнет — «fetch failed» (UND_ERR_CONNECT_TIMEOUT). Падали Worker tg.titanpos.ru
// и с ним Telegram, Instagram и выкладка СММ. Без MLKEM рукопожатие проходит.
// Импортируется первым в index.ts — раньше любых соединений.
// ─────────────────────────────────────────────────────────────────────────────
import tls from 'node:tls'

export const CLASSIC_ECDH_CURVES = 'X25519:P-256:P-384'

tls.DEFAULT_ECDH_CURVE = CLASSIC_ECDH_CURVES
