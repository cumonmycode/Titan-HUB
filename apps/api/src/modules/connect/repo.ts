import { sql, type Database } from '@titan/database'
import { CODE_TTL_SEC, generateCode, generateToken, sha256 } from './codes.js'
import { normalizeScopes } from './scopes.js'

/**
 * Хранилище подключений Titan Connect (таблица connect_connections, миграция 092).
 * Наружу — ConnectConnection без хэшей кода и ключа.
 */

export type ConnectStatus = 'pending' | 'active'

export interface ConnectConnection {
  id: string
  name: string
  scopes: string[]
  status: ConnectStatus
  serviceName: string | null
  serviceUrl: string | null
  tokenPrefix: string | null
  codeExpiresAt: string | null
  createdAt: string
  connectedAt: string | null
  lastUsedAt: string | null
  lastIp: string | null
  requestCount: number
}

type Row = Record<string, unknown>

export function rows<T = Row>(res: unknown): T[] {
  const r = res as { rows?: T[] } | T[]
  return (Array.isArray(r) ? r : r.rows) ?? []
}

const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string).toISOString())

function toConnection(row: Row): ConnectConnection {
  const codeExpiresAt = iso(row.code_expires_at)
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: (row.scopes as string[] | null) ?? [],
    status: row.status === 'active' ? 'active' : 'pending',
    serviceName: (row.service_name as string | null) ?? null,
    serviceUrl: (row.service_url as string | null) ?? null,
    tokenPrefix: (row.token_prefix as string | null) ?? null,
    // Истёкший код не показываем — его уже нельзя ввести.
    codeExpiresAt: codeExpiresAt && new Date(codeExpiresAt).getTime() > Date.now() ? codeExpiresAt : null,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    connectedAt: iso(row.connected_at),
    lastUsedAt: iso(row.last_used_at),
    lastIp: (row.last_ip as string | null) ?? null,
    requestCount: Number(row.request_count ?? 0),
  }
}

const scopesArray = (scopes: readonly string[]) => sql`ARRAY[${sql.join(scopes.map((s) => sql`${s}`), sql`, `)}]::text[]`

export async function listConnections(db: Database): Promise<ConnectConnection[]> {
  const res = await db.execute(sql`SELECT * FROM connect_connections ORDER BY created_at DESC`)
  return rows(res).map(toConnection)
}

export async function getConnection(db: Database, id: string): Promise<ConnectConnection | null> {
  const res = await db.execute(sql`SELECT * FROM connect_connections WHERE id = ${id}::uuid`)
  const row = rows(res)[0]
  return row ? toConnection(row) : null
}

export type IssuedCode = { code: string; codeHash: string; display: string; expiresAt: string }

function newCode(): IssuedCode {
  const { code, display } = generateCode()
  return { code, codeHash: sha256(code), display, expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString() }
}

export async function createConnection(
  db: Database,
  input: { name: string; scopes: readonly string[]; createdBy: string | null },
): Promise<{ connection: ConnectConnection; code: IssuedCode }> {
  const code = newCode()
  const res = await db.execute(sql`
    INSERT INTO connect_connections (name, scopes, code_hash, code_expires_at, created_by)
    VALUES (${input.name}, ${scopesArray(normalizeScopes(input.scopes))}, ${code.codeHash}, ${code.expiresAt}::timestamptz, ${input.createdBy}::uuid)
    RETURNING *
  `)
  return { connection: toConnection(rows(res)[0]!), code }
}

/** Новый одноразовый код для подключения (первое подключение или переподключение сервиса). */
export async function issueCode(db: Database, id: string): Promise<IssuedCode | null> {
  const code = newCode()
  const res = await db.execute(sql`
    UPDATE connect_connections SET code_hash = ${code.codeHash}, code_expires_at = ${code.expiresAt}::timestamptz
    WHERE id = ${id}::uuid RETURNING id
  `)
  return rows(res).length ? code : null
}

export async function cancelCode(db: Database, id: string): Promise<void> {
  await db.execute(sql`UPDATE connect_connections SET code_hash = NULL, code_expires_at = NULL WHERE id = ${id}::uuid`)
}

export async function updateConnection(db: Database, id: string, patch: { name?: string; scopes?: readonly string[] }): Promise<ConnectConnection | null> {
  const sets = []
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`)
  if (patch.scopes !== undefined) sets.push(sql`scopes = ${scopesArray(normalizeScopes(patch.scopes))}`)
  if (!sets.length) return getConnection(db, id)
  const res = await db.execute(sql`UPDATE connect_connections SET ${sql.join(sets, sql`, `)} WHERE id = ${id}::uuid RETURNING *`)
  const row = rows(res)[0]
  return row ? toConnection(row) : null
}

/** Отключить сервис: строка удаляется, его ключ сразу перестаёт работать. */
export async function deleteConnection(db: Database, id: string): Promise<boolean> {
  const res = await db.execute(sql`DELETE FROM connect_connections WHERE id = ${id}::uuid RETURNING id`)
  return rows(res).length > 0
}

/**
 * Обменять код на постоянный ключ — одним UPDATE, поэтому код одноразовый даже при
 * одновременных запросах. Прежний ключ (если сервис переподключается) перестаёт работать.
 */
export async function consumeCode(
  db: Database,
  codeHash: string,
  service: { name: string | null; url: string | null },
): Promise<{ connection: ConnectConnection; token: string } | null> {
  const { token, hash, prefix } = generateToken()
  const res = await db.execute(sql`
    UPDATE connect_connections SET
      code_hash = NULL, code_expires_at = NULL,
      token_hash = ${hash}, token_prefix = ${prefix}, token_issued_at = now(),
      status = 'active', connected_at = now(),
      service_name = COALESCE(${service.name}, service_name),
      service_url = COALESCE(${service.url}, service_url)
    WHERE code_hash = ${codeHash} AND code_expires_at > now()
    RETURNING *
  `)
  const row = rows(res)[0]
  return row ? { connection: toConnection(row), token } : null
}

export async function findByToken(db: Database, tokenHash: string): Promise<ConnectConnection | null> {
  const res = await db.execute(sql`SELECT * FROM connect_connections WHERE token_hash = ${tokenHash} AND status = 'active'`)
  const row = rows(res)[0]
  return row ? toConnection(row) : null
}

export async function touchUsage(db: Database, id: string, ip: string): Promise<void> {
  await db.execute(sql`
    UPDATE connect_connections SET last_used_at = now(), last_ip = ${ip}, request_count = request_count + 1
    WHERE id = ${id}::uuid
  `)
}

/** Сервис сам меняет ключ (например, после утечки): старый перестаёт работать сразу. */
export async function rotateToken(db: Database, id: string): Promise<string> {
  const { token, hash, prefix } = generateToken()
  await db.execute(sql`
    UPDATE connect_connections SET token_hash = ${hash}, token_prefix = ${prefix}, token_issued_at = now()
    WHERE id = ${id}::uuid
  `)
  return token
}
