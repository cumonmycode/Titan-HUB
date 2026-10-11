import { createMiddleware } from 'hono/factory'
import { createHash } from 'crypto'
import { verifyToken } from '@titan/auth'
import type { JwtPayload } from '@titan/auth'
import { profiles, eq } from '@titan/database'
import type { Database } from '@titan/database'
import type { ClubContext } from '../types.js'
import { getSharedRedis } from '../lib/redis.js'
import { permissionOn, PERMISSION_LABELS } from '../lib/permissions.js'

// requireAuth читает не только user, но и club/db (их кладёт tenantContext ПЕРЕД
// этим middleware) — чтобы сверить привязку токена/тикета к клубу поддомена и
// актуальность профиля в БД клуба. permissions — права сотрудника из БД
// (undefined — профиль не удалось проверить → requirePermission пропускает).
type Variables = {
  user: JwtPayload
  club: ClubContext | null
  db: Database
  permissions: Record<string, boolean> | undefined
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Актуальность профиля за JWT ──────────────────────────────────────────────
// JWT живёт до 7–30 дней и несёт роль. Уволенный (deletedAt) не должен входить с
// ещё живым токеном, а смена роли владельцем — ждать перелогина. Сверяем профиль
// с БД клуба не чаще раза в 30 с (кэш в общем Redis, ключ с префиксом клуба).
const PROFILE_STATE_TTL_SEC = 30
// Роли персонала: им роль берём из БД (повышение/понижение действует сразу).
// У tablet-staff sub — профиль планшета, его роль в БД другая — не трогаем.
const STAFF_ROLES = new Set(['owner', 'staff'])
// permissions — права сотрудника (profiles.permissions); в старых записях кэша
// поля нет → умолчания (запись живёт ≤ 30 с).
type ProfileState = { deleted: boolean; role: string | null; permissions?: Record<string, boolean> | null }

const profileStateKey = (clubId: string | null, sub: string): string => `${clubId ?? 'main'}:auth:profile:${sub}`

async function loadProfileState(db: Database, clubId: string | null, sub: string): Promise<ProfileState | null> {
  const key = profileStateKey(clubId, sub)
  try {
    const cached = await getSharedRedis().get(key)
    if (cached) return JSON.parse(cached) as ProfileState
  } catch { /* Redis недоступен — идём в БД */ }
  try {
    const [row] = await db.select({ role: profiles.role, deletedAt: profiles.deletedAt, permissions: profiles.permissions })
      .from(profiles).where(eq(profiles.id, sub)).limit(1)
    const state: ProfileState = {
      deleted: !row || row.deletedAt != null,
      role: row?.role ?? null,
      permissions: row?.permissions ?? null,
    }
    try { await getSharedRedis().set(key, JSON.stringify(state), 'EX', PROFILE_STATE_TTL_SEC) } catch { /* без кэша */ }
    return state
  } catch (err) {
    // БД недоступна — не роняем авторизацию (маршрут всё равно упадёт на своей БД).
    console.warn(`[auth] Не удалось проверить профиль sub=${sub}:`, err)
    return null
  }
}

/** Сбросить кэш профиля (после увольнения/смены роли/прав) — изменение действует сразу. */
export async function invalidateProfileAuthCache(clubId: string | null, sub: string): Promise<void> {
  try { await getSharedRedis().del(profileStateKey(clubId, sub)) } catch { /* истечёт по TTL */ }
}

export const requireAuth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  // clubId клуба ТЕКУЩЕГО домена (по Host). null — основной/служебный домен.
  // К нему привязываем токен/тикет, чтобы артефакт одного клуба нельзя было
  // переиграть на поддомене другого (database-per-club).
  const domainClubId = c.var.club?.id ?? null

  // SSE: одноразовый короткоживущий тикет (?ticket=) вместо полного JWT в URL.
  // Выдаётся /auth/sse-ticket по Bearer, живёт 60с, потребляется здесь однократно.
  const ticket = c.req.query('ticket')
  if (ticket) {
    try {
      const raw = await getSharedRedis().getdel(`sse:${ticket}`)
      if (!raw) return c.json({ error: 'Invalid ticket' }, 401)
      const ticketUser = JSON.parse(raw) as JwtPayload
      // СТРОГАЯ привязка к клубу: тикет мятится на правильном домене и живёт 60с,
      // поэтому легитимный тикет ВСЕГДА несёт clubId своего домена. Несовпадение =
      // попытка переиграть тикет клуба A на поддомене клуба B → 401. Грейса нет:
      // легаси-тикетов не существует (TTL 60с, все выпущены уже с clubId).
      const ticketClubId = (ticketUser as { clubId?: string | null }).clubId ?? null
      if (ticketClubId !== domainClubId) {
        return c.json({ error: 'Invalid ticket' }, 401)
      }
      c.set('user', ticketUser)
      await next()
      return
    } catch {
      return c.json({ error: 'Invalid ticket' }, 401)
    }
  }

  // Bearer-токен в Authorization-заголовке ИЛИ в ?token=... query param
  // (?token= — легаси-путь SSE; новый клиент использует ?ticket= выше).
  let token: string | null = null
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7)
  } else {
    const qToken = c.req.query('token')
    if (qToken) token = qToken
  }

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let user: JwtPayload
  try {
    user = await verifyToken(token)
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // Суперадмин-токен (scope='superadmin') НЕ принимается клубными роутами —
  // контуры строго разделены (см. modules/superadmin/superadmin-token.ts).
  if ((user as unknown as { scope?: string }).scope === 'superadmin') {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // ── Привязка JWT к клубу (database-per-club) ────────────────────────────────
  // Матрица допуска (token.clubId × domain.clubId):
  //   token.clubId === undefined  → ЛЕГАСИ-токен (выпущен до фикса): ПРОПУСКАЕМ
  //       с warn (грейс на время дожития старых токенов, до 30д). СУЖАЕТСЯ позже:
  //       когда легаси-токены истекут — заменить грейс на 401 (см. план аудита).
  //   token.clubId === domain.clubId → допускаем (включая null===null = основной
  //       домен: токен основного домена работает только на основном домене).
  //   token.clubId !== domain.clubId → 401 (токен клуба A на поддомене клуба B,
  //       клубный токен на основном домене, токен основного домена на поддомене).
  const tokenClubId = (user as { clubId?: string | null }).clubId
  if (tokenClubId === undefined) {
    console.warn(
      `[auth] Легаси-JWT без clubId (sub=${user.sub}) на домене club=${domainClubId ?? 'main'} — пропущен по грейсу`,
    )
  } else if (tokenClubId !== domainClubId) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // Проверка отзыва токена (logout/блокировка). Best-effort: если Redis
  // недоступен — пропускаем (fail-open), чтобы не ронять авторизацию.
  try {
    const revoked = await getSharedRedis().get(`revoked:${tokenHash(token)}`)
    if (revoked) return c.json({ error: 'Token revoked' }, 401)
  } catch { /* fail-open */ }

  // Профиль удалён (уволен/клиент удалён) → токен больше не действует; роль
  // персонала — актуальная из БД, а не зашитая в JWT.
  const state = await loadProfileState(c.var.db, domainClubId, user.sub)
  if (state?.deleted) return c.json({ error: 'Token revoked' }, 401)
  if (state?.role && STAFF_ROLES.has(user.role) && state.role !== user.role) {
    user = { ...user, role: state.role }
  }

  c.set('user', user)
  c.set('permissions', state ? (state.permissions ?? {}) : undefined)
  await next()
})

export const requireRole = (...roles: string[]) =>
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const user = c.get('user')
    if (!roles.includes(user.role)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await next()
  })

/**
 * Право сотрудника на управленческое действие (profiles.permissions, умолчания —
 * lib/permissions.ts). Владелец проходит всегда; сотрудник — если право включено.
 * Права не загрузились (БД недоступна, SSE-тикет) — пропускаем (fail-open, как
 * проверка профиля в requireAuth). Ставить ПОСЛЕ requireAuth/requireRole.
 */
export const requirePermission = (key: string) =>
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const user = c.get('user')
    if (user.role === 'owner') return next()
    const permissions = c.get('permissions')
    if (user.role === 'staff' && (permissions === undefined || permissionOn(permissions, key))) return next()
    const label = PERMISSION_LABELS[key] ?? key
    return c.json({ error: `Нет доступа — попросите владельца включить право «${label}»` }, 403)
  })
