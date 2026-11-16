/**
 * Примеры клиентов Titan Connect для вики. Тексты — исполняемый код: перед публикацией
 * прогоняются против локального API (обмен кода, поиск, синхронизация).
 */

export const TS_CLIENT = `
// titan-connect.ts — Node.js 18+ (встроенный fetch), без зависимостей.
const EXCHANGE_URL = 'https://titanpos.ru/api/connect/v1/exchange'

export type TitanConnection = { apiBase: string; accessToken: string; connectionId: string; scopes: string[] }

export type TitanClient = {
  id: string
  nickname: string
  fullName: string | null
  status: { key: string; label: string; color: string | null }
  isResident: boolean
  isStaff: boolean
  gomafiaId: string | null
  registeredAt: string
  updatedAt: string
  deleted: boolean
  photoUrl?: string | null
  contacts?: { phone: string | null; birthday: string | null; telegram: { id: string | null; username: string | null } }
  balance?: { deposit: number; bonusPoints: number }
  visits?: { count: number }
}

type Page = { items: TitanClient[]; nextCursor: string | null; syncCursor: string | null }

export class TitanError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function call<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  const body = await res.json().catch(() => null)
  if (res.ok) return body as T
  // Повторяем только чтение при перегрузке и сбоях сервера — с растущей паузой.
  const retriable = res.status === 429 || res.status >= 500
  if (retriable && attempt < 5 && (init.method ?? 'GET') === 'GET') {
    const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt
    await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000))
    return call<T>(url, init, attempt + 1)
  }
  const err = body?.error
  const code = typeof err === 'object' && err ? err.code : String(err ?? 'error')
  throw new TitanError(res.status, code, err?.message ?? res.statusText)
}

/** Код из Titan HUB → подключение. Сохраните результат у себя (ключ — зашифрованным). */
export async function connect(code: string, serviceName: string): Promise<TitanConnection> {
  const r = await call<TitanConnection>(EXCHANGE_URL, {
    method: 'POST',
    body: JSON.stringify({ code, service: { name: serviceName } }),
  })
  return { apiBase: r.apiBase, accessToken: r.accessToken, connectionId: r.connectionId, scopes: r.scopes }
}

export function titan(conn: TitanConnection) {
  const auth = { Authorization: \`Bearer \${conn.accessToken}\` }
  const get = <T>(path: string) => call<T>(\`\${conn.apiBase}\${path}\`, { headers: auth })
  return {
    me: () => get<{ connectionId: string; name: string; scopes: string[] }>('/me'),
    search: (text: string) => get<Page>(\`/clients?search=\${encodeURIComponent(text)}\`).then((p) => p.items),
    client: (id: string) => get<TitanClient>(\`/clients/\${id}\`),

    /** Синхронизация: передайте сохранённый курсор (или null), сохраните возвращённый. */
    async sync(cursor: string | null, onClient: (c: TitanClient) => Promise<void>): Promise<string | null> {
      let next = cursor
      for (;;) {
        const page = await get<Page>(\`/clients?limit=200\${next ? \`&cursor=\${encodeURIComponent(next)}\` : ''}\`)
        for (const c of page.items) await onClient(c)
        next = page.syncCursor ?? next
        if (!page.nextCursor) return next
      }
    },
  }
}
`

export const TS_USAGE = `
import { connect, titan, TitanError } from './titan-connect'

// 1. Пользователь ввёл код в вашем интерфейсе
const conn = await connect('K7QM-3XPA', 'Рейтинг игроков')
await db.titanConnections.insert({ ...conn, syncCursor: null })

// 2. Фоновая задача раз в 5 минут
for (const row of await db.titanConnections.all()) {
  try {
    const cursor = await titan(row).sync(row.syncCursor, async (client) => {
      if (client.deleted) await db.players.delete(client.id)
      else await db.players.upsert(client.id, { nick: client.nickname, photo: client.photoUrl ?? null })
    })
    await db.titanConnections.update(row.id, { syncCursor: cursor })
  } catch (e) {
    if (e instanceof TitanError && e.code === 'invalid_token') {
      await db.titanConnections.markDisconnected(row.id) // клуб отключил сервис — нужен новый код
    } else throw e
  }
}
`

export const PY_CLIENT = `
# titan_connect.py — Python 3.9+, pip install requests
import time
import requests

EXCHANGE_URL = "https://titanpos.ru/api/connect/v1/exchange"


class TitanError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def _check(res):
    if res.ok:
        return res.json()
    try:
        err = res.json().get("error")
    except ValueError:
        err = None
    code = err.get("code") if isinstance(err, dict) else str(err or "error")
    message = err.get("message") if isinstance(err, dict) else res.reason
    raise TitanError(res.status_code, code, message)


def connect(code, service_name):
    """Код из Titan HUB -> {'apiBase', 'accessToken', 'connectionId', 'scopes', ...}."""
    res = requests.post(EXCHANGE_URL, json={"code": code, "service": {"name": service_name}}, timeout=15)
    return _check(res)


class Titan:
    def __init__(self, api_base, access_token):
        self.base = api_base
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {access_token}"

    def _get(self, path, **params):
        for attempt in range(5):
            res = self.session.get(self.base + path, params=params, timeout=30)
            if res.status_code != 429 and res.status_code < 500:
                break
            time.sleep(min(int(res.headers.get("Retry-After", 2 ** attempt)), 60))
        return _check(res)

    def me(self):
        return self._get("/me")

    def search(self, text):
        return self._get("/clients", search=text)["items"]

    def client(self, client_id):
        return self._get(f"/clients/{client_id}")

    def sync(self, cursor, on_client):
        """Отдаёт on_client каждого изменённого клиента и возвращает новый курсор."""
        while True:
            params = {"limit": 200, **({"cursor": cursor} if cursor else {})}
            page = self._get("/clients", **params)
            for client in page["items"]:
                on_client(client)
            cursor = page["syncCursor"] or cursor
            if not page["nextCursor"]:
                return cursor
`

export const PY_USAGE = `
from titan_connect import Titan, TitanError, connect

# 1. Пользователь ввёл код в вашем интерфейсе
conn = connect("K7QM-3XPA", "Рейтинг игроков")
save_connection(conn["apiBase"], conn["accessToken"], conn["connectionId"])

# 2. Фоновая задача
def on_client(client):
    if client["deleted"]:
        delete_player(client["id"])
    else:
        upsert_player(client["id"], client["nickname"], client.get("photoUrl"))

try:
    cursor = Titan(conn["apiBase"], conn["accessToken"]).sync(load_cursor(), on_client)
    save_cursor(cursor)
except TitanError as e:
    if e.code == "invalid_token":
        mark_disconnected()  # клуб отключил сервис — нужен новый код
    else:
        raise
`
