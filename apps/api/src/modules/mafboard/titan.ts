import { createHash } from 'node:crypto'
import type { TitanPlayerJSON } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Titan Connect для MafBoard: клуб Titan HUB подключается одноразовым кодом из HUB, сервер
// MafBoard хранит его ключ (шифротекстом) и отдаёт ведущему клиентов клуба как игроков.
// Клиента без GoMafia (или с другим ником в GoMafia) ведущий сопоставляет вручную — это
// общее для всех ведущих клуба (mb_titan_matches). Контракт Titan Connect — docs/TITAN_CONNECT.md.
// ─────────────────────────────────────────────────────────────────────────────

/** Ошибка Titan Connect: `code` — из ответа Titan (`invalid_code`, `invalid_token`…) или `unavailable`. */
export class TitanConnectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface TitanExchange {
  accessToken: string
  connectionId: string
  scopes: string[]
  apiBase: string
}

/** Клиент клуба из `GET /clients` — только поля, которые нужны MafBoard. */
export interface TitanClient {
  id: string
  nickname: string
  fullName: string | null
  status: { label: string } | null
  isResident: boolean
  gomafiaId: string | null
  deleted: boolean
  photoUrl?: string | null
}

export interface TitanConnectGateway {
  exchange(code: string): Promise<TitanExchange>
  /** Название клуба (`GET /me`). */
  clubName(apiBase: string, token: string): Promise<string | null>
  clients(apiBase: string, token: string, cursor: string | null): Promise<{ items: TitanClient[]; nextCursor: string | null }>
  /** Отключиться со стороны сервиса (`DELETE /connection`). */
  disconnect(apiBase: string, token: string): Promise<void>
}

const REQUEST_TIMEOUT_MS = 12_000
const PAGE_SIZE = 200
/** 2000 клиентов — больше, чем в любом клубе; дальше не листаем. */
const MAX_PAGES = 10
const ROSTER_TTL_MS = 5 * 60_000
const SERVICE = { name: 'MafBoard', url: 'https://mafboard.com' }
const UNAVAILABLE = 'Titan HUB не отвечает, попробуйте позже'

/** Адрес Titan Connect для обмена кода. Код с любого клуба принимает основной домен Titan. */
export function titanConnectUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env['MAFBOARD_TITAN_CONNECT_URL']?.trim() || 'https://titanpos.ru/api/connect/v1').replace(/\/+$/, '')
}

/**
 * `apiBase` из ответа обмена — адрес, на который сервер потом ходит с ключом. Принимаем только
 * https на домене Titan (или его поддомене клуба): иначе подменённый ответ увёл бы ключ и запросы
 * сервера на чужой адрес.
 */
export function trustedApiBase(apiBase: string, connectUrl: string): string | null {
  try {
    const url = new URL(apiBase)
    const root = new URL(connectUrl).hostname.toLowerCase()
    const host = url.hostname.toLowerCase()
    const local = root === 'localhost' || root === '127.0.0.1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    if (host !== root && !host.endsWith(`.${root}`)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

async function request(url: string, init: RequestInit & { token?: string }): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body) headers['content-type'] = 'application/json'
  if (init.token) headers['authorization'] = `Bearer ${init.token}`
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new TitanConnectError('unavailable', UNAVAILABLE)
  }
  const payload: unknown = await response.json().catch(() => null)
  if (response.ok) return payload
  const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : response.status >= 500 ? 'unavailable' : 'titan_error'
  const message = typeof error?.message === 'string' ? error.message : UNAVAILABLE
  throw new TitanConnectError(code, message)
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function toClient(raw: unknown): TitanClient | null {
  const r = raw as Record<string, unknown> | null
  const id = text(r?.['id'])
  if (!r || !id) return null
  const status = r['status'] as { label?: unknown } | null | undefined
  const label = text(status?.label)
  return {
    id,
    nickname: text(r['nickname']) ?? text(r['fullName']) ?? 'Без ника',
    fullName: text(r['fullName']),
    status: label ? { label } : null,
    isResident: r['isResident'] === true,
    gomafiaId: text(r['gomafiaId']) ?? (typeof r['gomafiaId'] === 'number' ? String(r['gomafiaId']) : null),
    deleted: r['deleted'] === true,
    photoUrl: text(r['photoUrl']),
  }
}

export function liveTitanConnect(connectUrl: string = titanConnectUrl()): TitanConnectGateway {
  return {
    async exchange(code) {
      const payload = (await request(`${connectUrl}/exchange`, {
        method: 'POST',
        body: JSON.stringify({ code, service: SERVICE }),
      })) as Record<string, unknown> | null
      const accessToken = text(payload?.['accessToken'])
      const apiBase = text(payload?.['apiBase'])
      if (!payload || !accessToken || !apiBase) throw new TitanConnectError('unavailable', 'Titan HUB вернул неожиданный ответ')
      const scopes = Array.isArray(payload['scopes']) ? payload['scopes'].filter((s): s is string => typeof s === 'string') : []
      return { accessToken, apiBase, scopes, connectionId: text(payload['connectionId']) ?? '' }
    },
    async clubName(apiBase, token) {
      const payload = (await request(`${apiBase}/me`, { method: 'GET', token })) as { club?: { name?: unknown } } | null
      return text(payload?.club?.name)
    },
    async clients(apiBase, token, cursor) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) query.set('cursor', cursor)
      const payload = (await request(`${apiBase}/clients?${query}`, { method: 'GET', token })) as {
        items?: unknown[]
        nextCursor?: unknown
      } | null
      const items = (payload?.items ?? []).map(toClient).filter((c): c is TitanClient => c != null)
      return { items, nextCursor: text(payload?.nextCursor) }
    },
    async disconnect(apiBase, token) {
      await request(`${apiBase}/connection`, { method: 'DELETE', token })
    },
  }
}

/**
 * Клиенты клуба целиком с кэшем на 5 минут (ключ — `apiBase`). Если Titan не ответил, отдаётся
 * последний состав; отозванный ключ (`invalid_token`) пробрасывается всегда — его надо показать.
 */
export class TitanRosterCache {
  private readonly entries = new Map<string, { at: number; clients: TitanClient[] }>()

  constructor(
    private readonly gateway: TitanConnectGateway,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = ROSTER_TTL_MS,
  ) {}

  async roster(apiBase: string, token: string): Promise<TitanClient[]> {
    const cached = this.entries.get(apiBase)
    if (cached && this.now() - cached.at < this.ttlMs) return cached.clients
    try {
      const clients = await this.fetchAll(apiBase, token)
      this.entries.set(apiBase, { at: this.now(), clients })
      return clients
    } catch (error) {
      if (cached && !(error instanceof TitanConnectError && error.code === 'invalid_token')) return cached.clients
      throw error
    }
  }

  /** Последний прочитанный состав клуба без запроса в Titan, сколько бы ему ни было лет; null — ещё не читали. */
  peek(apiBase: string): TitanClient[] | null {
    return this.entries.get(apiBase)?.clients ?? null
  }

  forget(apiBase: string): void {
    this.entries.delete(apiBase)
  }

  private async fetchAll(apiBase: string, token: string): Promise<TitanClient[]> {
    const clients: TitanClient[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch: { items: TitanClient[]; nextCursor: string | null } = await this.gateway.clients(apiBase, token, cursor)
      clients.push(...batch.items.filter((c) => !c.deleted))
      cursor = batch.nextCursor
      if (!cursor) break
    }
    return clients
  }
}

// ─── Идентификаторы игроков ──────────────────────────────────────────────────

const GOMAFIA_PREFIX = '6d616662-676d-8000-8000-'
/** «mafbtc» + версия/вариант UUIDv8, как у PlayerID.goMafia в приложении. */
const TITAN_PREFIX = '6d616662-7463-8000-8000-'
const GOMAFIA_ID_SPACE = 2 ** 48

/** PlayerID.goMafia приложения: префикс «mafbgm» и номер игрока в 6 байтах. */
export function goMafiaPlayerID(goMafiaId: number): string {
  return GOMAFIA_PREFIX + (goMafiaId % GOMAFIA_ID_SPACE).toString(16).padStart(12, '0')
}

/** Постоянный PlayerID клиента клуба без GoMafia: одинаковый на всех устройствах ведущих клуба. */
export function titanPlayerID(apiBase: string, clientId: string): string {
  return TITAN_PREFIX + createHash('sha256').update(`${apiBase}|${clientId}`).digest('hex').slice(0, 12)
}

export const TITAN_PLAYER_ID = /^6d616662-7463-8000-8000-[0-9a-f]{12}$/i

export function goMafiaNumber(raw: string | null): number | null {
  return raw != null && /^\d{1,12}$/.test(raw) ? Number(raw) : null
}

/**
 * Клиент → игрок приложения. Ручное сопоставление важнее номера из HUB: в POS бывает чужой или
 * устаревший номер, а ник в GoMafia часто другой.
 */
export function toTitanPlayerJSON(apiBase: string, client: TitanClient, matches: Map<string, number | null>): TitanPlayerJSON {
  const manual = matches.has(client.id)
  const goMafiaID = manual ? (matches.get(client.id) ?? null) : goMafiaNumber(client.gomafiaId)
  return {
    id: client.id,
    playerID: goMafiaID != null ? goMafiaPlayerID(goMafiaID) : titanPlayerID(apiBase, client.id),
    nickname: client.nickname,
    fullName: client.fullName,
    avatarURL: client.photoUrl ?? null,
    statusLabel: client.status?.label ?? null,
    isResident: client.isResident,
    goMafiaID,
    goMafiaSource: goMafiaID == null ? null : manual ? 'manual' : 'hub',
  }
}
