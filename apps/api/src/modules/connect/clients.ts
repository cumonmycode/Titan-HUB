import { sql, type Database } from '@titan/database'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'
import { rows } from './repo.js'
import { hasScope } from './scopes.js'

/**
 * Клиенты клуба для Titan Connect: выборка с курсором по времени изменения и
 * сборка ответа строго по правам подключения (чего нет в scopes — того нет в JSON).
 */

export const MAX_PAGE = 200
export const DEFAULT_PAGE = 50

const GM_TAG_RE = /^gomafia:(\d+)$/

export interface ConnectClient {
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

type ClientRow = {
  id: string
  nickname: string
  full_name: string | null
  role: string
  client_tier: string
  tier_label: string | null
  tier_color: string | null
  is_resident: boolean
  phone: string | null
  birthday: string | null
  tg_id: string | null
  tg_username: string | null
  photo_url: string | null
  tg_photo_url: string | null
  gomafia_photo_url: string | null
  balance: string | null
  bonus_points: string | null
  search_tags: string[] | null
  manual_visits: number | null
  created_at: string
  deleted_at: string | null
  updated_at: string
}

// ── Курсор: «время изменения|id» последней отданной записи ──

export type Cursor = { updatedAt: string; id: string }

export const encodeCursor = (c: Cursor): string => Buffer.from(`${c.updatedAt}|${c.id}`).toString('base64url')

export function decodeCursor(raw: string): Cursor | null {
  const [updatedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  if (!updatedAt || !id || Number.isNaN(Date.parse(updatedAt)) || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { updatedAt, id }
}

const SELECT = sql`
  SELECT p.id, p.nickname, p.full_name, p.role, p.client_tier, t.label AS tier_label, t.color AS tier_color,
    p.is_resident, p.phone, p.birthday, p.tg_id, p.tg_username, p.photo_url, p.tg_photo_url, p.gomafia_photo_url,
    p.balance, p.bonus_points, p.search_tags, p.manual_visits, p.created_at, p.deleted_at,
    to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
  FROM profiles p
  LEFT JOIN client_tiers t ON t.key = p.client_tier
`
// Клиенты = клиенты + персонал (у них тот же профиль с депозитом/бонусами); без планшетов
// и без анкет, которые персонал отклонил.
const BASE_WHERE = sql`p.role IN ('client', 'staff', 'owner') AND (p.registration_status IS NULL OR p.registration_status <> 'rejected')`

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`)

export interface ListQuery {
  search?: string
  phone?: string
  cursor?: Cursor | null
  updatedSince?: string | null
  includeDeleted: boolean
  limit: number
}

export async function listClientRows(db: Database, q: ListQuery): Promise<{ items: ClientRow[]; next: Cursor | null }> {
  const conds = [BASE_WHERE]
  if (!q.includeDeleted) conds.push(sql`p.deleted_at IS NULL`)
  if (q.cursor) conds.push(sql`(p.updated_at, p.id) > (${q.cursor.updatedAt}::timestamptz, ${q.cursor.id}::uuid)`)
  else if (q.updatedSince) conds.push(sql`p.updated_at > ${q.updatedSince}::timestamptz`)
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`
    conds.push(sql`(p.nickname ILIKE ${like} OR p.full_name ILIKE ${like})`)
  }
  if (q.phone) {
    // Сравниваем последние 10 цифр: «+7 (900) 123-45-67» = «89001234567».
    conds.push(sql`right(regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g'), 10) = ${q.phone.slice(-10)}`)
  }
  const res = await db.execute(sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY p.updated_at, p.id LIMIT ${q.limit + 1}`)
  const all = rows<ClientRow>(res)
  const items = all.slice(0, q.limit)
  const last = items[items.length - 1]
  return { items, next: all.length > q.limit && last ? { updatedAt: last.updated_at, id: last.id } : null }
}

export async function getClientRow(db: Database, id: string): Promise<ClientRow | null> {
  const res = await db.execute(sql`${SELECT} WHERE ${BASE_WHERE} AND p.id = ${id}::uuid`)
  return rows<ClientRow>(res)[0] ?? null
}

/** Посещения пачкой: различные бизнес-дни с закрытым чеком + ручные (как lib/loyalty.countVisits). */
async function visitCounts(db: Database, list: ClientRow[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!list.length) return counts
  const hour = await getBusinessDayStartHour(db)
  const ids = sql.join(list.map((r) => sql`${r.id}::uuid`), sql`, `)
  const res = await db.execute(sql`
    SELECT player_id, count(DISTINCT date_trunc('day', (created_at AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(hour))} hours'))::int AS n
    FROM checks WHERE status = 'closed' AND player_id IN (${ids})
    GROUP BY player_id
  `)
  for (const r of rows<{ player_id: string; n: number }>(res)) counts.set(r.player_id, Number(r.n))
  return counts
}

/** Ссылка на фото: относительные /media/… — от адреса клуба, внешние — как есть. */
function absoluteUrl(url: string | null, origin: string): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  return url.startsWith('/') ? `${origin}${url}` : `${origin}/${url}`
}

const toNumber = (value: string | null): number => Math.round(Number(value ?? 0) * 100) / 100

export async function serializeClients(db: Database, list: ClientRow[], scopes: readonly string[], origin: string): Promise<ConnectClient[]> {
  const visits = hasScope(scopes, 'clients:visits') ? await visitCounts(db, list) : null
  return list.map((r) => {
    const gmTag = (r.search_tags ?? []).map((t) => GM_TAG_RE.exec(t)?.[1]).find(Boolean) ?? null
    const client: ConnectClient = {
      id: r.id,
      nickname: r.nickname,
      fullName: r.full_name,
      status: { key: r.client_tier, label: r.tier_label ?? r.client_tier, color: r.tier_color },
      isResident: r.is_resident || r.client_tier === 'resident',
      isStaff: r.role !== 'client',
      gomafiaId: gmTag,
      registeredAt: new Date(r.created_at).toISOString(),
      updatedAt: r.updated_at,
      deleted: r.deleted_at != null,
    }
    if (hasScope(scopes, 'clients:photos')) {
      client.photoUrl = absoluteUrl(r.photo_url || r.tg_photo_url || r.gomafia_photo_url || null, origin)
    }
    if (hasScope(scopes, 'clients:contacts')) {
      client.contacts = { phone: r.phone, birthday: r.birthday, telegram: { id: r.tg_id, username: r.tg_username } }
    }
    if (hasScope(scopes, 'clients:balance')) {
      client.balance = { deposit: toNumber(r.balance), bonusPoints: toNumber(r.bonus_points) }
    }
    if (visits) {
      client.visits = { count: Math.max(0, (visits.get(r.id) ?? 0) + (r.manual_visits ?? 0)) }
    }
    return client
  })
}
